import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptToken, toByteaHex } from "@pseo/core";
import type { AuthContext } from "../auth.ts";
import { getServiceClient } from "../db.ts";
import { makeTrackGscPropertyTool } from "./track-gsc-property.ts";

/**
 * DB-integration proof for track_gsc_property's PRODUCTION path. NOTHING is injected: the tool
 * is built with its real defaults, so this drives the tenant-filtered `gsc_accounts` read, the
 * sealed-token unseal, `refreshAccessToken`, `listSites`, setup_project's real project route
 * (`openTrackedProject`, normalizer included) and the real `gsc_connections` upsert. The DB is
 * REAL; Google is a fake `fetch` that passes every non-Google URL through to the real one, so
 * supabase-js keeps working and zero packets reach Google (NEVER #5).
 *
 * THIS FILE OWNS THE ROW COUNTS. The fast-lane spec proves the refusals by asserting the
 * project port was never called; only here can "exactly one project row exists" and "the
 * archived project came back on its ORIGINAL id" be stated about real rows.
 *
 * FIXTURE RULE (Task 3's trap): every domain is a UUID-suffixed `.com`, so no assertion can
 * pass because a fixture string happened to appear in a refusal sentence, and no fixture is
 * refused by the normalizer for its TLD. The one deliberate exception is the `.internal`
 * fixture, whose whole point is that the normalizer must refuse it.
 */

// 64-hex (32-byte) AES-256 test key. Unmistakably a test value, never a real key.
const KEY = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SITES_ENDPOINT = "https://www.googleapis.com/webmasters/v3/sites";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — export the local stack env (see guardrails/verify-db.sh)`);
  }
  return value;
}

requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = getServiceClient();

let google: { siteEntry: readonly { siteUrl: string; permissionLevel: string }[] } = {
  siteEntry: [],
};

const realFetch = globalThis.fetch;

function hrefOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return String(input);
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const savedEnv = {
  key: process.env.TOKEN_ENCRYPTION_KEY,
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
};

beforeAll(() => {
  // The production path reads all three from the environment under their REAL names
  // (signed lesson 5), so the spec supplies those rather than an injected override.
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  process.env.GOOGLE_CLIENT_ID = "track-gsc-property.db.test.invalid";
  process.env.GOOGLE_CLIENT_SECRET = "not-a-real-value-db-test";
  vi.stubGlobal("fetch", (input: unknown, init?: RequestInit): Promise<Response> => {
    const href = hrefOf(input);
    if (href.startsWith(TOKEN_ENDPOINT)) {
      return Promise.resolve(json({ access_token: "ya29.db-test-access", expires_in: 3599 }));
    }
    if (href.startsWith(SITES_ENDPOINT)) {
      return Promise.resolve(json({ siteEntry: google.siteEntry }));
    }
    return realFetch(input as string, init);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  process.env.TOKEN_ENCRYPTION_KEY = savedEnv.key;
  process.env.GOOGLE_CLIENT_ID = savedEnv.clientId;
  process.env.GOOGLE_CLIENT_SECRET = savedEnv.clientSecret;
});

afterEach(() => {
  google = { siteEntry: [] };
});

async function makeCtx(): Promise<AuthContext> {
  const { data, error } = await service.auth.admin.createUser({
    email: `track-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

/** A real gsc_accounts row with a sealed refresh token — the credential the tool must open. */
async function seedAccount(userId: string): Promise<{ id: string; email: string }> {
  const accountId = randomUUID();
  const email = `holder-${randomUUID()}@example.test`;
  const { error } = await service.from("gsc_accounts").insert({
    id: accountId,
    user_id: userId,
    google_account_sub: `sub-${randomUUID()}`,
    google_account_email: email,
    encrypted_refresh_token: toByteaHex(
      encryptToken(`1//refresh-${randomUUID()}`, KEY, { userId, accountId }),
    ),
  });
  if (error) throw new Error(`gsc_accounts seed failed: ${error.message}`);
  return { id: accountId, email };
}

/** An existing (project -> account, property) mapping, so a re-point has something to land on. */
async function seedMapping(
  userId: string,
  projectId: string,
  accountId: string,
  property: string,
): Promise<void> {
  const { error } = await service.from("gsc_connections").insert({
    user_id: userId,
    project_id: projectId,
    account_id: accountId,
    gsc_property: property,
  });
  if (error) throw new Error(`gsc_connections seed failed: ${error.message}`);
}

