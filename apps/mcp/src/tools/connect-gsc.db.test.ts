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
