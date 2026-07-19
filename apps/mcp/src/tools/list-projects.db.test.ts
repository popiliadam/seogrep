import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient } from "../db.ts";
import type { AuthContext } from "../auth.ts";
import { setupProjectTool } from "./setup-project.ts";
import { listProjectsTool } from "./list-projects.ts";

/**
 * DB-integration proofs for list_projects against a LOCAL Supabase stack (test:db lane).
 * Proves: an empty tenant gets actionable guidance (not a bare empty list), a populated
 * tenant gets its domains oldest-first, and the read is scoped to the calling tenant.
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
    email: `list-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

beforeAll(async () => {
  const { error } = await service.from("projects").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("list_projects against the local stack", () => {
  it("guides the user when they have no projects yet", async () => {
    const ctx = await makeCtx();
    const result = await listProjectsTool.run(ctx, {});
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(/No projects yet/i);
    expect(result.content[0]?.text).toMatch(/setup_project/);
  });

  it("lists the tenant's projects oldest-first with their project ids", async () => {
    const ctx = await makeCtx();
    await setupProjectTool.run(ctx, { domain: "first.com" });
    await setupProjectTool.run(ctx, { domain: "second.com" });

    const result = await listProjectsTool.run(ctx, {});
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/tracking 2 project/i);
    // Oldest-first: first.com before second.com.
    expect(text.indexOf("first.com")).toBeLessThan(text.indexOf("second.com"));
  });

  it("only lists the calling tenant's projects", async () => {
    const a = await makeCtx();
    const b = await makeCtx();
    await setupProjectTool.run(a, { domain: "only-a.com" });
    await setupProjectTool.run(b, { domain: "only-b.com" });

    const aText = (await listProjectsTool.run(a, {})).content[0]?.text ?? "";
    expect(aText).toContain("only-a.com");
    expect(aText).not.toContain("only-b.com");
  });
});
