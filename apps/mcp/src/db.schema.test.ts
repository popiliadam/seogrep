import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCHEMA_SENTINEL_RPC, probeSchemaSentinel, type ServiceClient } from "./db.ts";

/**
 * CLOUD SCHEMA READINESS — the DB half (M-13 part 2), DB-less and deterministic so it runs in
 * the fast gate.
 *
 * Nothing in this repo ever tied a deploy to whether the CLOUD database had the migrations the
 * shipped code calls: code and migrations merge together, so Fly can start serving a build that
 * calls an RPC the cloud project does not have yet. `probeSchemaSentinel` is the reporting probe
 * that ends that blind flight, and these specs pin the two things it must never get wrong:
 *
 *   1. a DEFINITIVE "the object is not there" answer is `not_ready`;
 *   2. an AMBIGUOUS failure (network, timeout, permission, anything unrecognised) THROWS, so the
 *      caller can report `unknown` — it must never be flattened into `ready`. A green signal
 *      that reports what it did not measure is worse than no signal (signed lesson 7).
 *
 * A fake PostgREST builder stands in for the client: no database, no network.
 */

/** PostgREST's "no such function in the schema cache" code — the schema-is-behind answer. */
const PGRST_FUNCTION_NOT_FOUND = "PGRST202";
/** Postgres SQLSTATE 42883 (undefined_function) — the same answer, surfaced from the engine. */
const PG_UNDEFINED_FUNCTION = "42883";

interface RpcSink {
  name?: string;
  signal?: AbortSignal;
  calls: number;
}

/** A client whose `.rpc()` resolves to `outcome`, recording the name and any AbortSignal. */
function fakeClient(outcome: { data: number | null; error: unknown }, sink: RpcSink): ServiceClient {
  const builder = {
    abortSignal: (signal: AbortSignal) => {
      sink.signal = signal;
      return builder;
    },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(outcome).then(resolve),
  };
  return {
    rpc: (name: string) => {
      sink.name = name;
      sink.calls += 1;
      return builder;
    },
  } as unknown as ServiceClient;
}

const newSink = (): RpcSink => ({ calls: 0 });

describe("probeSchemaSentinel (cloud schema readiness probe)", () => {
  it("reports ready when the sentinel RPC answers", async () => {
    const sink = newSink();
    expect(await probeSchemaSentinel(fakeClient({ data: 0, error: null }, sink))).toBe("ready");
    expect(sink.name).toBe(SCHEMA_SENTINEL_RPC);
  });

  it.each([PGRST_FUNCTION_NOT_FOUND, PG_UNDEFINED_FUNCTION])(
    "reports not_ready when the database says the object is missing (%s)",
    async (code) => {
      const sink = newSink();
      const error = { code, message: `could not find the function (${code})` };
      expect(await probeSchemaSentinel(fakeClient({ data: null, error }, sink))).toBe("not_ready");
    },
  );

  it("THROWS on an ambiguous failure, so the caller reports unknown and never ready", async () => {
    const sink = newSink();
    const error = { code: "57014", message: "canceling statement due to statement timeout" };
    await expect(probeSchemaSentinel(fakeClient({ data: null, error }, sink))).rejects.toThrow(
      /schema readiness probe/,
    );
  });

  it("THROWS when the failure carries no code at all (a transport error is not an answer)", async () => {
    const sink = newSink();
    await expect(
      probeSchemaSentinel(fakeClient({ data: null, error: { message: "fetch failed" } }, sink)),
    ).rejects.toThrow(/schema readiness probe/);
  });

  it("passes the caller's AbortSignal down to the query (the deadline CANCELS the read)", async () => {
    const sink = newSink();
    const controller = new AbortController();
    expect(await probeSchemaSentinel(fakeClient({ data: 0, error: null }, sink), controller.signal)).toBe(
      "ready",
    );
    expect(sink.signal).toBe(controller.signal);
  });

  it("still works with no signal (the probe stays usable outside /status)", async () => {
    const sink = newSink();
    expect(await probeSchemaSentinel(fakeClient({ data: 0, error: null }, sink))).toBe("ready");
    expect(sink.signal).toBeUndefined();
  });
});

/**
 * ANTI-DRIFT PIN. apps/mcp deliberately does NOT depend on @pseo/db (it carries its own narrow
 * schema slice — see db.ts), so the sentinel's name is knowledge duplicated out of the migrations.
 * This pin is what stops the duplicate from drifting: rename or drop the function in the
 * migrations without updating SCHEMA_SENTINEL_RPC and the fast gate goes red, rather than
 * production quietly reporting `not_ready` forever against a schema that is perfectly fine.
 *
 * It asserts EXISTENCE, not a migration number: numbering belongs to packages/db and other
 * slices renumber around it, but the object's name is the contract this app actually calls.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../packages/db/supabase/migrations/", import.meta.url));

describe("the /status schema sentinel is pinned to the committed migrations", () => {
  it("is defined by exactly one committed migration", () => {
    const definitions = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .filter((file) =>
        readFileSync(`${MIGRATIONS_DIR}${file}`, "utf8").includes(
          `create function public.${SCHEMA_SENTINEL_RPC}(`,
        ),
      );
    expect(definitions).toHaveLength(1);
  });
});
