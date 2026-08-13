import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptToken, toByteaHex } from "@pseo/core";
import type { AuthContext } from "../auth.ts";
import { getServiceClient } from "../db.ts";
import { projectNotFoundMessage } from "./project-target.ts";
import { archiveOwnProject, makeUntrackProjectTool } from "./untrack-project.ts";

/**
 * DB-integration proof for untrack_project's PRODUCTION path. NOTHING is injected: the tool is
 * built with its real defaults, so this drives the real tenant-scoped project read and the real
 * `projects` UPDATE against real rows.
 *
 * THIS FILE OWNS THE CLAIMS ABOUT ROWS. The fast lane proves WHICH answer the tool gives and
 * whether the write port was called at all; only here can "archiving keeps the Search Console
 * mapping" and "the write's own tenant filter binds" be stated about Postgres rather than about
 * a test double. The last spec drives `archiveOwnProject` HEAD-ON with a mismatched
 * (userId, projectId) pair, because at the tool level the ownership gate refuses first and the
 * write's `.eq("user_id", …)` would never be reached — an unreachable guard is an unmeasured one.
 *
 * FIXTURE RULE (the trap this branch has hit twice): every domain is a UUID-suffixed `.com`, so
 * no assertion can pass because a fixture string turned up inside a message, and no fixture is
 * refused for its TLD by anything upstream.
 *
 * No network at all: this tool calls no external API (NEVER #5), so unlike its siblings there is
 * nothing here to stub out.
 */

// 64-hex (32-byte) AES-256 test key. Unmistakably a test value, never a real key. Used only to
// SEAL a blob for the account row this file seeds; nothing here ever unseals it.
const KEY = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809";

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

async function makeCtx(): Promise<AuthContext> {
  const { data, error } = await service.auth.admin.createUser({
    email: `untrack-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

async function seedProject(
  userId: string,
  domain: string,
  archivedAt: string | null = null,
): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain, archived_at: archivedAt })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project seed failed: ${error?.message ?? "no row"}`);
  return data.id;
}

/** A real gsc_accounts row — the credential half of the Search Console link that must survive. */
async function seedAccount(userId: string): Promise<string> {
  const accountId = randomUUID();
  const { error } = await service.from("gsc_accounts").insert({
    id: accountId,
    user_id: userId,
    google_account_sub: `sub-${randomUUID()}`,
    google_account_email: `holder-${randomUUID()}@example.test`,
    encrypted_refresh_token: toByteaHex(
      encryptToken(`1//refresh-${randomUUID()}`, KEY, { userId, accountId }),
    ),
  });
  if (error) throw new Error(`gsc_accounts seed failed: ${error.message}`);
  return accountId;
}

/** The (project -> account, property) mapping whose survival is this tool's central promise. */
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

async function readProject(projectId: string): Promise<{ archived_at: string | null } | null> {
  const { data, error } = await service
    .from("projects")
    .select("archived_at")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(`projects read failed: ${error.message}`);
  return data;
}

async function readMapping(
  projectId: string,
): Promise<{ account_id: string | null; gsc_property: string | null } | null> {
  const { data, error } = await service
    .from("gsc_connections")
    .select("account_id, gsc_property")
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
  const result = await makeUntrackProjectTool().run(ctx, input);
  return {
    text: result.content.map((part) => part.text).join("\n"),
    isError: result.isError === true,
  };
}

describe("untrack_project over the real database", () => {
  it("ARCHIVES the project and leaves its Search Console mapping exactly as it was", async () => {
    const ctx = await makeCtx();
    const domain = `harborlane-${randomUUID()}.com`;
    const property = `sc-domain:${domain}`;
    const projectId = await seedProject(ctx.userId, domain);
    const accountId = await seedAccount(ctx.userId);
    await seedMapping(ctx.userId, projectId, accountId, property);

    const run = await callTool(ctx, { project_id: projectId });

    expect(run.isError).toBe(false);
    // The row is still there, stamped — not deleted.
    expect(await readProject(projectId)).toMatchObject({ archived_at: expect.any(String) });
    // …and the mapping that makes coming back free is untouched, credential half included.
    expect(await readMapping(projectId)).toEqual({
      account_id: accountId,
      gsc_property: property,
    });
    // 0 credits means 0 ledger rows — no reserve, no commit, nothing (NEVER #2).
    expect(await ledgerRowCount(ctx.userId)).toBe(0);
  });

  it("is IDEMPOTENT: a second call succeeds and does not re-stamp the archive date", async () => {
    const ctx = await makeCtx();
    const projectId = await seedProject(ctx.userId, `quillmarsh-${randomUUID()}.com`);

    const first = await callTool(ctx, { project_id: projectId });
    const stampedAt = (await readProject(projectId))?.archived_at;
    const second = await callTool(ctx, { project_id: projectId });

    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(second.text).not.toMatch(/error|failed/i);
    expect(typeof stampedAt).toBe("string");
    // The date the tenant actually put it away survives the second call.
    expect((await readProject(projectId))?.archived_at).toBe(stampedAt);
  });

  it("does NOT archive another tenant's project, and answers exactly like an unknown id", async () => {
    const owner = await makeCtx();
    const intruder = await makeCtx();
    const projectId = await seedProject(owner.userId, `bellweather-${randomUUID()}.com`);
    const unknownId = randomUUID();

    const probe = await callTool(intruder, { project_id: projectId });
    const unknown = await callTool(intruder, { project_id: unknownId });

    expect(probe.isError).toBe(true);
    // Byte-identical sentences, so nothing here reveals that the id exists for somebody.
    expect(probe.text).toBe(projectNotFoundMessage(projectId));
    expect(unknown.text).toBe(projectNotFoundMessage(unknownId));
    // The owner's project is still being tracked.
    expect(await readProject(projectId)).toMatchObject({ archived_at: null });
  });

  it("the archive WRITE itself is tenant-filtered: a foreign user_id matches no row", async () => {
    // The tool-level spec above cannot measure this — `loadOwnProject` refuses first, so the
    // write's own `.eq("user_id", …)` is never reached there. Driving the writer head-on is
    // what makes that filter load-bearing: delete it and this UPDATE reaches a stranger's row
    // (constitution NEVER #4).
    const owner = await makeCtx();
    const intruder = await makeCtx();
    const projectId = await seedProject(owner.userId, `stonefeather-${randomUUID()}.com`);

    const wrote = await archiveOwnProject(intruder.userId, projectId);

    // It reports honestly that it changed nothing…
    expect(wrote).toBe(false);
    // …and the owner's row is untouched.
    expect(await readProject(projectId)).toMatchObject({ archived_at: null });
    // The owner can still archive it themselves — the filter blocks the stranger, not the row.
    expect(await archiveOwnProject(owner.userId, projectId)).toBe(true);
    expect(await readProject(projectId)).toMatchObject({ archived_at: expect.any(String) });
  });
});
