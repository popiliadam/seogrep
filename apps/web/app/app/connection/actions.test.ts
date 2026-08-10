// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Server-action deps are mocked: no real service-role client, no live DB. These tests
// pin the two security invariants — session required, ownership enforced — plus the
// chef-mandated rotate order (mint new BEFORE revoking old).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Only the key helpers are faked; the rest of @pseo/core stays REAL (importOriginal), so
// the disconnect specs seal a token with the real AES-256-GCM crypto and prove the action
// hands GOOGLE the opened plaintext — not the stored ciphertext.
vi.mock("@pseo/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pseo/core")>();
  return {
    ...actual,
    generateApiKey: vi.fn(),
    mcpUrlFor: (key: string, template: string) => template.replace("{key}", key),
    mcpUrlTemplate: () => "https://mcp.seogrep.com/mcp/{key}",
    // The ONE network call inside `accessTokenFor` (constitution NEVER #5). Everything else
    // in lib/gsc/accounts.ts — the tenant-filtered reads, the v4 unseal, the status writes —
    // runs for REAL against the fake tables below.
    refreshAccessToken: vi.fn(),
  };
});
vi.mock("@pseo/db/api-keys-repo", () => ({
  countActiveKeys: vi.fn(),
  createKey: vi.fn(),
  listKeys: vi.fn(),
  revokeKey: vi.fn(),
}));

/** A fake row of either GSC table — column bag, so one builder serves both. */
type Row = Record<string, unknown>;
type Filter = { column: string; value: unknown };
/** One issued statement: which table, which verb, and every filter it carried. */
type Statement = { table: string; op: string; filters: Filter[] };

let dbRows: Record<string, Row[]> = { gsc_accounts: [], gsc_connections: [], projects: [] };
let gscTables: string[] = [];
let statements: Statement[] = [];
/** Every side effect in order, including the Google revoke — the ordering proof. */
let gscOps: string[] = [];

/** A statement reaches a row only when EVERY filter it carried matches — like PostgREST. */
function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => row[f.column] === f.value);
}

/** Return only the columns the statement asked for, as PostgREST does. */
function project(row: Row, columns: string): Row {
  const wanted = columns.split(",").map((column) => column.trim());
  return Object.fromEntries(wanted.map((column) => [column, row[column]]));
}

function record(table: string, op: string, filters: Filter[]): void {
  statements.push({ table, op, filters });
  gscOps.push(`${op}:${table}`);
}

/** The filters carried by the one statement of this shape — fails loudly if there are several. */
function filtersOf(table: string, op: string): Filter[] {
  const hits = statements.filter((s) => s.table === table && s.op === op);
  if (hits.length !== 1) {
    throw new Error(`expected exactly one ${op} on ${table}, saw ${hits.length}`);
  }
  return hits[0].filters;
}

/**
 * A PostgREST-ish builder over `dbRows`. `lib/gsc/accounts.ts` and the actions' own
 * gsc_connections statements (NOT mocked here) run for REAL against it, so a forgotten
 * tenant filter would be VISIBLE: an unfiltered delete would take another user's row out of
 * `dbRows` and fail the isolation specs below.
 *
 * The gsc_accounts DELETE also emulates migration 0021's `on delete set null` on
 * `gsc_connections.account_id`. That makes the "mappings survive" assertion meaningful about
 * THIS code — it proves the action nulls no `gsc_property` and deletes no connection row —
 * while the FK behaviour itself is pinned where it lives, in the migration's own db test.
 */
