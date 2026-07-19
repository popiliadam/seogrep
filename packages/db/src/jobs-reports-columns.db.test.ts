import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { createServiceClient } from "./server.js";
import type { Database, Json } from "./types.js";

/**
 * DB-integration tests for the migration 0009 column additions (jobs, reports, api_keys,
 * gsc_connections), run against a LOCAL Supabase stack (guardrails/verify-db.sh only).
 * Each test round-trips the new columns through a real INSERT + SELECT to pin that the
 * column exists with the expected type and that the Data API grants (0006) reach it.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — run these tests via guardrails/verify-db.sh`);
  }
  return value;
}

requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

// The 0009 columns are not in the generated types.ts yet; overlay them onto the four tables
// so the typed inserts/selects below compile (the fenced cast pattern used across
// packages/db and apps/web until types.ts is regenerated from the cloud project).
type Extra = {
  jobs: {
    started_at: string | null;
    finished_at: string | null;
    error: string | null;
    result: Json | null;
    reserve_id: string | null;
  };
  reports: { title: string | null; html: string | null; tool: string | null };
  api_keys: { last_used_at: string | null };
  gsc_connections: { gsc_property: string | null };
};
type WithExtra<T extends keyof Extra> = {
  Row: Database["public"]["Tables"][T]["Row"] & Extra[T];
  Insert: Database["public"]["Tables"][T]["Insert"] & Partial<Extra[T]>;
  Update: Database["public"]["Tables"][T]["Update"] & Partial<Extra[T]>;
  Relationships: Database["public"]["Tables"][T]["Relationships"];
};
type Faz3Database = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Omit<Database["public"]["Tables"], keyof Extra> & {
      jobs: WithExtra<"jobs">;
      reports: WithExtra<"reports">;
      api_keys: WithExtra<"api_keys">;
      gsc_connections: WithExtra<"gsc_connections">;
    };
  };
};

const service = createServiceClient();
function ext(): SupabaseClient<Faz3Database> {
  return service as unknown as SupabaseClient<Faz3Database>;
}

async function makeUserId(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `faz3col-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

async function makeProjectId(userId: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain: `${randomUUID()}.example.test` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  return data.id;
}

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("migration 0009 columns against local Supabase", () => {
  it("jobs: started_at / finished_at / error / result / reserve_id round-trip", async () => {
    const userId = await makeUserId();
    const reserveId = randomUUID();
    const started = "2026-07-19T10:00:00.000Z";
    const finished = "2026-07-19T10:00:05.000Z";
    const { data, error } = await ext()
      .from("jobs")
      .insert({
        user_id: userId,
        tool: "audit",
        status: "succeeded",
        started_at: started,
        finished_at: finished,
        error: null,
        result: { score: 91, issues: ["title-too-long"] },
        reserve_id: reserveId,
      })
      .select("started_at, finished_at, error, result, reserve_id")
      .single();
    if (error || !data) throw new Error(`jobs insert failed: ${error?.message ?? "no row"}`);
    expect(new Date(data.started_at as string).toISOString()).toBe(started);
    expect(new Date(data.finished_at as string).toISOString()).toBe(finished);
    expect(data.error).toBeNull();
    expect(data.result).toEqual({ score: 91, issues: ["title-too-long"] });
    expect(data.reserve_id).toBe(reserveId);
  });

  it("reports: title / html / tool round-trip", async () => {
    const userId = await makeUserId();
    const { data, error } = await ext()
      .from("reports")
      .insert({
        user_id: userId,
        title: "Weekly SEO audit",
        html: "<h1>Report</h1>",
        tool: "audit",
      })
      .select("title, html, tool")
      .single();
    if (error || !data) throw new Error(`reports insert failed: ${error?.message ?? "no row"}`);
    expect(data.title).toBe("Weekly SEO audit");
    expect(data.html).toBe("<h1>Report</h1>");
    expect(data.tool).toBe("audit");
  });

  it("api_keys: last_used_at round-trip", async () => {
    const userId = await makeUserId();
    const usedAt = "2026-07-19T11:22:33.000Z";
    const { data, error } = await ext()
      .from("api_keys")
      .insert({
        user_id: userId,
        key_hash: `hash-${randomUUID()}`,
        key_prefix: "sg_test",
        last_used_at: usedAt,
      })
      .select("last_used_at")
      .single();
    if (error || !data) throw new Error(`api_keys insert failed: ${error?.message ?? "no row"}`);
    expect(new Date(data.last_used_at as string).toISOString()).toBe(usedAt);
  });

  it("gsc_connections: gsc_property round-trip", async () => {
    const userId = await makeUserId();
    const projectId = await makeProjectId(userId);
    const { data, error } = await ext()
      .from("gsc_connections")
      .insert({
        user_id: userId,
        project_id: projectId,
        gsc_property: "sc-domain:example.test",
      })
      .select("gsc_property")
      .single();
    if (error || !data) {
      throw new Error(`gsc_connections insert failed: ${error?.message ?? "no row"}`);
    }
    expect(data.gsc_property).toBe("sc-domain:example.test");
  });
});