/** How many mapping rows this project has — one, always, or the upsert is not upserting. */
async function countMappings(userId: string, projectId: string): Promise<number> {
  const { data, error } = await service
    .from("gsc_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("project_id", projectId);
  if (error) throw new Error(`gsc_connections count failed: ${error.message}`);
  return (data ?? []).length;
}

async function seedProject(
  userId: string,
  domain: string,
  archivedAt: string | null,
): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain, archived_at: archivedAt })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project seed failed: ${error?.message ?? "no row"}`);
  return data.id;
}

interface ProjectRow {
  readonly id: string;
  readonly archived_at: string | null;
}

async function projectsByDomain(userId: string, domain: string): Promise<ProjectRow[]> {
  const { data, error } = await service
    .from("projects")
    .select("id, archived_at")
    .eq("user_id", userId)
    .eq("domain", domain);
  if (error) throw new Error(`projects read failed: ${error.message}`);
  return (data ?? []) as unknown as ProjectRow[];
}

async function countProjectsByDomain(userId: string, domain: string): Promise<number> {
  return (await projectsByDomain(userId, domain)).length;
}

async function readMapping(
  userId: string,
  projectId: string,
): Promise<{ account_id: string | null; gsc_property: string | null } | null> {
  const { data, error } = await service
    .from("gsc_connections")
    .select("account_id, gsc_property")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new Error(`gsc_connections read failed: ${error.message}`);
  return data as unknown as { account_id: string | null; gsc_property: string | null } | null;
}

async function ledgerRowCount(userId: string): Promise<number> {
  const { data, error } = await service.from("credit_ledger").select("id").eq("user_id", userId);
  if (error) throw new Error(`ledger read failed: ${error.message}`);
  return (data ?? []).length;
}

/** The tool with NO ports injected — the production wiring is the subject of this file. */
async function callTool(
  ctx: AuthContext,
  input: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const result = await makeTrackGscPropertyTool().run(ctx, input);
  return {
    text: result.content.map((part) => part.text).join("\n"),
    isError: result.isError === true,
  };
}

describe("track_gsc_property over the real database + the real Google client", () => {
  it("opens the project for a listed property and maps the property to it", async () => {
    const ctx = await makeCtx();
    const account = await seedAccount(ctx.userId);
    const domain = `katrenur-${randomUUID()}.com`;
    const property = `sc-domain:${domain}`;
    google = { siteEntry: [{ siteUrl: property, permissionLevel: "siteOwner" }] };

    const run = await callTool(ctx, { property });

    expect(run.isError).toBe(false);
    expect(run.text).toContain(domain);
    const projects = await projectsByDomain(ctx.userId, domain);
    expect(projects).toHaveLength(1);
    expect(projects[0].archived_at).toBeNull();
    expect(await readMapping(ctx.userId, projects[0].id)).toMatchObject({
      account_id: account.id,
      gsc_property: property,
    });
    // 0 credits means 0 ledger rows — no reserve, no commit, nothing (NEVER #2).
    expect(await ledgerRowCount(ctx.userId)).toBe(0);
  });

  it("is IDEMPOTENT: calling it twice leaves exactly ONE project and ONE mapping", async () => {
    const ctx = await makeCtx();
    await seedAccount(ctx.userId);
    const domain = `katrenur-${randomUUID()}.com`;
    const property = `sc-domain:${domain}`;
    google = { siteEntry: [{ siteUrl: property, permissionLevel: "siteFullUser" }] };

    await callTool(ctx, { property });
    const second = await callTool(ctx, { property });

    expect(second.isError).toBe(false);
    expect(await countProjectsByDomain(ctx.userId, domain)).toBe(1);
    const { data } = await service
      .from("gsc_connections")
      .select("id")
      .eq("user_id", ctx.userId);
    expect((data ?? []).length).toBe(1);
  });

  it("RE-POINTS an existing mapping to the new property and account, leaving ONE row", async () => {
    // CONTROLLER RULING (2026-08-13): silent re-pointing is the correct behaviour — the command
    // is imperative, the success text names the account, and /app/connection's
    // saveProjectProperty performs the byte-identical upsert (same onConflict user_id,project_id).
    // Two surfaces disagreeing about the same action would be worse than either choice alone.
    // It is pinned here so it cannot flip silently later: the idempotency spec above only covers
    // re-calling with the SAME property, which an insert-only write would also survive.
    //
    // Both properties resolve to the SAME domain (URL-prefix vs. domain property), which is what
    // makes this a re-point of one project rather than a second project.
    const ctx = await makeCtx();
    const oldAccount = await seedAccount(ctx.userId);
    const newAccount = await seedAccount(ctx.userId);
    const domain = `katrenur-${randomUUID()}.com`;
    const oldProperty = `https://${domain}/`;
    const newProperty = `sc-domain:${domain}`;
    const projectId = await seedProject(ctx.userId, domain, null);
    await seedMapping(ctx.userId, projectId, oldAccount.id, oldProperty);
    google = { siteEntry: [{ siteUrl: newProperty, permissionLevel: "siteOwner" }] };

    // account_id is named because the fake Google answers every account with the same listing,
    // so both accounts would list it and the ambiguity guard would (correctly) refuse.
    const run = await callTool(ctx, { property: newProperty, account_id: newAccount.id });

    expect(run.isError).toBe(false);
    // The overwrite landed: new property, new account.
    expect(await readMapping(ctx.userId, projectId)).toEqual({
      account_id: newAccount.id,
      gsc_property: newProperty,
    });
    // …in ONE row, not two.
    expect(await countMappings(ctx.userId, projectId)).toBe(1);
    // …on the SAME project, not a second one.
    expect(await countProjectsByDomain(ctx.userId, domain)).toBe(1);
    // The user is told which account it now reads through — the whole reason silence is
    // acceptable is that the answer is not silent about the result.
    expect(run.text).toContain(newAccount.email);
  });

  it("does NOT re-create an archived project — it brings the original id back", async () => {
    const ctx = await makeCtx();
    await seedAccount(ctx.userId);
    const domain = `katrenur-${randomUUID()}.com`;
    const property = `sc-domain:${domain}`;
    const archivedId = await seedProject(ctx.userId, domain, "2026-08-13T00:00:00Z");
    google = { siteEntry: [{ siteUrl: property, permissionLevel: "siteRestrictedUser" }] };

    const run = await callTool(ctx, { property });

    expect(run.isError).toBe(false);
    const projects = await projectsByDomain(ctx.userId, domain);
    expect(projects).toHaveLength(1);
    // The SAME row, restored in place — the crawls, reports and mapping hanging off this id
    // survive, which a second row would have orphaned.
    expect(projects[0].id).toBe(archivedId);
    expect(projects[0].archived_at).toBeNull();
    expect(await readMapping(ctx.userId, archivedId)).toMatchObject({ gsc_property: property });
  });

  it("REFUSES an unqueryable property and opens no project at all", async () => {
    const ctx = await makeCtx();
    await seedAccount(ctx.userId);
    const domain = `modnco-${randomUUID()}.com`;
    const property = `sc-domain:${domain}`;
    google = { siteEntry: [{ siteUrl: property, permissionLevel: "siteUnverifiedUser" }] };

    const run = await callTool(ctx, { property });

    expect(run.isError).toBe(true);
    expect(run.text).toMatch(/siteUnverifiedUser/);
    expect(run.text).toMatch(/cannot be queried/i);
    expect(await countProjectsByDomain(ctx.userId, domain)).toBe(0);
  });

  it("refuses a property no connected account lists, and opens no project", async () => {
    const ctx = await makeCtx();
    await seedAccount(ctx.userId);
    const listed = `sc-domain:katrenur-${randomUUID()}.com`;
    const domain = `zephyrbrook-${randomUUID()}.com`;
    google = { siteEntry: [{ siteUrl: listed, permissionLevel: "siteOwner" }] };

    const run = await callTool(ctx, { property: `sc-domain:${domain}` });

    expect(run.isError).toBe(true);
    expect(run.text).toMatch(/not listed/i);
    // A public `.com`, so the normalizer would have accepted it: the zero below measures the
    // listing gate rather than a TLD the normalizer refuses anyway.
    expect(await countProjectsByDomain(ctx.userId, domain)).toBe(0);
  });

  it("refuses a NON-PUBLIC host even though Google listed it, and opens no project", async () => {
    // The finding Task 2's referee deferred here: propertyToDomain accepts hosts
    // normalizeDomain refuses. Because the project is opened through setup_project's route,
    // the normalizer still runs — this spec is what proves that, against the real route.
    const ctx = await makeCtx();
    await seedAccount(ctx.userId);
    const domain = `ledgerkeep-${randomUUID()}.internal`;
    const property = `sc-domain:${domain}`;
    google = { siteEntry: [{ siteUrl: property, permissionLevel: "siteOwner" }] };

    const run = await callTool(ctx, { property });

    expect(run.isError).toBe(true);
    expect(run.text).toMatch(/not a public domain/i);
    expect(await countProjectsByDomain(ctx.userId, domain)).toBe(0);
  });

  it("never tracks a property through ANOTHER tenant's connected account", async () => {
    const owner = await makeCtx();
    const intruder = await makeCtx();
    const ownerAccount = await seedAccount(owner.userId);
    const domain = `katrenur-${randomUUID()}.com`;
    const property = `sc-domain:${domain}`;
    google = { siteEntry: [{ siteUrl: property, permissionLevel: "siteOwner" }] };

    // The intruder names the owner's account id explicitly — the strongest form of the probe.
    const run = await callTool(intruder, { property, account_id: ownerAccount.id });

    expect(run.isError).toBe(true);
    expect(run.text).not.toContain(ownerAccount.id);
    expect(await countProjectsByDomain(intruder.userId, domain)).toBe(0);
    expect(await countProjectsByDomain(owner.userId, domain)).toBe(0);
  });
});