function fakeTable(table: string) {
  const rowsIn = (): Row[] => dbRows[table] ?? [];
  return {
    select: (columns: string, options: { count?: string; head?: boolean } = {}) => {
      const filters: Filter[] = [];
      const chain = {
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return chain;
        },
        maybeSingle: async () => {
          record(table, "select", filters);
          const row = rowsIn().find((candidate) => matches(candidate, filters)) ?? null;
          return { data: row ? project(row, columns) : null, error: null };
        },
        then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          record(table, "select", filters);
          const found = rowsIn().filter((row) => matches(row, filters));
          return Promise.resolve({
            data: options.head ? null : found.map((row) => project(row, columns)),
            count: options.count ? found.length : null,
            error: null,
          }).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
    update: (patch: Row) => {
      const filters: Filter[] = [];
      const chain = {
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return chain;
        },
        then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          record(table, "update", filters);
          dbRows = {
            ...dbRows,
            [table]: rowsIn().map((row) => (matches(row, filters) ? { ...row, ...patch } : row)),
          };
          return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
    /**
     * PostgREST `upsert(row, { onConflict })`. There is no `.eq()` to inspect here, so the
     * CONFLICT TARGET is recorded as this statement's filters — which is exactly what it is:
     * the columns that decide WHICH row a write lands on. Dropping `user_id` from either the
     * target or the payload therefore shows up as a missing/undefined filter (constitution
     * NEVER #4), and the merge below lands on a different row, so both halves are observable.
     */
    upsert: (payload: Row, options: { onConflict?: string } = {}) => {
      const target = (options.onConflict ?? "")
        .split(",")
        .map((column) => column.trim())
        .filter((column) => column.length > 0);
      record(
        table,
        "upsert",
        target.map((column) => ({ column, value: payload[column] })),
      );
      const rows = rowsIn();
      const conflicting =
        target.length > 0
          ? rows.find((row) => target.every((column) => row[column] === payload[column]))
          : undefined;
      dbRows = {
        ...dbRows,
        [table]: conflicting
          ? rows.map((row) => (row === conflicting ? { ...row, ...payload } : row))
          : [...rows, payload],
      };
      return Promise.resolve({ error: null });
    },
    delete: () => {
      const filters: Filter[] = [];
      const chain = {
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return chain;
        },
        then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          record(table, "delete", filters);
          const doomed = rowsIn().filter((row) => matches(row, filters));
          const survivors = rowsIn().filter((row) => !matches(row, filters));
          const orphaned = new Set(doomed.map((row) => row.id));
          const next = { ...dbRows, [table]: survivors };
          // Migration 0021: `on delete set null`, never cascade.
          dbRows =
            table === "gsc_accounts"
              ? {
                  ...next,
                  gsc_connections: (next.gsc_connections ?? []).map((row) =>
                    orphaned.has(row.account_id) ? { ...row, account_id: null } : row,
                  ),
                }
              : next;
          return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

vi.mock("@pseo/db/server", () => ({
  createServiceClient: vi.fn(() => ({
    from: (table: string) => {
      gscTables.push(table);
      return fakeTable(table);
    },
  })),
}));

const getUser = vi.fn();
vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

const captureKeyCreated = vi.fn();
vi.mock("../../../lib/analytics", () => ({
  captureKeyCreated: (userId: string, rotated: boolean) => captureKeyCreated(userId, rotated),
}));

// The ONE Google-touching call is faked here, so these specs make zero real requests
// (constitution NEVER #5); its own best-effort contract is pinned in lib/gsc/revoke.test.ts.
const revokeGoogleToken = vi.fn();
vi.mock("../../../lib/gsc/revoke", () => ({
  revokeGoogleToken: (...args: unknown[]) => revokeGoogleToken(...args),
}));

import { revalidatePath } from "next/cache";
import { encryptToken, generateApiKey, refreshAccessToken, toByteaHex } from "@pseo/core";
import { countActiveKeys, createKey, listKeys, revokeKey } from "@pseo/db/api-keys-repo";
import {
  createKeyAction,
  describeDisconnect,
  disconnectAccount,
  revokeKeyAction,
  rotateKeyAction,
  saveProjectProperty,
  unmapProject,
} from "./actions";

const generateApiKeyMock = vi.mocked(generateApiKey);
const countActiveKeysMock = vi.mocked(countActiveKeys);
const createKeyMock = vi.mocked(createKey);
const listKeysMock = vi.mocked(listKeys);
const revokeKeyMock = vi.mocked(revokeKey);

const SAMPLE = { key: "sg_PLAINTEXT", prefix: "sg_PLAINTE", hash: "hash-abc" };
const KEY_ID = "11111111-1111-4111-8111-111111111111";
const NEW_ID = "22222222-2222-4222-8222-222222222222";

function createdRow(id: string) {
  return { id, keyPrefix: SAMPLE.prefix, createdAt: "2026-07-01T00:00:00.000Z", revokedAt: null };
}
/** The same row after a revoke — what the owner's key list holds for a dead credential. */
function revokedRow(id: string) {
  return { ...createdRow(id), revokedAt: "2026-07-02T00:00:00.000Z" };
}
function signedIn(userId: string) {
  getUser.mockResolvedValue({ data: { user: { id: userId } } });
}
function signedOut() {
  getUser.mockResolvedValue({ data: { user: null } });
}

describe("connection server actions", () => {
  // Since M-22 the ownership check reads the caller's key list and requires the target to be
  // ACTIVE, so every rotate/revoke spec has to declare one. This default (the session user owns
  // KEY_ID and it is live) keeps the pre-M-22 expectations byte-identical; the specs that care
  // about a missing / foreign / revoked key override it. Harness only — no assertion moved.
  beforeEach(() => {
    listKeysMock.mockResolvedValue([createdRow(KEY_ID)]);
    countActiveKeysMock.mockResolvedValue(1);
  });
  // resetAllMocks (not clearAllMocks): the compensation tests install throwing
  // implementations on revokeKeyMock, which must not leak into later tests.
  afterEach(() => vi.resetAllMocks());

  describe("createKeyAction", () => {
    it("rejects with no session and never writes", async () => {
      signedOut();
      await expect(createKeyAction()).rejects.toThrow(/not authenticated/i);
      expect(createKeyMock).not.toHaveBeenCalled();
      expect(captureKeyCreated).not.toHaveBeenCalled();
    });

    it("mints for the session user and returns plaintext key + full MCP URL once", async () => {
      signedIn("user-1");
      countActiveKeysMock.mockResolvedValue(0);
      generateApiKeyMock.mockReturnValue(SAMPLE);
      createKeyMock.mockResolvedValue(createdRow(KEY_ID));

      const result = await createKeyAction();

      expect(createKeyMock).toHaveBeenCalledWith(expect.anything(), {
        userId: "user-1",
        keyHash: SAMPLE.hash,
        keyPrefix: SAMPLE.prefix,
      });
      expect(result).toEqual({
        key: "sg_PLAINTEXT",
        prefix: "sg_PLAINTE",
        mcpUrl: "https://mcp.seogrep.com/mcp/sg_PLAINTEXT",
      });
      expect(captureKeyCreated).toHaveBeenCalledWith("user-1", false);
    });

    it("allows a new key at the boundary (4 active < cap of 5)", async () => {
      signedIn("user-1");
      countActiveKeysMock.mockResolvedValue(4);
      generateApiKeyMock.mockReturnValue(SAMPLE);
      createKeyMock.mockResolvedValue(createdRow(KEY_ID));

      const result = await createKeyAction();

      expect(result.key).toBe("sg_PLAINTEXT");
      expect(createKeyMock).toHaveBeenCalledTimes(1);
    });

    it("rejects with a clear message at the active-key cap and never writes", async () => {
      signedIn("user-1");
      countActiveKeysMock.mockResolvedValue(5);

      await expect(createKeyAction()).rejects.toThrow(/5 active API keys, the maximum/i);
      expect(createKeyMock).not.toHaveBeenCalled();
      expect(captureKeyCreated).not.toHaveBeenCalled();
    });
  });

  describe("rotateKeyAction", () => {
    it("rejects when the target key belongs to another user", async () => {
      signedIn("user-1");
      listKeysMock.mockResolvedValue([]); // the tenant-filtered list cannot contain it
      await expect(rotateKeyAction(KEY_ID)).rejects.toThrow(/not found/i);
      expect(createKeyMock).not.toHaveBeenCalled();
      expect(revokeKeyMock).not.toHaveBeenCalled();
      expect(captureKeyCreated).not.toHaveBeenCalled();
    });

    it("rejects a malformed key id without querying the DB", async () => {
      signedIn("user-1");
      await expect(rotateKeyAction("not-a-uuid")).rejects.toThrow(/not found/i);
      expect(listKeysMock).not.toHaveBeenCalled();
      expect(createKeyMock).not.toHaveBeenCalled();
      expect(captureKeyCreated).not.toHaveBeenCalled();
    });

    // SPEC CHANGE (M-22), replacing "is EXEMPT from the active-key cap: rotates even at the
    // limit, without a count read", which asserted `countActiveKeys` was NEVER called. That
    // assertion pinned the bypass itself, so it could not survive the fix: with no count read
    // there was no ceiling above the mint. What the old test was PROTECTING — a user at the
    // limit can still roll their credential — is kept and still asserted here; only the claim
    // that rotate ignores the cap is gone. Strictly stronger: same success case, plus a
    // ceiling (the "already OVER the cap" spec below).
    it("still rotates a user sitting exactly AT the cap (rotation is net-neutral)", async () => {
      signedIn("user-1");
      countActiveKeysMock.mockResolvedValue(5); // exactly at the cap of 5
      generateApiKeyMock.mockReturnValue(SAMPLE);
      createKeyMock.mockResolvedValue(createdRow(NEW_ID));
      revokeKeyMock.mockResolvedValue(undefined);

      const result = await rotateKeyAction(KEY_ID);

      expect(result.key).toBe("sg_PLAINTEXT");
      expect(revokeKeyMock).toHaveBeenCalledWith(expect.anything(), KEY_ID);
      expect(captureKeyCreated).toHaveBeenCalledWith("user-1", true);
    });

    // M-22 (a): the ownership lookup used to answer "yes, yours" for an ALREADY-REVOKED key.
    // Rotate then minted a fresh key and "revoked" a row that was already revoked — a no-op —
    // so each replay of a rotate on one dead key id added an active key. That is the cap bypass:
    // net +1 per call, unbounded. A dead credential is not rotatable; it is Not found.
    it("refuses to rotate an ALREADY-REVOKED key: no mint, no net-positive rotation", async () => {
      signedIn("user-1");
      listKeysMock.mockResolvedValue([revokedRow(KEY_ID)]);
      generateApiKeyMock.mockReturnValue(SAMPLE);
      createKeyMock.mockResolvedValue(createdRow(NEW_ID));

      await expect(rotateKeyAction(KEY_ID)).rejects.toThrow(/not found/i);

      expect(createKeyMock).not.toHaveBeenCalled();
      expect(revokeKeyMock).not.toHaveBeenCalled();
      expect(captureKeyCreated).not.toHaveBeenCalled();
    });

    // M-22 (b): rotate skipped the cap read entirely, so the mint had no ceiling above it. The
    // count is now consulted BEFORE the mint — a refused rotation must never create a row first.
    it("refuses to rotate a user already OVER the cap, and refuses BEFORE minting", async () => {
      signedIn("user-1");
      countActiveKeysMock.mockResolvedValue(6); // cap is 5; this user is already past it
      generateApiKeyMock.mockReturnValue(SAMPLE);
      createKeyMock.mockResolvedValue(createdRow(NEW_ID));

      await expect(rotateKeyAction(KEY_ID)).rejects.toThrow(/maximum/i);

      expect(createKeyMock).not.toHaveBeenCalled();
      expect(revokeKeyMock).not.toHaveBeenCalled();
      expect(captureKeyCreated).not.toHaveBeenCalled();
    });

    it("mints the new key BEFORE revoking the old one", async () => {
      signedIn("user-1");
      generateApiKeyMock.mockReturnValue(SAMPLE);
      const order: string[] = [];
      createKeyMock.mockImplementation(async () => {
        order.push("create");
        return createdRow(NEW_ID);
      });
      revokeKeyMock.mockImplementation(async () => {
        order.push("revoke");
      });

      const result = await rotateKeyAction(KEY_ID);

      expect(order).toEqual(["create", "revoke"]);
      expect(revokeKeyMock).toHaveBeenCalledWith(expect.anything(), KEY_ID);
      expect(result.key).toBe("sg_PLAINTEXT");
      expect(captureKeyCreated).toHaveBeenCalledWith("user-1", true);
    });

    it("old-key revoke failure: back-revokes the NEW key, throws clean-failure, old key touched once", async () => {
      signedIn("user-1");
      generateApiKeyMock.mockReturnValue(SAMPLE);
      createKeyMock.mockResolvedValue(createdRow(NEW_ID));
      const revoked: string[] = [];
      revokeKeyMock.mockImplementation(async (_client, keyId) => {
        revoked.push(keyId);
        if (keyId === KEY_ID) throw new Error("db down");
      });

      // (b) The action rethrows a meaningful clean-failure error (old key still active).
      await expect(rotateKeyAction(KEY_ID)).rejects.toThrow(/existing key is unchanged/i);

      // (a) Compensation order: failed old-key attempt, then back-revoke of the new key.
      expect(revoked).toEqual([KEY_ID, NEW_ID]);
      // (c) Exactly ONE revoke attempt on the old key — no blind retry.
      expect(revoked.filter((id) => id === KEY_ID)).toHaveLength(1);
      // (d) The rotation ultimately failed — the user has no new usable key, so no funnel event.
      expect(captureKeyCreated).not.toHaveBeenCalled();
    });

    it("old-key revoke + compensation both fail: throws a partial-failure error, nothing further", async () => {
      signedIn("user-1");
      generateApiKeyMock.mockReturnValue(SAMPLE);
      createKeyMock.mockResolvedValue(createdRow(NEW_ID));
      revokeKeyMock.mockRejectedValue(new Error("db down"));

      await expect(rotateKeyAction(KEY_ID)).rejects.toThrow(/failed partway/i);
      // Old-key attempt + new-key compensation attempt only.
      expect(revokeKeyMock).toHaveBeenCalledTimes(2);
      expect(revokeKeyMock).toHaveBeenNthCalledWith(1, expect.anything(), KEY_ID);
      expect(revokeKeyMock).toHaveBeenNthCalledWith(2, expect.anything(), NEW_ID);
      expect(captureKeyCreated).not.toHaveBeenCalled();
    });
  });

  describe("revokeKeyAction", () => {
    it("rejects with no session and never writes", async () => {
      signedOut();
      await expect(revokeKeyAction(KEY_ID)).rejects.toThrow(/not authenticated/i);
      expect(revokeKeyMock).not.toHaveBeenCalled();
    });

    it("rejects revoking another user's key", async () => {
      signedIn("user-1");
      listKeysMock.mockResolvedValue([]); // the tenant-filtered list cannot contain it
      await expect(revokeKeyAction(KEY_ID)).rejects.toThrow(/not found/i);
      expect(revokeKeyMock).not.toHaveBeenCalled();
    });

    // M-22, same lookup: an already-revoked key is Not found rather than a silent second
    // revoke. Harmless on this path (revokeKey is idempotent), but the liveness requirement
    // belongs to the shared check, not to whichever caller happens to need it.
    it("rejects revoking an ALREADY-REVOKED key", async () => {
      signedIn("user-1");
      listKeysMock.mockResolvedValue([revokedRow(KEY_ID)]);
      await expect(revokeKeyAction(KEY_ID)).rejects.toThrow(/not found/i);
      expect(revokeKeyMock).not.toHaveBeenCalled();
    });

    it("revokes a key the session user owns", async () => {
      signedIn("user-1");
      await revokeKeyAction(KEY_ID);
      expect(revokeKeyMock).toHaveBeenCalledWith(expect.anything(), KEY_ID);
      // Revocation is not a key-creation event — never fires mcp_key_created.
      expect(captureKeyCreated).not.toHaveBeenCalled();
    });
  });
});


/**
 * TWO-LEVEL DISCONNECT (finding #63). Migration 0021 moved the Google credential from the
 * PROJECT axis (`gsc_connections.encrypted_refresh_token`, now dropped) to the ACCOUNT axis
 * (`gsc_accounts`), so one grant is shared by every project mapped to it. The old single
 * `disconnectGscAction` therefore revoked a SHARED grant from a per-project button, silently
 * killing the user's other projects. The two levels are now distinct, and the split IS the fix:
 *
 *   unmapProject(projectId)      — local only. Clears the project's `account_id` +
 *                                  `gsc_property`. NEVER contacts Google.
 *   disconnectAccount(accountId) — the credential level. Revokes at Google, then deletes the
 *                                  `gsc_accounts` row; `on delete set null` keeps every
 *                                  mapping (that is what migration 0021 protected).
 *   describeDisconnect(accountId)— the confirmation text, which must NAME the blast radius.
 *
 * `lib/gsc/accounts.ts` runs for REAL against the fake tables above (only its ONE network
 * call, `refreshAccessToken`, is stubbed), so these specs prove the tenant filters on the
 * actual statements — not on a stub that was told what to return.
 */
describe("two-level disconnect", () => {
  const ENC_KEY = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  const OTHER_KEY = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  const PROJECT = "33333333-3333-4333-8333-333333333333";
  const ACCOUNT = "44444444-4444-4444-8444-444444444444";
  const OTHER_ACCOUNT = "55555555-5555-4555-8555-555555555555";
  const REFRESH_TOKEN = "1//the-refresh-token";
  const ACCESS_TOKEN = "ya29.the-access-token";
  const PROPERTY = "sc-domain:alpha.example";

  /**
   * Seal a token exactly the way the OAuth callback stored it (real crypto). Crypto v4 binds
   * the blob to its `gsc_accounts` row's own (user, ACCOUNT) — the axis migration 0021 moved
   * the credential to — so the owner is part of sealing, not a detail. A pre-v4 (project-bound)
   * seal is not constructible here at all, which is the point: nothing in this suite can
   * accidentally re-create the format the migration retired.
   */
  function sealed(token: string, ownerUserId: string, keyHex = ENC_KEY): string {
    return toByteaHex(encryptToken(token, keyHex, { userId: ownerUserId, accountId: ACCOUNT }));
  }

  function accountRow(
    userId: string,
    token: string = sealed(REFRESH_TOKEN, userId),
    id: string = ACCOUNT,
  ): Row {
    return {
      id,
      user_id: userId,
      google_account_sub: "google-sub-1",
      google_account_email: "owner@example.com",
      encrypted_refresh_token: token,
      token_status: "active",
      token_checked_at: null,
    };
  }

  function connectionRow(
    projectId: string,
    userId: string,
    accountId: string | null = ACCOUNT,
    gscProperty: string | null = PROPERTY,
  ): Row {
    return {
      id: `conn-${projectId}`,
      user_id: userId,
      project_id: projectId,
      account_id: accountId,
      gsc_property: gscProperty,
    };
  }

  /** N mapped projects on one account — the blast radius `describeDisconnect` must name. */
  function connectionsFor(userId: string, count: number, accountId = ACCOUNT): Row[] {
    return Array.from({ length: count }, (_unused, index) =>
      connectionRow(`project-${index}`, userId, accountId),
    );
  }

  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY);
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: ACCESS_TOKEN,
      refreshToken: null,
      idToken: null,
      expiresIn: 3599,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      tokenType: "Bearer",
    });
    revokeGoogleToken.mockImplementation(async () => {
      gscOps.push("revoke");
      return true;
    });
  });

  /** Capture a server-side diagnostic instead of printing it into the test output. */
  function captureConsole(level: "warn" | "error") {
    return vi.spyOn(console, level).mockImplementation(() => {});
  }

  /** Every argument the diagnostic was given, flattened — what an operator would read. */
  function logged(spy: ReturnType<typeof captureConsole>): string {
    return spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
  }

  // resetAllMocks (as in the key-action suite): the specs install their own revoke
  // implementations, which must not leak — nor may a call history — into the next test.
  // restoreAllMocks additionally puts `console` back for the specs that spy on it.
  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    dbRows = { gsc_accounts: [], gsc_connections: [] };
    gscTables = [];
    statements = [];
    gscOps = [];
  });

  describe("unmapProject", () => {
    // RULING 1 / finding #63. A per-project action that revokes the SHARED grant is the bug
    // this whole task exists to fix, so "does not call Google" is not a detail of the current
    // implementation — it is the requirement. Asserted against the module-level
    // `revokeGoogleToken` mock, i.e. the real Google boundary: a call made from ANYWHERE in
    // this action's transitive path lands here, which an injected dependency could not see.
    it("unmapping a project NEVER calls Google", async () => {
      signedIn("user-1");
      // Held by reference: each seal uses a fresh random IV, so the row is compared as-is.
      const account = accountRow("user-1");
      dbRows = { gsc_accounts: [account], gsc_connections: [connectionRow(PROJECT, "user-1")] };

      await unmapProject(PROJECT);

      expect(revokeGoogleToken).not.toHaveBeenCalled();
      // Nor is the credential even READ: no statement touches gsc_accounts, so the account
      // row (and every other project hanging off it) is untouched by a per-project unmap.
      expect(gscTables).toEqual(["gsc_connections"]);
      expect(dbRows.gsc_accounts).toEqual([account]);
    });

    it("clears account_id and gsc_property but KEEPS the connection row", async () => {
      signedIn("user-1");
      dbRows = {
        gsc_accounts: [accountRow("user-1")],
        gsc_connections: [connectionRow(PROJECT, "user-1")],
      };

      await unmapProject(PROJECT);

      expect(gscOps).toEqual(["update:gsc_connections"]);
      expect(dbRows.gsc_connections).toEqual([connectionRow(PROJECT, "user-1", null, null)]);
      expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/app/connection");
    });

    // Moved from the retired `disconnectGscAction` cross-tenant spec and re-aimed at the
    // UPDATE. There is no longer an error to make opaque — the statement simply cannot reach
    // a foreign row — which is strictly stronger: nothing is leaked because nothing is found.
    it("cannot reach ANOTHER user's project: both tenant filters ride on the UPDATE", async () => {
      signedIn("user-1");
      const otherTenantRow = connectionRow(PROJECT, "user-2");
      dbRows = { gsc_accounts: [], gsc_connections: [otherTenantRow] };

      await unmapProject(PROJECT);

      expect(filtersOf("gsc_connections", "update")).toEqual([
        { column: "user_id", value: "user-1" },
        { column: "project_id", value: PROJECT },
      ]);
      expect(dbRows.gsc_connections).toEqual([otherTenantRow]);
    });

    it("rejects with no session and never touches the connection", async () => {
      signedOut();
      dbRows = { gsc_accounts: [], gsc_connections: [connectionRow(PROJECT, "user-1")] };

      await expect(unmapProject(PROJECT)).rejects.toThrow(/not authenticated/i);

      expect(gscTables).toEqual([]);
      expect(dbRows.gsc_connections).toEqual([connectionRow(PROJECT, "user-1")]);
    });

    it("rejects a malformed project id without querying the DB", async () => {
      signedIn("user-1");

      await expect(unmapProject("not-a-uuid")).rejects.toThrow(/not found/i);

      expect(gscTables).toEqual([]);
    });
  });

  describe("disconnectAccount", () => {
    it("disconnecting an account revokes at Google and keeps every gsc_property", async () => {
      signedIn("user-1");
      dbRows = {
        gsc_accounts: [accountRow("user-1")],
        gsc_connections: connectionsFor("user-1", 3),
      };

      await disconnectAccount(ACCOUNT);

      expect(revokeGoogleToken).toHaveBeenCalledOnce();
      expect(dbRows.gsc_accounts).toEqual([]);
      // Migration 0021's whole point: the credential goes, the MAPPING stays. Every row keeps
      // its gsc_property and merely loses its account_id (`on delete set null`), which is the
      // exact state the migration itself produced — one reconnect, no re-picking properties.
      expect(dbRows.gsc_connections).toHaveLength(3);
      expect(dbRows.gsc_connections.every((row) => row.account_id === null)).toBe(true);
      expect(dbRows.gsc_connections.every((row) => row.gsc_property === PROPERTY)).toBe(true);
    });

    // Moved from `disconnectGscAction`'s "revokes the DECRYPTED token … THEN deletes the row"
    // and re-aimed at the account axis: the secret now lives in gsc_accounts, and what goes to
    // Google is the token minted from it — never the stored ciphertext. Revoking an access
    // token revokes the whole grant, which is what Disconnect promises.
    it("revokes the token opened from gsc_accounts, THEN deletes the account row", async () => {
      signedIn("user-1");
      const row = accountRow("user-1");
      dbRows = { gsc_accounts: [row], gsc_connections: [] };

      const outcome = await disconnectAccount(ACCOUNT);

      // "revoked" is the ONE outcome that is a confirmed fact — Google acknowledged. It is
      // what entitles the UI to stay silent instead of warning the user (M-15).
      expect(outcome).toBe("revoked");
      expect(revokeGoogleToken).toHaveBeenCalledWith(ACCESS_TOKEN);
      expect(revokeGoogleToken).not.toHaveBeenCalledWith(row.encrypted_refresh_token);
      // Ownership read, then the credential read + status stamp inside accessTokenFor, then
      // the revoke, and only then the delete.
      expect(gscOps).toEqual([
        "select:gsc_accounts",
        "select:gsc_accounts",
        "update:gsc_accounts",
        "revoke",
        "delete:gsc_accounts",
      ]);
      expect(filtersOf("gsc_accounts", "delete")).toEqual([
        { column: "id", value: ACCOUNT },
        { column: "user_id", value: "user-1" },
      ]);
      expect(dbRows.gsc_accounts).toEqual([]);
      expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/app/connection");
    });

    // M-15, moved verbatim in meaning from the project-level action. The local deletion still
    // happens — refusing to disconnect would trap the user — but the caller is told the
    // Google-side grant is UNCONFIRMED, so no UI can claim "access revoked" on the strength
    // of a call that failed.
    it("reports `unconfirmed` when Google does not acknowledge, and still deletes locally", async () => {
      signedIn("user-1");
      dbRows = { gsc_accounts: [accountRow("user-1")], gsc_connections: [] };
      const warn = captureConsole("warn");
      revokeGoogleToken.mockImplementation(async () => {
        gscOps.push("revoke");
        return false; // e.g. Google answered 400 invalid_token, or the request failed
      });

      await expect(disconnectAccount(ACCOUNT)).resolves.toBe("unconfirmed");

      expect(gscOps.at(-1)).toBe("delete:gsc_accounts");
      expect(dbRows.gsc_accounts).toEqual([]);
      // The operator gets the diagnosis, keyed to the row, and never the secret itself.
      expect(logged(warn)).toMatch(ACCOUNT);
      expect(logged(warn)).toMatch(/not acknowledge/i);
      expect(logged(warn)).not.toMatch(REFRESH_TOKEN);
      expect(logged(warn)).not.toMatch(ACCESS_TOKEN);
    });

    // T5, moved and re-aimed: after a key retirement the seal will not open, so the revoke is
    // never even ATTEMPTED. The row still goes (the user asked to disconnect) but the skip must
    // be visible to an operator and must never be reported to the user as a revocation.
    it("an unopenable seal (rotated key) reports `not_attempted` and LOGS the skipped revoke", async () => {
      signedIn("user-1");
      const sealedWithRetiredKey = sealed(REFRESH_TOKEN, "user-1", OTHER_KEY);
      dbRows = {
        gsc_accounts: [accountRow("user-1", sealedWithRetiredKey)],
        gsc_connections: [],
      };
      const error = captureConsole("error");

      await expect(disconnectAccount(ACCOUNT)).resolves.toBe("not_attempted");

      expect(revokeGoogleToken).not.toHaveBeenCalled();
      expect(dbRows.gsc_accounts).toEqual([]);
      expect(logged(error)).toMatch(ACCOUNT);
      expect(logged(error)).toMatch(/skipped/i);
      // Neither the sealed bytes nor the key may reach the log.
      expect(logged(error)).not.toMatch(sealedWithRetiredKey);
      expect(logged(error)).not.toMatch(OTHER_KEY);
    });

    // REPLACES `disconnectGscAction`'s "deletes without calling Google when the row holds no
    // token". That case cannot exist on the new axis — `gsc_accounts.encrypted_refresh_token`
    // is NOT NULL (migration 0021) — so the tokenless row it described is unconstructible.
    // The real-world shape it protected (a credential we cannot use, and a user who must not
    // be trapped) survives as this: the refresh Google refuses.
    it("a credential Google has killed reports `not_attempted` and still deletes locally", async () => {
      signedIn("user-1");
      dbRows = { gsc_accounts: [accountRow("user-1")], gsc_connections: [] };
      const error = captureConsole("error");
      vi.mocked(refreshAccessToken).mockRejectedValue(
        new Error("Google token endpoint failed (400): invalid_grant"),
      );

      await expect(disconnectAccount(ACCOUNT)).resolves.toBe("not_attempted");

      expect(revokeGoogleToken).not.toHaveBeenCalled();
      expect(dbRows.gsc_accounts).toEqual([]);
      expect(logged(error)).toMatch(ACCOUNT);
      expect(logged(error)).toMatch(/skipped/i);
      expect(logged(error)).not.toMatch(REFRESH_TOKEN);
    });

    // Moved from the project-level action, unchanged in force: a mis-provisioned key is a
    // BROKEN DEPLOY, not a per-row fault, and silently dropping the credential while the
    // Google-side grant lives on would turn a config fault into a privacy fault (lesson #5).
    it("fails CLOSED when TOKEN_ENCRYPTION_KEY is MALFORMED: nothing revoked, nothing deleted", async () => {
      signedIn("user-1");
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY.slice(0, 63)); // present but 63 hex chars
      dbRows = { gsc_accounts: [accountRow("user-1")], gsc_connections: [] };

      await expect(disconnectAccount(ACCOUNT)).rejects.toThrow(/64 hex characters/i);

      expect(revokeGoogleToken).not.toHaveBeenCalled();
      expect(gscOps).toEqual(["select:gsc_accounts"]);
      expect(dbRows.gsc_accounts).toHaveLength(1);
    });

    it("fails CLOSED when TOKEN_ENCRYPTION_KEY is missing: nothing revoked, nothing deleted", async () => {
      signedIn("user-1");
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
      dbRows = { gsc_accounts: [accountRow("user-1")], gsc_connections: [] };

      await expect(disconnectAccount(ACCOUNT)).rejects.toThrow(/not configured/i);

      expect(revokeGoogleToken).not.toHaveBeenCalled();
      expect(gscOps).toEqual(["select:gsc_accounts"]);
      expect(dbRows.gsc_accounts).toHaveLength(1);
    });

    // Moved from the project-level action and re-aimed at the account. Same opaque message for
    // a missing account and another user's, so nothing about other users' accounts leaks — and
    // the foreign credential is neither revoked nor deleted.
    it("cannot reach ANOTHER user's account: opaque error, nothing revoked, row survives", async () => {
      signedIn("user-1");
      // Held by reference: each seal uses a fresh random IV, so the row is compared as-is.
      const otherTenantRow = accountRow("user-2");
      dbRows = { gsc_accounts: [otherTenantRow], gsc_connections: [] };

      await expect(disconnectAccount(ACCOUNT)).rejects.toThrow(/not found/i);

      // Scoped by the SESSION user (never a client-supplied id) plus the account.
      expect(filtersOf("gsc_accounts", "select")).toEqual([
        { column: "id", value: ACCOUNT },
        { column: "user_id", value: "user-1" },
      ]);
      expect(gscOps).toEqual(["select:gsc_accounts"]); // no delete statement was ever issued
      expect(dbRows.gsc_accounts).toEqual([otherTenantRow]);
      expect(revokeGoogleToken).not.toHaveBeenCalled();
    });

    it("rejects with no session and never touches the account", async () => {
      signedOut();
      dbRows = { gsc_accounts: [accountRow("user-1")], gsc_connections: [] };

      await expect(disconnectAccount(ACCOUNT)).rejects.toThrow(/not authenticated/i);

      expect(gscTables).toEqual([]);
      expect(dbRows.gsc_accounts).toHaveLength(1);
      expect(revokeGoogleToken).not.toHaveBeenCalled();
    });

    it("rejects a malformed account id without querying the DB", async () => {
      signedIn("user-1");

      await expect(disconnectAccount("not-a-uuid")).rejects.toThrow(/not found/i);

      expect(gscTables).toEqual([]);
      expect(revokeGoogleToken).not.toHaveBeenCalled();
    });
  });

  describe("describeDisconnect", () => {
    // Finding #63's other half: the old UI never said that disconnecting reaches beyond the
    // project in front of you. The number is the whole point of the sentence.
    it("the confirmation names how many projects it will affect", async () => {
      signedIn("user-1");
      dbRows = { gsc_accounts: [accountRow("user-1")], gsc_connections: connectionsFor("user-1", 5) };

      expect(await describeDisconnect(ACCOUNT)).toContain("5 project");
    });

    it("counts ONLY the caller's projects on THIS account (constitution NEVER #4)", async () => {
      signedIn("user-1");
      dbRows = {
        gsc_accounts: [accountRow("user-1")],
        gsc_connections: [
          connectionRow("mine", "user-1", ACCOUNT),
          connectionRow("mine-other-account", "user-1", OTHER_ACCOUNT),
          connectionRow("not-mine", "user-2", ACCOUNT),
        ],
      };

      const text = await describeDisconnect(ACCOUNT);

      expect(filtersOf("gsc_connections", "select")).toEqual([
        { column: "user_id", value: "user-1" },
        { column: "account_id", value: ACCOUNT },
      ]);
      // Singular, and the count excludes the other account's row AND the other tenant's.
      expect(text).toContain("1 project");
      expect(text).not.toContain("1 projects");
      expect(text).not.toContain("3 project");
    });

    it("says nothing about revocation being confirmed — it has not happened yet", async () => {
      signedIn("user-1");
      dbRows = { gsc_accounts: [accountRow("user-1")], gsc_connections: connectionsFor("user-1", 2) };

      const text = await describeDisconnect(ACCOUNT);

      expect(text).toContain("2 projects");
      expect(text).not.toMatch(/revoked/i); // future tense only: nothing is confirmed yet
      expect(revokeGoogleToken).not.toHaveBeenCalled();
    });

    it("rejects with no session and never queries", async () => {
      signedOut();
      await expect(describeDisconnect(ACCOUNT)).rejects.toThrow(/not authenticated/i);
      expect(gscTables).toEqual([]);
    });
  });
});

