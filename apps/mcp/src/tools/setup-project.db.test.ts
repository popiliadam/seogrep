import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient } from "../db.ts";
import type { AuthContext } from "../auth.ts";
import type { DomainReachability } from "./domain-reachability.ts";
import { makeSetupProjectTool, restoreOwnProject } from "./setup-project.ts";

/**
 * DB-integration proofs for setup_project against a LOCAL Supabase stack (test:db
 * lane; export env via guardrails/verify-db.sh). Proves: first call creates, repeat
 * calls are idempotent by (user_id, domain) — INCLUDING across URL/host forms that
 * normalize to the same domain — one tenant never sees another's projects, and a domain the
 * tenant had archived comes BACK on the same id instead of being registered a second time.
 *
 * THE DNS PORT IS INJECTED IN EVERY CASE, and that is a correctness requirement rather than
 * tidiness: the fixtures here register invented `.com` names, which really do not resolve, so a
 * tool wired to the live resolver would append a "does not resolve" warning to most of this file
 * AND make one uncapped DNS query per fixture — including eight at once in the race case. Every
 * spec below therefore runs `setupProject("unknown")`, the "nobody found out" answer, which is
 * byte-identical to the pre-check behaviour. The two cases that care about the check state their
 * own answer, and the WARNING itself is proven over a real write at the end of this file.
 */

/** setup_project with a stated DNS answer. "unknown" reproduces the pre-check output exactly. */
function setupProject(reachability: DomainReachability) {
  return makeSetupProjectTool({ checkDomain: async () => reachability });
}

