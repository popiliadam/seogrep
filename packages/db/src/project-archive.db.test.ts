import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createServiceClient } from "./server.js";

/**
 * DB-integration suite for migration 0022: the ARCHIVE axis on public.projects, run against a
 * LOCAL Supabase stack (guardrails/verify-db.sh only — the *.db.test.ts glob keeps it out of the
 * fast gate).
 *
 * The column carries one meaning and both halves of it are pinned here, through a real
 * INSERT/UPDATE + SELECT (the round-trip pattern of jobs-reports-columns.db.test.ts) rather than a
 * catalog lookup: PostgREST does not expose information_schema, and a round-trip proves strictly
 * more — that the column exists AND that the table grants (migration 0006) reach it.
 *
 *   1. A freshly created project is ACTIVE: archived_at comes back null without the writer ever
 *      naming it. This is what fails if the column is missing, and equally what fails if it is
 *      ever given a default — a defaulted archived_at would silently archive every new project.
 *   2. archived_at is nullable in BOTH directions: a timestamp can be written (archive) and then
 *      cleared back to null (restore). The restore half is the feature's entire promise, so it is
 *      measured, not assumed.
 *
 * Mutation-tested on BOTH axes, each run against a real `db reset` (required by the task brief):
 * `not null default now()` turns both tests red (test 1 on the value, test 2 on the not-null
 * violation at restore), and the default axis ALONE — plain `default now()`, still nullable —
 * turns test 1 red while test 2 stays green. So neither assertion is riding on the other.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — run these tests via guardrails/verify-db.sh`);
  }
  return value;
}

// createServiceClient() reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY itself.
requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = createServiceClient();

async function makeUserId(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `archive-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

async function makeProject(userId: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain: `${randomUUID()}.example.test` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  return data.id;
}

beforeAll(async () => {
  const { error } = await service.from("projects").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("projects.archived_at (migration 0022)", () => {
  it("a project created without naming archived_at is ACTIVE — the column exists and has no default", async () => {
    const userId = await makeUserId();
    const projectId = await makeProject(userId);

    const { data, error } = await service
      .from("projects")
      .select("archived_at")
      .eq("id", projectId)
      .single();
    if (error || !data) throw new Error(`projects select failed: ${error?.message ?? "no row"}`);
    expect(data.archived_at).toBeNull();
  });

  it("archived_at accepts a timestamp and can be cleared back to null (archive, then restore)", async () => {
    const userId = await makeUserId();
    const projectId = await makeProject(userId);
    const archivedAt = "2026-08-13T09:30:00.000Z";

    const archived = await service
      .from("projects")
      .update({ archived_at: archivedAt })
      .eq("id", projectId)
      .select("archived_at")
      .single();
    if (archived.error || !archived.data) {
      throw new Error(`archive update failed: ${archived.error?.message ?? "no row"}`);
    }
    expect(new Date(archived.data.archived_at as string).toISOString()).toBe(archivedAt);

    const restored = await service
      .from("projects")
      .update({ archived_at: null })
      .eq("id", projectId)
      .select("archived_at")
      .single();
    if (restored.error || !restored.data) {
      throw new Error(`restore update failed: ${restored.error?.message ?? "no row"}`);
    }
    expect(restored.data.archived_at).toBeNull();
  });
});
