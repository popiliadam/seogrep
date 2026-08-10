import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getServiceClient } from "../db.ts";
import type { AuthContext } from "../auth.ts";
import { connectGscTool } from "./connect-gsc.ts";

/**
 * DB-integration specs for connect_gsc against a LOCAL Supabase stack. The tenant-scoped
 * project read is real; no Google/token machinery is involved (this tool only returns a
 * link-out). Two guarantees: a valid, owned project yields a link carrying its id, and
 * another tenant's project id is indistinguishable from a missing one.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — export the local stack env (see guardrails/verify-db.sh)`);
  }
  return value;
}

requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const WEB_BASE_URL = "https://app.test.seogrep.example";
const service = getServiceClient();

async function makeCtx(): Promise<AuthContext> {
  const { data, error } = await service.auth.admin.createUser({
    email: `connect-gsc-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

async function makeProject(userId: string, domain: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  return data.id;
}

/**
 * A minimal real `gsc_accounts` row. connect_gsc never reads the credential — it only asks
 * whether the connection has an account behind it (migration 0021) — so the ciphertext is a
 * placeholder that satisfies the NOT NULL, exactly as whats-next.db.test.ts seeds it. The row
 * has to be REAL because `gsc_connections.account_id` carries a foreign key to it.
 */
async function makeAccount(userId: string): Promise<string> {
  const { data, error } = await service
    .from("gsc_accounts")
    .insert({
      user_id: userId,
      google_account_sub: `sub-${randomUUID()}`,
      google_account_email: `connect-gsc-${randomUUID()}@example.test`,
      encrypted_refresh_token: "\\xdeadbeef",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`gsc_accounts seed failed: ${error?.message ?? "no row"}`);
  return data.id;
}

let priorWebBaseUrl: string | undefined;

beforeAll(async () => {
  priorWebBaseUrl = process.env.WEB_BASE_URL;
  process.env.WEB_BASE_URL = WEB_BASE_URL;
  const { error } = await service.from("projects").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

afterAll(() => {
  if (priorWebBaseUrl === undefined) delete process.env.WEB_BASE_URL;
  else process.env.WEB_BASE_URL = priorWebBaseUrl;
});

describe("connect_gsc against the local stack", () => {
  it("returns a Google-connect link carrying the owned project id", async () => {
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId, "connect.example.com");

    const result = await connectGscTool.run(ctx, { project_id: projectId });

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain(`${WEB_BASE_URL}/api/gsc/connect?project_id=${projectId}`);
    expect(text).toContain("connect.example.com");
    expect(text).toMatch(/read-only/i);
  });

  /**
   * Live product test, 2026-08-07: adstark.com.tr had been connected since 2026-07-28 and
   * connect_gsc still answered with the byte-identical "open this link and approve access".
   * The state sits in gsc_connections and the tool simply never read it. Same blindness as
   * whats_next's swallowed audit branch and generate_report's "connect it" line.
   */
  it("says the project is ALREADY connected, and names the property, instead of re-offering the link", async () => {
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId, "already-connected.example.com");
    // RE-AIMED: the row used to be seeded with account_id NULL, which this tool then read as
    // connected. Under migration 0021 that state is a mapping with no credential behind it —
    // see the spec below — so "already connected" is now seeded the way the product produces
    // it: a real gsc_accounts row, linked. The credential itself is still never read here.
    const { error } = await service.from("gsc_connections").insert({
      user_id: ctx.userId,
      project_id: projectId,
      account_id: await makeAccount(ctx.userId),
      gsc_property: "https://already-connected.example.com/",
    });
    if (error) throw new Error(`could not seed gsc_connections: ${error.message}`);

    const result = await connectGscTool.run(ctx, { project_id: projectId });

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/already connected/i);
    expect(text).toContain("https://already-connected.example.com/");
    // It must still offer a way to re-connect (a grant withdrawn at Google) — but the headline
    // may not be the plain "go connect it" of an unconnected project.
    expect(text).toContain(`${WEB_BASE_URL}/api/gsc/connect?project_id=${projectId}`);
    expect(text).toMatch(/pull_gsc_data/);
    // A property change belongs to the picker now, not to a fresh consent.
    expect(text).toContain(`${WEB_BASE_URL}/app/connection`);
  });

  /**
   * DEFECT #52, REPRODUCED BY THE BRANCH THAT EXISTS TO KILL IT. `unmapProject` keeps the row
   * and nulls its columns, and disconnecting a Google account nulls `account_id` on every
   * project of that account (`on delete set null`, migration 0021). Reading row EXISTENCE
   * answered this state with "already connected — property https://…", the byte-identical
   * sentence measured on four live projects whose tokens were dead — while pull_gsc_data
   * refused the very same row with "No Search Console connection … Run connect_gsc first".
   * One tool said connect, the other said you already did.
   *
   * The stored `gsc_property` is deliberately NON-null here: it is what survives a disconnect,
   * and it is precisely what the old predicate printed as proof of a connection.
   */
  it("a row whose account_id is NULL is NOT connected — it gets the connect link, not 'already connected'", async () => {
    const ctx = await makeCtx();
    const domain = "unmapped.example.com";
    const projectId = await makeProject(ctx.userId, domain);
    const { error } = await service.from("gsc_connections").insert({
      user_id: ctx.userId,
      project_id: projectId,
      account_id: null, // the state unmapProject and an account disconnect both leave behind
      gsc_property: "https://unmapped.example.com/",
    });
    if (error) throw new Error(`could not seed gsc_connections: ${error.message}`);

    const result = await connectGscTool.run(ctx, { project_id: projectId });

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).not.toMatch(/already connected/i);
    expect(text).toContain(`To connect Google Search Console for ${domain}`);
    expect(text).toContain(`${WEB_BASE_URL}/api/gsc/connect?project_id=${projectId}`);
  });

  /**
   * The end-to-end pin for the failure this slice exists to fix. `gsc_property` is nullable
   * and the null is REACHED in production: the web callback (step 7) keeps the connection
   * when sites.list matches nothing, so the row exists with no property. Live 2026-08-09,
   * www.noraninsaat.com, the handler interpolated that value straight into the sentence and
   * the user read "property null" while every Search Console tool on the project was dead.
   *
   * The renderer's own spec (connect-gsc.test.ts) cannot see this: it proves the copy is
   * right, not that the handler routes through it. A regression that re-interpolates
   * gsc_property in the handler would leave that spec green — so the assertion has to come
   * out of connectGscTool.run over a real row.
   *
   * The fixture domain deliberately contains no "null" substring, and that is asserted
   * rather than assumed: a later rename to something like annullertravel.example.com would
   * otherwise make the check pass for the wrong reason.
   */
  it("does not print the raw null when the connection has no matched property", async () => {
    const domain = "unmatched-property.example.com";
    expect(domain).not.toContain("null"); // keeps the substring check below honest
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId, domain);
    // RE-AIMED alongside the account_id predicate: "connected but no property matched" is now
    // a LINKED row whose gsc_property is null, so the account is seeded and the property is
    // not. The assertion — the raw null never reaches the user — is untouched.
    const { error } = await service.from("gsc_connections").insert({
      user_id: ctx.userId,
      project_id: projectId,
      account_id: await makeAccount(ctx.userId),
      gsc_property: null,
    });
    if (error) throw new Error(`could not seed gsc_connections: ${error.message}`);

    const result = await connectGscTool.run(ctx, { project_id: projectId });

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("null");
    expect(text).not.toContain("undefined");
    // Honest: connection stands, nothing matched, WHICH domain, and what to do next.
    expect(text).toContain(domain);
    expect(text).toMatch(/matched it/i);
    expect(text).toMatch(/verify a property/i);
    expect(text).toContain(`${WEB_BASE_URL}/api/gsc/connect?project_id=${projectId}`);
  });

  it("treats another tenant's project id as not found (no link issued)", async () => {
    const a = await makeCtx();
    const b = await makeCtx();
    const aProject = await makeProject(a.userId, "tenant-a-gsc.example.com");

    // B asks to connect A's project id.
    const result = await connectGscTool.run(b, { project_id: aProject });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/no project found/i);
    expect(result.content[0]?.text ?? "").not.toContain("/api/gsc/connect");
  });
});