const setupProjectTool = setupProject("unknown");

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
    email: `setup-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

async function projectRows(userId: string): Promise<{ id: string; domain: string }[]> {
  const { data, error } = await service
    .from("projects")
    .select("id, domain")
    .eq("user_id", userId);
  if (error) throw new Error(`projects read failed: ${error.message}`);
  return data ?? [];
}

/**
 * Archive the tenant's row by stamping archived_at (migration 0022) — what untracking does.
 * THROWS when no row matched, so a fixture that archives nothing cannot read as a pass.
 */
async function archiveProject(userId: string, domain: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("domain", domain)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`archive seed failed for ${domain}: ${error?.message ?? "no row matched"}`);
  }
  return data.id;
}

/** Read one project's archived_at straight from the table (null = actively tracked). */
async function archivedAt(projectId: string): Promise<string | null> {
  const { data, error } = await service
    .from("projects")
    .select("archived_at")
    .eq("id", projectId)
    .single();
  if (error || !data) throw new Error(`archived_at read failed: ${error?.message ?? "no row"}`);
  return data.archived_at;
}

beforeAll(async () => {
  const { error } = await service.from("projects").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("setup_project against the local stack", () => {
  it("creates a project on first call and reports created: true with a project_id", async () => {
    const ctx = await makeCtx();
    const result = await setupProjectTool.run(ctx, { domain: "example.com" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(/created: true/);
    const rows = await projectRows(ctx.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.domain).toBe("example.com");
    expect(result.content[0]?.text).toContain(rows[0]!.id);
  });

  it("is idempotent: a repeat call returns the SAME project with created: false, no duplicate row", async () => {
    const ctx = await makeCtx();
    const first = await setupProjectTool.run(ctx, { domain: "acme.io" });
    // A different input form that normalizes to the same domain must hit the same row.
    const second = await setupProjectTool.run(ctx, { domain: "https://ACME.io/pricing" });

    expect(first.content[0]?.text).toMatch(/created: true/);
    expect(second.content[0]?.text).toMatch(/created: false/);
    const rows = await projectRows(ctx.userId);
    expect(rows).toHaveLength(1);
    expect(second.content[0]?.text).toContain(rows[0]!.id);
  });

  it("brings an archived domain back: the SAME project id, archived_at cleared, still one row", async () => {
    const ctx = await makeCtx();
    const created = await setupProjectTool.run(ctx, { domain: "retired-shop.com" });
    expect(created.content[0]?.text).toMatch(/created: true/);
    const projectId = await archiveProject(ctx.userId, "retired-shop.com");

    const again = await setupProjectTool.run(ctx, { domain: "retired-shop.com" });

    expect(again.isError).toBeUndefined();
    const text = again.content[0]?.text ?? "";
    // The user's history hangs off this id — a second registration would orphan it, and the
    // (user_id, domain) unique constraint (migration 0010) makes one impossible anyway.
    expect(text).toContain(projectId);
    expect(text).toMatch(/created: false/);
    expect(text).toMatch(/restored/i);
    expect(await projectRows(ctx.userId)).toHaveLength(1);
    expect(await archivedAt(projectId)).toBeNull(); // tracked again, not merely reported
  });

  it("returns an isError result for an invalid domain and inserts nothing", async () => {
    const ctx = await makeCtx();
    const result = await setupProjectTool.run(ctx, { domain: "not a domain" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not a valid domain/i);
    expect(await projectRows(ctx.userId)).toHaveLength(0);
  });

  it("is tenant-scoped: one user's project never appears under another user", async () => {
    const a = await makeCtx();
    const b = await makeCtx();
    await setupProjectTool.run(a, { domain: "tenant-a.com" });
    await setupProjectTool.run(b, { domain: "tenant-b.com" });

    const aRows = await projectRows(a.userId);
    const bRows = await projectRows(b.userId);
    expect(aRows.map((r) => r.domain)).toEqual(["tenant-a.com"]);
    expect(bRows.map((r) => r.domain)).toEqual(["tenant-b.com"]);
  });

  it("is race-safe: simultaneous first calls yield ONE row and consistent created flags", async () => {
    const ctx = await makeCtx();
    // Fire many first calls at once (mixing input forms that normalize to the SAME domain).
    // With enough concurrency at least two reads land before any INSERT, exercising the exact
    // window the (user_id, domain) unique constraint (migration 0010) + the ON CONFLICT upsert
    // close: a plain INSERT loser would raise a unique violation, but the upsert loser hits
    // DO NOTHING and reads back the winner's row instead of erroring or opening a second row.
    const forms = [
      "race.example.com",
      "https://RACE.example.com/pricing",
      "http://race.example.com",
      "RACE.example.com.",
      "race.example.com/a?b=c",
      "https://race.EXAMPLE.com",
      "race.example.com",
      "https://race.example.com/",
    ];
    const results = await Promise.all(forms.map((domain) => setupProjectTool.run(ctx, { domain })));

    // No call surfaces an error (the losers must NOT leak a unique-violation).
    for (const result of results) expect(result.isError).toBeUndefined();

    // Exactly one row exists — no oversell / duplicate registration.
    const rows = await projectRows(ctx.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.domain).toBe("race.example.com");

    // Consistent outcome: exactly one winner reports created: true, the rest created: false,
    // and every call reports the SAME surviving project_id.
    const texts = results.map((r) => r.content[0]?.text ?? "");
    expect(texts.filter((t) => /created: true/.test(t))).toHaveLength(1);
    expect(texts.filter((t) => /created: false/.test(t))).toHaveLength(forms.length - 1);
    for (const text of texts) expect(text).toContain(rows[0]!.id);
  });
});

/**
 * THE RESTORE WRITE, DRIVEN HEAD-ON — the twin of untrack_project's `archiveOwnProject` pin,
 * and for the same reason. `setup_project` reads the project first, so at TOOL level the
 * ownership read refuses a stranger before the UPDATE ever runs: delete the write's own
 * `.eq("user_id", …)` and every tool-level spec above stays GREEN (measured, 2026-08-13). A
 * guard that no reachable path exercises is a guard nobody is measuring, so the writer is
 * exported and called directly with a mismatched (userId, projectId) pair.
 *
 * The zero-row half is pinned the same way: PostgREST answers an UPDATE that matched NOTHING
 * with `error === null`, so before this the tool said "Restored …" for a write that wrote
 * nothing. Both halves are one function's contract, so both are asserted on that function.
 */
describe("restoreOwnProject against the local stack", () => {
  it("is tenant-filtered on the WRITE: a foreign user_id matches no row", async () => {
    const owner = await makeCtx();
    const intruder = await makeCtx();
    await setupProjectTool.run(owner, { domain: `stonefeather-${randomUUID()}.com` });
    const [project] = await projectRows(owner.userId);
    const projectId = project!.id;
    const archivedFirst = await archiveProject(owner.userId, project!.domain);
    expect(archivedFirst).toBe(projectId);

    const stranger = await restoreOwnProject(intruder.userId, projectId);

    // It reports honestly that it changed nothing…
    expect(stranger).toBe(false);
    // …and the owner's project is still in the archive rather than silently un-archived.
    expect(await archivedAt(projectId)).not.toBeNull();
    // The filter blocks the stranger, not the row: the owner still gets their project back.
    expect(await restoreOwnProject(owner.userId, projectId)).toBe(true);
    expect(await archivedAt(projectId)).toBeNull();
  });

  it("reports a write that matched NO row instead of calling it a restore", async () => {
    const owner = await makeCtx();

    // A project id that exists for nobody. PostgREST returns error === null for this UPDATE,
    // so anything that reads `error` alone would call it a success.
    expect(await restoreOwnProject(owner.userId, randomUUID())).toBe(false);
  });
});

/**
 * THE REACHABILITY WARNING OVER A REAL WRITE (S17). The fast lane proves the wording and the
 * fail-open rule with both ports faked; what only this lane can show is that the WARNING and the
 * ROW coexist — the operator signed WARN, not block, so a domain that does not resolve has to end
 * up in `projects` exactly like any other, with the same id in the reply.
 */
describe("setup_project's domain warning against the local stack", () => {
  it("registers the row AND warns when the domain does not resolve", async () => {
    const ctx = await makeCtx();
    const domain = `bu-domain-kesinlikle-yok-${randomUUID()}.com`;
    const result = await setupProject("no_such_domain").run(ctx, { domain });

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/does not resolve/i);

    // The half a warning could quietly have cost: the project is really there, on the id the
    // reply hands back, and is not archived.
    const rows = await projectRows(ctx.userId);
    expect(rows.map((r) => r.domain)).toEqual([domain]);
    expect(text).toContain(rows[0]!.id);
    expect(await archivedAt(rows[0]!.id)).toBeNull();
  });

  it("writes the same row, without the warning, when the domain resolves", async () => {
    const ctx = await makeCtx();
    const domain = `live-site-${randomUUID()}.com`;
    const text = (await setupProject("resolves").run(ctx, { domain })).content[0]?.text ?? "";
    expect(text).toMatch(/created: true/);
    expect(text).not.toMatch(/does not resolve/i);
    expect((await projectRows(ctx.userId)).map((r) => r.domain)).toEqual([domain]);
  });
});
