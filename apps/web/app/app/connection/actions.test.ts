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

vi.mock("@pseo/db/server", async () => {
  const { fakeDbServerModule } = await import("./fixtures/fake-db");
  return fakeDbServerModule();
});

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
import { db, filtersOf, type Row } from "./fixtures/fake-db";
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

  /**
   * A project row as `projects` really holds one. `archived_at` is ALWAYS present — writing the
   * column out is not decoration: `unmapProject`'s archive gate reads it, and a fixture that
   * omitted it would let the gate be judged against a shape production never produces (the
   * tolerant-double trap, signed lesson 12).
   */
  function projectRow(userId: string, archivedAt: string | null = null): Row {
    return { id: PROJECT, user_id: userId, domain: "alpha.example", archived_at: archivedAt };
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
      db.ops.push("revoke");
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
    db.rows = { gsc_accounts: [], gsc_connections: [], projects: [] };
    db.errors = {};
    db.tables = [];
    db.statements = [];
    db.ops = [];
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
      db.rows = { gsc_accounts: [account], gsc_connections: [connectionRow(PROJECT, "user-1")] };

      await unmapProject(PROJECT);

      expect(revokeGoogleToken).not.toHaveBeenCalled();
      // Nor is the credential even READ: no statement touches gsc_accounts, so the account
      // row (and every other project hanging off it) is untouched by a per-project unmap.
      // `projects` IS read — that is the archive gate below, and it reads no credential.
      expect(db.tables).toEqual(["projects", "gsc_connections"]);
      expect(db.rows.gsc_accounts).toEqual([account]);
    });

    it("clears account_id and gsc_property but KEEPS the connection row", async () => {
      signedIn("user-1");
      db.rows = {
        gsc_accounts: [accountRow("user-1")],
        gsc_connections: [connectionRow(PROJECT, "user-1")],
        // A TRACKED project, seeded rather than absent: this is the positive half of the
        // archive gate below, and without a row here the gate would never be exercised at all.
        projects: [projectRow("user-1")],
      };

      await unmapProject(PROJECT);

      expect(db.ops).toEqual(["select:projects", "update:gsc_connections"]);
      expect(db.rows.gsc_connections).toEqual([connectionRow(PROJECT, "user-1", null, null)]);
      expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/app/connection");
    });

    // Moved from the retired `disconnectGscAction` cross-tenant spec and re-aimed at the
    // UPDATE. There is no longer an error to make opaque — the statement simply cannot reach
    // a foreign row — which is strictly stronger: nothing is leaked because nothing is found.
    it("cannot reach ANOTHER user's project: both tenant filters ride on the UPDATE", async () => {
      signedIn("user-1");
      const otherTenantRow = connectionRow(PROJECT, "user-2");
      db.rows = { gsc_accounts: [], gsc_connections: [otherTenantRow] };

      await unmapProject(PROJECT);

      expect(filtersOf("gsc_connections", "update")).toEqual([
        { column: "user_id", value: "user-1" },
        { column: "project_id", value: PROJECT },
      ]);
      expect(db.rows.gsc_connections).toEqual([otherTenantRow]);
    });

    it("rejects with no session and never touches the connection", async () => {
      signedOut();
      db.rows = { gsc_accounts: [], gsc_connections: [connectionRow(PROJECT, "user-1")] };

      await expect(unmapProject(PROJECT)).rejects.toThrow(/not authenticated/i);

      expect(db.tables).toEqual([]);
      expect(db.rows.gsc_connections).toEqual([connectionRow(PROJECT, "user-1")]);
    });

    it("refuses a malformed project id without querying the DB", async () => {
      signedIn("user-1");

      await expect(unmapProject("not-a-uuid")).resolves.toEqual({
        ok: false,
        error: expect.stringMatching(/not found/i),
      });

      expect(db.tables).toEqual([]);
    });

    // MOVED from lib/gsc/store.test.ts ("throws when the update fails"), re-aimed at the
    // UPDATE that replaced the retired module's. A swallowed failure here is worse than a
    // loud one: the action would report success, the page would re-render as unlinked, and
    // the project would go on reading Search Console through a mapping the user believes is
    // gone. PostgREST's own text stays server-side — the browser gets a sentence, the log
    // gets the diagnosis (mutation: return `error.message` as the sentence and this goes red).
    it("a failed UPDATE refuses instead of reporting a silent unmap", async () => {
      signedIn("user-1");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      db.rows = { gsc_accounts: [], gsc_connections: [connectionRow(PROJECT, "user-1")] };
      db.errors = { "update:gsc_connections": { message: "no upd" } };

      const result = await unmapProject(PROJECT);

      expect(result).toEqual({ ok: false, error: expect.stringMatching(/could not disconnect/i) });
      expect(result.ok === false && result.error).not.toMatch(/no upd/);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("unmap failed"), "no upd");
      errorSpy.mockRestore();
      // The mapping is untouched — the state the refusal is telling the truth about.
      expect(db.rows.gsc_connections).toEqual([connectionRow(PROJECT, "user-1")]);
      expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    });

    /**
     * THE ARCHIVE ROW'S PROMISE, defended where it can actually be broken. /app/connection
     * renders an archived project as "Keeps {property}" — the retained mapping is the whole
     * reason untracking archives instead of deleting. Nothing in the archive UI offers this
     * action, so the way in is a STALE TAB rendered while the project was still tracked; one
     * click there used to null `gsc_property` and falsify that sentence for a row the user is
     * no longer looking at.
     *
     * MUTATION (run, not assumed): delete the `archivedAt !== null` refusal in `unmapProject`
     * and this goes red on the row assertion — the UPDATE lands and `gsc_property` becomes
     * null. Seeding the project row is what makes that reachable: the read is the gate.
     *
     * The sentence is RETURNED, and that half matters as much as the refusal: a thrown message
     * never reaches the browser in a production build, so the only reader of the way back
     * (Restore) would have been the server log.
     */
    it("refuses an ARCHIVED project and leaves its retained mapping intact", async () => {
      signedIn("user-1");
      db.rows = {
        gsc_accounts: [],
        gsc_connections: [connectionRow(PROJECT, "user-1")],
        projects: [projectRow("user-1", "2026-08-12T10:00:00.000Z")],
      };

      await expect(unmapProject(PROJECT)).resolves.toEqual({
        ok: false,
        error: expect.stringMatching(/archive.*restore it first/is),
      });

      expect(db.rows.gsc_connections).toEqual([connectionRow(PROJECT, "user-1")]);
      // It refused on the READ: no UPDATE was ever issued, so nothing had to be undone.
      expect(db.ops).toEqual(["select:projects"]);
      expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    });

    // ANOTHER TENANT'S archived project may not become a signal either. The read is filtered
    // on (id, user_id), so it comes back empty and this behaves exactly like an unknown id —
    // the same fall-through to an UPDATE that matches nothing. Dropping `.eq("user_id", …)`
    // from `readOwnProject` turns this into the archive refusal above, i.e. an oracle for
    // "that id exists and is archived, somewhere else" (NEVER #4).
    it("does not read another tenant's archive state through a shared project id", async () => {
      signedIn("user-1");
      const otherTenantRow = connectionRow(PROJECT, "user-2");
      db.rows = {
        gsc_accounts: [],
        gsc_connections: [otherTenantRow],
        projects: [projectRow("user-2", "2026-08-12T10:00:00.000Z")],
      };

      await expect(unmapProject(PROJECT)).resolves.toEqual({ ok: true });

      expect(db.ops).toEqual(["select:projects", "update:gsc_connections"]);
      expect(db.rows.gsc_connections).toEqual([otherTenantRow]);
    });
  });

  describe("disconnectAccount", () => {
    it("disconnecting an account revokes at Google and keeps every gsc_property", async () => {
      signedIn("user-1");
      db.rows = {
        gsc_accounts: [accountRow("user-1")],
        gsc_connections: connectionsFor("user-1", 3),
      };

      await disconnectAccount(ACCOUNT);

      expect(revokeGoogleToken).toHaveBeenCalledOnce();
      expect(db.rows.gsc_accounts).toEqual([]);
      // Migration 0021's whole point: the credential goes, the MAPPING stays. Every row keeps
      // its gsc_property and merely loses its account_id (`on delete set null`), which is the
      // exact state the migration itself produced — one reconnect, no re-picking properties.
      const connections = db.rows.gsc_connections;
      if (!connections) {
        throw new Error("expected db.rows.gsc_connections to be populated by the fake DB seed");
      }
      expect(connections).toHaveLength(3);
      expect(connections.every((row) => row.account_id === null)).toBe(true);
      expect(connections.every((row) => row.gsc_property === PROPERTY)).toBe(true);
    });

    // Moved from `disconnectGscAction`'s "revokes the DECRYPTED token … THEN deletes the row"
    // and re-aimed at the account axis: the secret now lives in gsc_accounts, and what goes to
    // Google is the token minted from it — never the stored ciphertext. Revoking an access
    // token revokes the whole grant, which is what Disconnect promises.
    it("revokes the token opened from gsc_accounts, THEN deletes the account row", async () => {
      signedIn("user-1");
      const row = accountRow("user-1");
      db.rows = { gsc_accounts: [row], gsc_connections: [] };

      const outcome = await disconnectAccount(ACCOUNT);

      // "revoked" is the ONE outcome that is a confirmed fact — Google acknowledged. It is
      // what entitles the UI to stay silent instead of warning the user (M-15).
      expect(outcome).toBe("revoked");
      expect(revokeGoogleToken).toHaveBeenCalledWith(ACCESS_TOKEN);
      expect(revokeGoogleToken).not.toHaveBeenCalledWith(row.encrypted_refresh_token);
      // Ownership read, then the credential read + status stamp inside accessTokenFor, then
      // the revoke, and only then the delete.
      expect(db.ops).toEqual([
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
      expect(db.rows.gsc_accounts).toEqual([]);
      expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/app/connection");
    });

    // M-15, moved verbatim in meaning from the project-level action. The local deletion still
    // happens — refusing to disconnect would trap the user — but the caller is told the
    // Google-side grant is UNCONFIRMED, so no UI can claim "access revoked" on the strength
    // of a call that failed.
    it("reports `unconfirmed` when Google does not acknowledge, and still deletes locally", async () => {
      signedIn("user-1");
      db.rows = { gsc_accounts: [accountRow("user-1")], gsc_connections: [] };
      const warn = captureConsole("warn");
      revokeGoogleToken.mockImplementation(async () => {
        db.ops.push("revoke");
        return false; // e.g. Google answered 400 invalid_token, or the request failed
      });

      await expect(disconnectAccount(ACCOUNT)).resolves.toBe("unconfirmed");

      expect(db.ops.at(-1)).toBe("delete:gsc_accounts");
      expect(db.rows.gsc_accounts).toEqual([]);
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
      db.rows = {
        gsc_accounts: [accountRow("user-1", sealedWithRetiredKey)],
        gsc_connections: [],
      };
      const error = captureConsole("error");

      await expect(disconnectAccount(ACCOUNT)).resolves.toBe("not_attempted");

      expect(revokeGoogleToken).not.toHaveBeenCalled();
      expect(db.rows.gsc_accounts).toEqual([]);
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
      db.rows = { gsc_accounts: [accountRow("user-1")], gsc_connections: [] };
      const error = captureConsole("error");
      vi.mocked(refreshAccessToken).mockRejectedValue(
        new Error("Google token endpoint failed (400): invalid_grant"),
      );

      await expect(disconnectAccount(ACCOUNT)).resolves.toBe("not_attempted");

      expect(revokeGoogleToken).not.toHaveBeenCalled();
      expect(db.rows.gsc_accounts).toEqual([]);
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
      db.rows = { gsc_accounts: [accountRow("user-1")], gsc_connections: [] };

      await expect(disconnectAccount(ACCOUNT)).rejects.toThrow(/64 hex characters/i);

      expect(revokeGoogleToken).not.toHaveBeenCalled();
      expect(db.ops).toEqual(["select:gsc_accounts"]);
      expect(db.rows.gsc_accounts).toHaveLength(1);
    });

    it("fails CLOSED when TOKEN_ENCRYPTION_KEY is missing: nothing revoked, nothing deleted", async () => {
      signedIn("user-1");
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
      db.rows = { gsc_accounts: [accountRow("user-1")], gsc_connections: [] };

      await expect(disconnectAccount(ACCOUNT)).rejects.toThrow(/not configured/i);

      expect(revokeGoogleToken).not.toHaveBeenCalled();
      expect(db.ops).toEqual(["select:gsc_accounts"]);
      expect(db.rows.gsc_accounts).toHaveLength(1);
    });

    // Moved from the project-level action and re-aimed at the account. Same opaque message for
    // a missing account and another user's, so nothing about other users' accounts leaks — and
    // the foreign credential is neither revoked nor deleted.
    it("cannot reach ANOTHER user's account: opaque error, nothing revoked, row survives", async () => {
      signedIn("user-1");
      // Held by reference: each seal uses a fresh random IV, so the row is compared as-is.
      const otherTenantRow = accountRow("user-2");
      db.rows = { gsc_accounts: [otherTenantRow], gsc_connections: [] };

      await expect(disconnectAccount(ACCOUNT)).rejects.toThrow(/not found/i);

      // Scoped by the SESSION user (never a client-supplied id) plus the account.
      expect(filtersOf("gsc_accounts", "select")).toEqual([
        { column: "id", value: ACCOUNT },
        { column: "user_id", value: "user-1" },
      ]);
      expect(db.ops).toEqual(["select:gsc_accounts"]); // no delete statement was ever issued
      expect(db.rows.gsc_accounts).toEqual([otherTenantRow]);
      expect(revokeGoogleToken).not.toHaveBeenCalled();
    });

    it("rejects with no session and never touches the account", async () => {
      signedOut();
      db.rows = { gsc_accounts: [accountRow("user-1")], gsc_connections: [] };

      await expect(disconnectAccount(ACCOUNT)).rejects.toThrow(/not authenticated/i);

      expect(db.tables).toEqual([]);
      expect(db.rows.gsc_accounts).toHaveLength(1);
      expect(revokeGoogleToken).not.toHaveBeenCalled();
    });

    it("rejects a malformed account id without querying the DB", async () => {
      signedIn("user-1");

      await expect(disconnectAccount("not-a-uuid")).rejects.toThrow(/not found/i);

      expect(db.tables).toEqual([]);
      expect(revokeGoogleToken).not.toHaveBeenCalled();
    });

    // MOVED from lib/gsc/store.test.ts ("throws a clear error when the delete fails"),
    // re-aimed at the row that now holds the credential. The revoke has already happened by
    // then, so a swallowed delete error would return `revoked` while OUR copy of the sealed
    // token stayed in the table — the disconnect half-done and reported as done.
    it("a failed DELETE throws rather than reporting the disconnect as complete", async () => {
      signedIn("user-1");
      const row = accountRow("user-1");
      db.rows = { gsc_accounts: [row], gsc_connections: [] };
      db.errors = { "delete:gsc_accounts": { message: "no del" } };

      await expect(disconnectAccount(ACCOUNT)).rejects.toThrow(/delete failed: no del/);

      // The credential is still here — which is exactly what the throw is reporting. (The row
      // carries the fresh `token_checked_at` the successful refresh stamped on its way past.)
      const accounts = db.rows.gsc_accounts;
      if (!accounts) {
        throw new Error("expected db.rows.gsc_accounts to be populated by the fake DB seed");
      }
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({
        id: ACCOUNT,
        user_id: "user-1",
        encrypted_refresh_token: row.encrypted_refresh_token,
      });
    });
  });

  describe("describeDisconnect", () => {
    // Finding #63's other half: the old UI never said that disconnecting reaches beyond the
    // project in front of you. The number is the whole point of the sentence.
    it("the confirmation names how many projects it will affect", async () => {
      signedIn("user-1");
      db.rows = { gsc_accounts: [accountRow("user-1")], gsc_connections: connectionsFor("user-1", 5) };

      expect(await describeDisconnect(ACCOUNT)).toContain("5 project");
    });

    it("counts ONLY the caller's projects on THIS account (constitution NEVER #4)", async () => {
      signedIn("user-1");
      db.rows = {
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

    /**
     * THE PROMISE NOTHING IMPLEMENTS. The sentence used to end "Their property mappings are
     * kept, so you will not have to pick them anew" — zero clicks. The only writer of a
     * non-null `account_id` is saveProjectProperty, the picker's Save; the OAuth callback
     * writes no connection row at all, so reconnecting revives nothing by itself. A false
     * statement about the consequences of a security action, read at the moment of consent.
     *
     * Both halves are pinned: the property IS kept (that much was true), and reconnecting does
     * NOT switch it on. Neither may be dropped in favour of the other — the opposite
     * overclaim, "your mappings are gone", would be just as wrong.
     */
    it("promises no free revival: kept, yes — but saved once per project", async () => {
      signedIn("user-1");
      db.rows = { gsc_accounts: [accountRow("user-1")], gsc_connections: connectionsFor("user-1", 3) };

      const text = await describeDisconnect(ACCOUNT);

      expect(text).toMatch(/is kept/i); // the stored property really does survive
      expect(text).toMatch(/save it once per project/i); // and it takes a click each
      expect(text).toMatch(/does not switch it on by itself/i);
      expect(text).not.toMatch(/not have to pick/i); // the retired zero-click promise
    });

    it("says nothing about revocation being confirmed — it has not happened yet", async () => {
      signedIn("user-1");
      db.rows = { gsc_accounts: [accountRow("user-1")], gsc_connections: connectionsFor("user-1", 2) };

      const text = await describeDisconnect(ACCOUNT);

      expect(text).toContain("2 projects");
      expect(text).not.toMatch(/revoked/i); // future tense only: nothing is confirmed yet
      expect(revokeGoogleToken).not.toHaveBeenCalled();
    });

    it("rejects with no session and never queries", async () => {
      signedOut();
      await expect(describeDisconnect(ACCOUNT)).rejects.toThrow(/not authenticated/i);
      expect(db.tables).toEqual([]);
    });

    /**
     * The UUID_RE branch existed in code with no spec on it. It is the same opaque refusal
     * `disconnectAccount` gives, and it must come BEFORE any query: a malformed id is not a
     * lookup that happens to miss, and spending a statement on it would make the refusal
     * distinguishable by timing from a well-formed id that simply is not there.
     */
    it("refuses a malformed account id opaquely, before any query", async () => {
      signedIn("user-1");
      db.rows = { gsc_accounts: [accountRow("user-1")], gsc_connections: connectionsFor("user-1", 5) };

      await expect(describeDisconnect("not-a-uuid")).rejects.toThrow(/account not found/i);
      // Same sentence a real-but-missing account gets from disconnectAccount — nothing about
      // the id's fate leaks, and the count that would have been shown is never computed.
      expect(db.tables).toEqual([]);
    });

    /**
     * NO OWNERSHIP CHECK, BOUNDED CONSEQUENCE. Unlike `disconnectAccount`, this function does
     * not verify the account belongs to the caller — it relies on /app/connection handing it
     * ids from a tenant-filtered list (pinned in page.test.tsx). What that costs if the action
     * is invoked directly is exactly this: an uninformative sentence, never another tenant's
     * numbers. The foreign account here has FIVE mapped projects; the caller must be told zero.
     *
     * MUTATION TARGET: drop `.eq("user_id", userId)` from the count and this spec goes red —
     * the caller reads back a stranger's project count.
     */
    it("a foreign account counts ZERO, never the other tenant's real number", async () => {
      signedIn("user-1");
      db.rows = {
        gsc_accounts: [accountRow("user-2", sealed(REFRESH_TOKEN, "user-2"), OTHER_ACCOUNT)],
        gsc_connections: connectionsFor("user-2", 5, OTHER_ACCOUNT),
      };

      const text = await describeDisconnect(OTHER_ACCOUNT);

      expect(text).toContain("0 projects");
      expect(text).not.toContain("5 project");
    });

    // MOVED from lib/gsc/store.test.ts ("throws a clear error when the lookup fails"), which
    // pinned that a failed gsc_connections read is never mistaken for "no row". Here it is
    // load-bearing in a way it was not there: `count ?? 0` turns a NULL count into the number
    // this sentence shows the user, so a swallowed error would promise that ZERO projects are
    // affected right before the click that breaks all of them (finding #63's whole lesson).
    it("a failed count throws — it never becomes a promise that 0 projects are affected", async () => {
      signedIn("user-1");
      db.rows = { gsc_accounts: [accountRow("user-1")], gsc_connections: connectionsFor("user-1", 4) };
      db.errors = { "select:gsc_connections": { message: "boom" } };

      await expect(describeDisconnect(ACCOUNT)).rejects.toThrow(/count failed: boom/);
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

  /**
   * `archived_at` is ALWAYS written out, because production always has it: the fake projects
   * only the columns a statement asked for, so a fixture omitting it would hand
   * `saveProjectProperty` an `undefined` no real row can produce — and a double more tolerant
   * than the runtime is how a missing constraint turns into a passing test (signed lesson 12).
   */
  function projectRow(userId: string, archivedAt: string | null = null, id: string = PROJECT): Row {
    return { id, user_id: userId, domain: "alpha.example", archived_at: archivedAt };
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
    db.rows = {
      projects: [projectRow("user-1")],
      gsc_accounts: [accountRow("user-1")],
      gsc_connections: [],
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    db.rows = { gsc_accounts: [], gsc_connections: [], projects: [] };
    db.errors = {};
    db.tables = [];
    db.statements = [];
    db.ops = [];
  });

  /** Capture a server-side diagnostic instead of printing it into the test output. */
  function captureConsole(level: "warn" | "error") {
    return vi.spyOn(console, level).mockImplementation(() => {});
  }

  // The three specs the brief pins, verbatim in intent: listed, queryable, written.
  it("refuses a property the live account does not list", async () => {
    const out = await saveProjectProperty(PROJECT, ACCOUNT, "https://not-mine.com/", listing());
    expect(out).toEqual({ ok: false, error: expect.stringContaining("not listed") });
    expect(db.rows.gsc_connections).toEqual([]);
  });

  /**
   * THE SAME NEAR-MISS SUGGESTION `track_gsc_property` and `trackProperty` give, from the same
   * rule (`cosmeticPropertyMatch`, @pseo/core). The picker's own list is minutes old at best,
   * so a stale or hand-edited choice lands here; when it differs from a listed property only in
   * letter case or a trailing slash, the sentence says which one was meant.
   *
   * A suggestion is NOT a mapping: nothing is written.
   */
  it("suggests the listed property when only a cosmetic difference separates them", async () => {
    const slash = await saveProjectProperty(
      PROJECT,
      ACCOUNT,
      "https://a.com",
      listing({ siteUrl: "https://a.com/", permissionLevel: "siteOwner" }),
    );
    expect(slash).toEqual({
      ok: false,
      error: expect.stringContaining('Did you mean "https://a.com/"?'),
    });

    const upper = await saveProjectProperty(
      PROJECT,
      ACCOUNT,
      "SC-DOMAIN:Alpha.Example",
      listing({ siteUrl: "sc-domain:alpha.example", permissionLevel: "siteOwner" }),
    );
    expect(upper).toEqual({
      ok: false,
      error: expect.stringContaining('Did you mean "sc-domain:alpha.example"?'),
    });
    expect(db.rows.gsc_connections).toEqual([]);
  });

  /**
   * NEGATIVE — THE CROSS IS NEVER OFFERED. `sc-domain:alpha.example` and
   * `https://alpha.example/` are two DIFFERENT properties for one site, with different data and
   * different permissions. Offering one for the other would be a plausible-looking WRONG
   * suggestion, and this one is a click away from `saveProjectProperty` binding the project to
   * it — worse than no suggestion at all, because the mistake only surfaces when the data does
   * not make sense.
   */
  it("never suggests a domain property for a URL-prefix one, nor an unrelated property", async () => {
    const cross = await saveProjectProperty(
      PROJECT,
      ACCOUNT,
      "https://alpha.example/",
      listing({ siteUrl: "sc-domain:alpha.example", permissionLevel: "siteOwner" }),
    );
    expect(cross).toEqual({ ok: false, error: expect.stringContaining("not listed") });
    expect(cross).toEqual({ ok: false, error: expect.not.stringMatching(/did you mean/i) });

    const unrelated = await saveProjectProperty(
      PROJECT,
      ACCOUNT,
      "sc-domain:beta.example",
      listing(
        { siteUrl: "sc-domain:alpha.example", permissionLevel: "siteOwner" },
        { siteUrl: "https://alpha.example/", permissionLevel: "siteOwner" },
        { siteUrl: "sc-domain:beta.example.org", permissionLevel: "siteOwner" },
      ),
    );
    expect(unrelated).toEqual({ ok: false, error: expect.stringContaining("not listed") });
    expect(unrelated).toEqual({ ok: false, error: expect.not.stringMatching(/did you mean/i) });
    expect(db.rows.gsc_connections).toEqual([]);
  });

  /**
   * AN ARCHIVED PROJECT IS NOT A TARGET. The picker renders only for tracked projects, so this
   * arrives through a STALE TAB — and a mapping written onto a project the tenant put away is
   * state nothing will ever read, while the archive row goes on advertising a different stored
   * property. MCP already refuses the same request (ARCHIVED_PROJECT_MESSAGE); this is the web
   * wording of the one verdict.
   *
   * The refusal lands BEFORE Google: `listing` is deliberately given the property the caller
   * asks for, so a save that got as far as the listing would SUCCEED. Nothing but the archive
   * check can produce this refusal.
   *
   * MUTATION (run, not assumed): delete the `owned.archivedAt !== null` branch and this goes
   * red twice — `{ ok: true }` comes back and a `gsc_connections` row appears.
   */
  it("refuses a project sitting in the ARCHIVE, before it asks Google anything", async () => {
    db.rows = { ...db.rows, projects: [projectRow("user-1", "2026-08-12T10:00:00.000Z")] };
    const sites = [{ siteUrl: "https://a.com/", permissionLevel: "siteOwner" }];

    const out = await saveProjectProperty(PROJECT, ACCOUNT, "https://a.com/", listing(...sites));

    expect(out).toEqual({ ok: false, error: expect.stringMatching(/archive/i) });
    expect(db.rows.gsc_connections).toEqual([]);
    // Not one statement past the project read, so no credential was opened and no round trip
    // was spent on an answer that could not have changed the outcome.
    expect(db.ops).toEqual(["select:projects"]);
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it("refuses a property the account cannot QUERY", async () => {
    const sites = [{ siteUrl: "https://a.com/", permissionLevel: "siteUnverifiedUser" }];
    const out = await saveProjectProperty(PROJECT, ACCOUNT, "https://a.com/", listing(...sites));
    expect(out).toEqual({ ok: false, error: expect.stringContaining("cannot query") });
    expect(db.rows.gsc_connections).toEqual([]);
  });

  it("writes the mapping when the property is listed AND queryable", async () => {
    const sites = [{ siteUrl: "https://a.com/", permissionLevel: "siteOwner" }];
    expect(
      await saveProjectProperty(PROJECT, ACCOUNT, "https://a.com/", listing(...sites)),
    ).toEqual({ ok: true });
    expect(db.rows.gsc_connections).toEqual([
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
    expect(db.rows.gsc_connections).toEqual([]);
  });

  // Constitution NEVER #4. The service-role client bypasses RLS, so the tenant boundary is
  // the SESSION user id riding on the write — both as a column and as part of the conflict
  // target, which is what decides WHICH row an upsert lands on.
  it("writes with the SESSION user id and conflicts on (user_id, project_id)", async () => {
    await saveProjectProperty(
      PROJECT,
      ACCOUNT,
      "https://a.com/",
      listing({ siteUrl: "https://a.com/", permissionLevel: "siteFullUser" }),
    );

    expect(filtersOf("gsc_connections", "upsert")).toEqual([
      { column: "user_id", value: "user-1" },
      { column: "project_id", value: PROJECT },
    ]);
  });

  /**
   * A defence pin rather than a reachable state: `projects.id` is a primary key, so a row
   * belonging to user-2 for a project user-1 owns cannot arise in production. It is
   * constructible HERE, and that is the point — it makes the conflict target's tenant column
   * observable. With `user_id` in the target the write lands on a NEW row; without it, the
   * upsert merges into the foreign tenant's row and this spec goes red.
   */
  it("never merges into another tenant's row for the same project", async () => {
    const otherTenantRow = {
      id: "conn-other",
      user_id: "user-2",
      project_id: PROJECT,
      account_id: "99999999-9999-4999-8999-999999999999",
      gsc_property: "sc-domain:not-yours.example",
    };
    db.rows = { ...db.rows, gsc_connections: [otherTenantRow] };

    await saveProjectProperty(
      PROJECT,
      ACCOUNT,
      "https://a.com/",
      listing({ siteUrl: "https://a.com/", permissionLevel: "siteOwner" }),
    );

    expect(db.rows.gsc_connections).toContainEqual(otherTenantRow);
    expect(db.rows.gsc_connections).toHaveLength(2);
  });

  /**
   * A project id is a client-supplied value like any other. Without this gate the action
   * would happily write a `gsc_connections` row for (my user, someone else's project) — no
   * data leak, since every reader filters on user_id too, but a junk row that inflates the
   * blast-radius count `describeDisconnect` shows the user before they disconnect.
   */
  it("refuses a project the caller does not own — before it ever contacts Google", async () => {
    db.rows = { ...db.rows, projects: [projectRow("user-2")] };

    const out = await saveProjectProperty(
      PROJECT,
      ACCOUNT,
      "https://a.com/",
      listing({ siteUrl: "https://a.com/", permissionLevel: "siteOwner" }),
    );

    expect(out).toEqual({ ok: false, error: expect.stringContaining("not found") });
    expect(db.tables).toEqual(["projects"]); // the account was never even read
    expect(vi.mocked(refreshAccessToken)).not.toHaveBeenCalled();
    expect(db.rows.gsc_connections).toEqual([]);
  });

  // The same opaque refusal for another user's ACCOUNT: `accessTokenFor` filters on user_id,
  // so a foreign account id finds nothing to unseal.
  it("refuses another user's Google account and writes nothing", async () => {
    db.rows = { ...db.rows, gsc_accounts: [accountRow("user-2")] };
    const error = captureConsole("error");

    const out = await saveProjectProperty(
      PROJECT,
      ACCOUNT,
      "https://a.com/",
      listing({ siteUrl: "https://a.com/", permissionLevel: "siteOwner" }),
    );

    expect(out).toEqual({ ok: false, error: expect.any(String) });
    expect(db.rows.gsc_connections).toEqual([]);
    expect(error).toHaveBeenCalled();
  });

  /**
   * A dead credential must not become an exception the picker renders as "something went
   * wrong". The page's live fetch already fails for this account, but the token can die
   * between that render and this click — so the action answers with a sentence that names
   * the next step instead of throwing.
   */
  it("a dead token answers with a reconnect message, not an exception", async () => {
    const error = captureConsole("error");
    vi.mocked(refreshAccessToken).mockRejectedValue(
      new Error("Google token endpoint failed (400): invalid_grant"),
    );

    const out = await saveProjectProperty(
      PROJECT,
      ACCOUNT,
      "https://a.com/",
      listing({ siteUrl: "https://a.com/", permissionLevel: "siteOwner" }),
    );

    expect(out).toEqual({ ok: false, error: expect.stringContaining("Reconnect") });
    expect(db.rows.gsc_connections).toEqual([]);
    expect(error).toHaveBeenCalled();
    // The refusal never carries the credential into the user's browser.
    expect(JSON.stringify(out)).not.toContain(REFRESH_TOKEN);
  });

  it("rejects with no session and never queries", async () => {
    signedOut();
    await expect(
      saveProjectProperty(PROJECT, ACCOUNT, "https://a.com/", listing()),
    ).rejects.toThrow(/not authenticated/i);
    expect(db.tables).toEqual([]);
  });

  it("refuses malformed ids without querying the DB", async () => {
    expect(await saveProjectProperty("not-a-uuid", ACCOUNT, "https://a.com/", listing())).toEqual({
      ok: false,
      error: expect.stringContaining("not found"),
    });
    expect(await saveProjectProperty(PROJECT, "not-a-uuid", "https://a.com/", listing())).toEqual({
      ok: false,
      error: expect.stringContaining("not found"),
    });
    expect(db.tables).toEqual([]);
  });

  /**
   * The empty choice refuses BEFORE Google is asked, so there is no listing to correct from and
   * the sentence must carry NO suggestion. That was true only STRUCTURALLY until this pin — the
   * `listed` default is what makes it true, and nothing measured the default. MUTATION RUN:
   * `notListedMessage`'s default changed from `[]` to `["/"]` and this went red (`"/"` reduces
   * to the same empty cosmetic key, so the user was offered `Did you mean "/"?`).
   */
  it("refuses an empty property without contacting Google, and suggests nothing", async () => {
    const out = await saveProjectProperty(PROJECT, ACCOUNT, "", listing());
    expect(out).toEqual({ ok: false, error: expect.stringContaining("not listed") });
    expect(out).toEqual({ ok: false, error: expect.not.stringMatching(/did you mean/i) });
    expect(db.tables).toEqual([]);
  });

  /**
   * MOVED from lib/gsc/store.test.ts ("updates the existing row when one exists"), minus the
   * token half migration 0021 retired. Re-picking a property for an already-mapped project is
   * an ordinary thing to do, and `gsc_connections` is UNIQUE on (user_id, project_id) since
   * migration 0010: the write must MERGE onto the row that is already there. A plain insert
   * would raise a unique violation, and a conflict target missing `project_id` would leave the
   * old mapping behind — both invisible in a suite that only ever saves onto an empty table.
   */
  it("re-picking a property for an already-mapped project updates the SAME row", async () => {
    const existing = {
      id: "conn-1",
      user_id: "user-1",
      project_id: PROJECT,
      account_id: ACCOUNT,
      gsc_property: "sc-domain:old.example",
    };
    db.rows = { ...db.rows, gsc_connections: [existing] };

    expect(
      await saveProjectProperty(
        PROJECT,
        ACCOUNT,
        "https://a.com/",
        listing({ siteUrl: "https://a.com/", permissionLevel: "siteOwner" }),
      ),
    ).toEqual({ ok: true });

    expect(db.rows.gsc_connections).toEqual([{ ...existing, gsc_property: "https://a.com/" }]);
  });

  /**
   * MOVED from lib/gsc/store.test.ts ("throws when the upsert fails"). The disposition changed
   * with the caller — this action RETURNS its refusals — but the guarantee did not: a failed
   * write may never come back as `ok`, because the picker would then show the new property as
   * saved while the project kept reading the old one. The diagnosis goes to the log, and
   * Postgres's own message never reaches the browser.
   */
  it("a failed write answers ok:false — never a saved mapping — and keeps the message server-side", async () => {
    const error = captureConsole("error");
    db.errors = { "upsert:gsc_connections": { message: "deadlock detected" } };

    const out = await saveProjectProperty(
      PROJECT,
      ACCOUNT,
      "https://a.com/",
      listing({ siteUrl: "https://a.com/", permissionLevel: "siteOwner" }),
    );

    expect(out).toEqual({ ok: false, error: expect.stringContaining("Could not save") });
    expect(JSON.stringify(out)).not.toContain("deadlock detected");
    expect(db.rows.gsc_connections).toEqual([]);
    expect(error).toHaveBeenCalled();
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });
});
