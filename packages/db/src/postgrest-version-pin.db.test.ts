import { describe, expect, it } from "vitest";
import { POSTGREST_VERSION } from "../scripts/gen-db-types.mjs";

/**
 * The pin, checked against the thing it claims to describe.
 *
 * db-types-pin.test.ts proves the `__InternalSupabase` block reaches the generated file. It
 * cannot prove the VALUE is true — a pin that says "14.14" about a stack running something else
 * is just a comment that type-checks. The old value (`"14.5"`, lost in a782f27) came from the
 * CLOUD project while the local CLI is pinned separately, which is exactly how a pin drifts from
 * reality without anyone noticing.
 *
 * So this spec re-measures the running stack on every DB run and compares MAJOR versions —
 * major, because that is the whole of what supabase-js reads (`IsPostgrest13`/`IsPostgrest14`
 * are prefix tests, so a patch bump is genuinely not a behavioural change and should not turn
 * the gate red for noise). If the stack ever moves to a major the pin does not name, this goes
 * red and someone re-derives the constant instead of inheriting it on faith.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — run these tests via guardrails/verify-db.sh`);
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const ANON_KEY = requireEnv("SUPABASE_ANON_KEY");

const major = (version: string): string => version.split(".")[0] ?? "";

describe("PostgREST version pin vs the live stack", () => {
  it("matches the version the running PostgREST reports for itself", async () => {
    // Two independent channels, because one of them agreeing with the pin by coincidence is a
    // real possibility and two are not: the HTTP `Server` header, and the OpenAPI document the
    // root endpoint serves. They come from different parts of PostgREST.
    const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: ANON_KEY },
    });
    expect(response.ok, `GET /rest/v1/ failed: ${response.status}`).toBe(true);

    const serverHeader = response.headers.get("server") ?? "";
    expect(serverHeader, "no `Server: postgrest/...` header to measure").toMatch(/^postgrest\//);
    const fromHeader = serverHeader.replace(/^postgrest\//, "");

    const openapi = (await response.json()) as { info?: { version?: string } };
    const fromOpenApi = openapi.info?.version ?? "";
    expect(fromOpenApi, "OpenAPI document carried no info.version").not.toBe("");

    // The two channels must agree with each other before either is used as evidence.
    expect(major(fromHeader)).toBe(major(fromOpenApi));

    expect(
      major(POSTGREST_VERSION),
      `gen-db-types POSTGREST_VERSION is pinned at "${POSTGREST_VERSION}" but the stack reports ` +
        `"${fromHeader}" — re-derive the constant from the stack rather than editing this test.`,
    ).toBe(major(fromHeader));
  });
});
