import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient } from "../db.ts";
import type { AuthContext } from "../auth.ts";
import { setupProjectTool } from "./setup-project.ts";

/**
 * DB-integration proofs for setup_project against a LOCAL Supabase stack (test:db
 * lane; export env via guardrails/verify-db.sh). Proves: first call creates, repeat
 * calls are idempotent by (user_id, domain) — INCLUDING across URL/host forms that
 * normalize to the same domain — and one tenant never sees another's projects.
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
});