/**
 * THE PICKER'S SERVER HALF (Task 6). `resolveGscProperty` stopped DECIDING which property a
 * project reads and became a suggestion the user can override — so the decision moved to a
 * human, and the verification had to move to the server. This action is that verification:
 * it re-fetches `sites.list` LIVE and confirms the chosen property is both listed AND
 * queryable before it writes. A disabled `<option>` in the picker is a courtesy; the only
 * control is here, and these specs call the action directly (never through the UI) precisely
 * to prove that.
 *
 * `lib/gsc/accounts.ts` again runs for REAL against the fake tables, so the token unseal and
 * its tenant filter are exercised rather than stubbed; only `sites.list` is injected (deps)
 * and only `refreshAccessToken` is mocked — constitution NEVER #5, zero live calls.
 */
describe("saveProjectProperty", () => {
  const ENC_KEY = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  const PROJECT = "33333333-3333-4333-8333-333333333333";
  const ACCOUNT = "44444444-4444-4444-8444-444444444444";
  const REFRESH_TOKEN = "1//the-refresh-token";
  const ACCESS_TOKEN = "ya29.the-access-token";

  function accountRow(userId: string): Row {
    return {
      id: ACCOUNT,
      user_id: userId,
      google_account_sub: "google-sub-1",
      google_account_email: "owner@example.com",
      encrypted_refresh_token: toByteaHex(
        encryptToken(REFRESH_TOKEN, ENC_KEY, { userId, accountId: ACCOUNT }),
      ),
      token_status: "active",
      token_checked_at: null,
    };
  }

  function projectRow(userId: string, id: string = PROJECT): Row {
    return { id, user_id: userId, domain: "alpha.example" };
  }

  /** `sites.list` as Google answers it, injected so no request is ever made. */
  function listing(...sites: { siteUrl: string; permissionLevel: string }[]) {
    return { listSites: async () => sites };
  }

  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY);
    signedIn("user-1");
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: ACCESS_TOKEN,
      refreshToken: null,
      idToken: null,
      expiresIn: 3599,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      tokenType: "Bearer",
    });
    dbRows = {
      projects: [projectRow("user-1")],
      gsc_accounts: [accountRow("user-1")],
      gsc_connections: [],
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    dbRows = { gsc_accounts: [], gsc_connections: [], projects: [] };
    gscTables = [];
    statements = [];
    gscOps = [];
  });

  /** Capture a server-side diagnostic instead of printing it into the test output. */
  function captureConsole(level: "warn" | "error") {
    return vi.spyOn(console, level).mockImplementation(() => {});
  }

  // The three specs the brief pins, verbatim in intent: listed, queryable, written.
  it("refuses a property the live account does not list", async () => {
    const out = await saveProjectProperty(PROJECT, ACCOUNT, "https://not-mine.com/", listing());
    expect(out).toEqual({ ok: false, error: expect.stringContaining("not listed") });
    expect(dbRows.gsc_connections).toEqual([]);
  });

  it("refuses a property the account cannot QUERY", async () => {
    const sites = [{ siteUrl: "https://a.com/", permissionLevel: "siteUnverifiedUser" }];
    const out = await saveProjectProperty(PROJECT, ACCOUNT, "https://a.com/", listing(...sites));
    expect(out).toEqual({ ok: false, error: expect.stringContaining("cannot query") });
    expect(dbRows.gsc_connections).toEqual([]);
  });

  it("writes the mapping when the property is listed AND queryable", async () => {
    const sites = [{ siteUrl: "https://a.com/", permissionLevel: "siteOwner" }];
    expect(
      await saveProjectProperty(PROJECT, ACCOUNT, "https://a.com/", listing(...sites)),
    ).toEqual({ ok: true });
    expect(dbRows.gsc_connections).toEqual([
      {
        user_id: "user-1",
        project_id: PROJECT,
        account_id: ACCOUNT,
        gsc_property: "https://a.com/",
      },
    ]);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/app/connection");
  });

  /**
   * The listing is re-fetched from GOOGLE, not read back from what the page rendered. The
   * picker's own list is minutes old at best: a property can be removed, or an account's
   * permission downgraded, between the render and the click. Injecting a listing that
   * DISAGREES with a plausible UI state is the only way to see which of the two the server
   * believed.
   */
  it("trusts the LIVE listing, not the caller: a property removed since page load is refused", async () => {
    const out = await saveProjectProperty(
      PROJECT,
      ACCOUNT,
      "sc-domain:alpha.example",
      listing({ siteUrl: "https://beta.example/", permissionLevel: "siteOwner" }),
    );
    expect(out).toEqual({ ok: false, error: expect.stringContaining("not listed") });
    expect(dbRows.gsc_connections).toEqual([]);
  });
});
