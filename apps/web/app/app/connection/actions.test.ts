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
  };
});
vi.mock("@pseo/db/api-keys-repo", () => ({
  countActiveKeys: vi.fn(),
  createKey: vi.fn(),
  getKeyOwner: vi.fn(),
  revokeKey: vi.fn(),
}));

/** The fake `gsc_connections` table: rows, the filters each statement carried, and the ops. */
interface GscRow {
  id: string;
  user_id: string;
  project_id: string;
  encrypted_refresh_token: string | null;
}
type Filter = { column: string; value: unknown };
let gscRows: GscRow[] = [];
let gscTables: string[] = [];
let gscSelectFilters: Filter[] = [];
let gscDeleteFilters: Filter[] = [];
let gscOps: string[] = [];

/** A statement reaches a row only when EVERY filter it carried matches — like PostgREST. */
function matches(row: GscRow, filters: Filter[]): boolean {
  return filters.every((f) => (row as unknown as Record<string, unknown>)[f.column] === f.value);
}

/**
 * A PostgREST-ish gsc_connections builder. The store module (NOT mocked here) runs for real
 * against it, so a forgotten tenant filter would be VISIBLE: an unfiltered delete would take
 * another user's row out of `gscRows` and fail the isolation spec.
 */
function gscTable() {
  return {
    select: () => {
      const filters: Filter[] = [];
      const chain = {
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return chain;
        },
        maybeSingle: async () => {
          gscSelectFilters = filters;
          gscOps.push("select");
          const row = gscRows.find((candidate) => matches(candidate, filters)) ?? null;
          return {
            data: row ? { id: row.id, encrypted_refresh_token: row.encrypted_refresh_token } : null,
            error: null,
          };
        },
      };
      return chain;
    },
    delete: () => {
      const filters: Filter[] = [];
      const chain = {
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return chain;
        },
        then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          gscDeleteFilters = filters;
          gscOps.push("delete");
          gscRows = gscRows.filter((row) => !matches(row, filters));
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
      return gscTable();
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
import { encryptToken, generateApiKey, toByteaHex } from "@pseo/core";
import { countActiveKeys, createKey, getKeyOwner, revokeKey } from "@pseo/db/api-keys-repo";
import {
  createKeyAction,
  disconnectGscAction,
  revokeKeyAction,
  rotateKeyAction,
} from "./actions";

const generateApiKeyMock = vi.mocked(generateApiKey);
const countActiveKeysMock = vi.mocked(countActiveKeys);
const createKeyMock = vi.mocked(createKey);
const getKeyOwnerMock = vi.mocked(getKeyOwner);
const revokeKeyMock = vi.mocked(revokeKey);

const SAMPLE = { key: "sg_PLAINTEXT", prefix: "sg_PLAINTE", hash: "hash-abc" };
const KEY_ID = "11111111-1111-4111-8111-111111111111";
const NEW_ID = "22222222-2222-4222-8222-222222222222";

function createdRow(id: string) {
  return { id, keyPrefix: SAMPLE.prefix, createdAt: "2026-07-01T00:00:00.000Z", revokedAt: null };
}
function signedIn(userId: string) {
  getUser.mockResolvedValue({ data: { user: { id: userId } } });
}
function signedOut() {
  getUser.mockResolvedValue({ data: { user: null } });
}

describe("connection server actions", () => {
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
      getKeyOwnerMock.mockResolvedValue("someone-else");
      await expect(rotateKeyAction(KEY_ID)).rejects.toThrow(/not found/i);
      expect(createKeyMock).not.toHaveBeenCalled();
      expect(revokeKeyMock).not.toHaveBeenCalled();
      expect(captureKeyCreated).not.toHaveBeenCalled();
    });

    it("rejects a malformed key id without querying the DB", async () => {
      signedIn("user-1");
      await expect(rotateKeyAction("not-a-uuid")).rejects.toThrow(/not found/i);
      expect(getKeyOwnerMock).not.toHaveBeenCalled();
      expect(createKeyMock).not.toHaveBeenCalled();
      expect(captureKeyCreated).not.toHaveBeenCalled();
    });

    it("is EXEMPT from the active-key cap: rotates even at the limit, without a count read", async () => {
      signedIn("user-1");
      getKeyOwnerMock.mockResolvedValue("user-1");
      // At (indeed over) the cap — rotate must still succeed (it's net-neutral on the count).
      countActiveKeysMock.mockResolvedValue(99);
      generateApiKeyMock.mockReturnValue(SAMPLE);
      createKeyMock.mockResolvedValue(createdRow(NEW_ID));
      revokeKeyMock.mockResolvedValue(undefined);

      const result = await rotateKeyAction(KEY_ID);

      expect(result.key).toBe("sg_PLAINTEXT");
      expect(revokeKeyMock).toHaveBeenCalledWith(expect.anything(), KEY_ID);
      // Rotate never consults the cap — the exemption is in the code path, not just the number.
      expect(countActiveKeysMock).not.toHaveBeenCalled();
      expect(captureKeyCreated).toHaveBeenCalledWith("user-1", true);
    });

    it("mints the new key BEFORE revoking the old one", async () => {
      signedIn("user-1");
      getKeyOwnerMock.mockResolvedValue("user-1");
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
      getKeyOwnerMock.mockResolvedValue("user-1");
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
      getKeyOwnerMock.mockResolvedValue("user-1");
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
      getKeyOwnerMock.mockResolvedValue("someone-else");
      await expect(revokeKeyAction(KEY_ID)).rejects.toThrow(/not found/i);
      expect(revokeKeyMock).not.toHaveBeenCalled();
    });

    it("revokes a key the session user owns", async () => {
      signedIn("user-1");
      getKeyOwnerMock.mockResolvedValue("user-1");
      await revokeKeyAction(KEY_ID);
      expect(revokeKeyMock).toHaveBeenCalledWith(expect.anything(), KEY_ID);
      // Revocation is not a key-creation event — never fires mcp_key_created.
      expect(captureKeyCreated).not.toHaveBeenCalled();
    });
  });
});

/**
 * Disconnect: revoke the grant at Google, then drop the row. The store module runs for REAL
 * against the fake table above, so these specs prove the tenant filters on the actual
 * statements — not on a stub that was told what to return.
 */
describe("disconnectGscAction", () => {
  const ENC_KEY = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  const OTHER_KEY = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  const PROJECT = "33333333-3333-4333-8333-333333333333";
  const REFRESH_TOKEN = "1//the-refresh-token";

  /** Seal a token exactly the way the OAuth callback stored it (real crypto). */
  function sealed(token: string, keyHex = ENC_KEY): string {
    return toByteaHex(encryptToken(token, keyHex));
  }

  function linkedRow(userId: string, token: string | null = sealed(REFRESH_TOKEN)): GscRow {
    return { id: "conn-1", user_id: userId, project_id: PROJECT, encrypted_refresh_token: token };
  }

  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY);
    revokeGoogleToken.mockImplementation(async () => {
      gscOps.push("revoke");
      return true;
    });
  });

  // resetAllMocks (as in the key-action suite): the specs install their own revoke
  // implementations, which must not leak — nor may a call history — into the next test.
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    gscRows = [];
    gscTables = [];
    gscSelectFilters = [];
    gscDeleteFilters = [];
    gscOps = [];
  });

  it("rejects with no session and never touches the connection", async () => {
    signedOut();
    gscRows = [linkedRow("user-1")];

    await expect(disconnectGscAction(PROJECT)).rejects.toThrow(/not authenticated/i);

    expect(gscTables).toEqual([]);
    expect(gscRows).toHaveLength(1);
    expect(revokeGoogleToken).not.toHaveBeenCalled();
  });

  it("rejects a malformed project id without querying the DB", async () => {
    signedIn("user-1");

    await expect(disconnectGscAction("not-a-uuid")).rejects.toThrow(/not found/i);

    expect(gscTables).toEqual([]);
    expect(revokeGoogleToken).not.toHaveBeenCalled();
  });

  it("cannot reach ANOTHER user's connection: opaque error, nothing revoked, row survives", async () => {
    signedIn("user-1");
    // Held by reference: each seal uses a fresh random IV, so the row is compared as-is.
    const otherTenantRow = linkedRow("user-2");
    gscRows = [otherTenantRow];

    await expect(disconnectGscAction(PROJECT)).rejects.toThrow(/not found/i);

    // Scoped by the SESSION user (never a client-supplied id) plus the project.
    expect(gscSelectFilters).toEqual([
      { column: "user_id", value: "user-1" },
      { column: "project_id", value: PROJECT },
    ]);
    expect(gscOps).toEqual(["select"]); // no delete statement was ever issued
    expect(gscRows).toEqual([otherTenantRow]); // the other tenant's row is untouched
    expect(revokeGoogleToken).not.toHaveBeenCalled();
  });

  it("revokes the DECRYPTED token at Google, THEN deletes the row (both tenant filters)", async () => {
    signedIn("user-1");
    const row = linkedRow("user-1");
    gscRows = [row];

    await disconnectGscAction(PROJECT);

    // Google gets the opened plaintext — never the stored ciphertext.
    expect(revokeGoogleToken).toHaveBeenCalledWith(REFRESH_TOKEN);
    expect(revokeGoogleToken).not.toHaveBeenCalledWith(row.encrypted_refresh_token);
    expect(gscOps).toEqual(["select", "revoke", "delete"]);
    expect(gscDeleteFilters).toEqual([
      { column: "user_id", value: "user-1" },
      { column: "project_id", value: PROJECT },
    ]);
    expect(gscRows).toEqual([]); // the row (and with it the sealed token) is gone
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/app/connection");
  });

  it("still deletes locally when Google refuses the revoke (best-effort semantics)", async () => {
    signedIn("user-1");
    gscRows = [linkedRow("user-1")];
    revokeGoogleToken.mockImplementation(async () => {
      gscOps.push("revoke");
      return false; // e.g. Google answered 400 invalid_token, or the request failed
    });

    await expect(disconnectGscAction(PROJECT)).resolves.toBeUndefined();

    expect(gscOps).toEqual(["select", "revoke", "delete"]);
    expect(gscRows).toEqual([]);
  });

  it("deletes without calling Google when the row holds no token", async () => {
    signedIn("user-1");
    gscRows = [linkedRow("user-1", null)];

    await disconnectGscAction(PROJECT);

    expect(revokeGoogleToken).not.toHaveBeenCalled();
    expect(gscRows).toEqual([]);
  });

  it("an unopenable seal (rotated key) skips the revoke but still frees the user", async () => {
    signedIn("user-1");
    gscRows = [linkedRow("user-1", sealed(REFRESH_TOKEN, OTHER_KEY))];

    await disconnectGscAction(PROJECT);

    expect(revokeGoogleToken).not.toHaveBeenCalled();
    expect(gscRows).toEqual([]);
  });

  it("fails CLOSED when TOKEN_ENCRYPTION_KEY is MALFORMED: nothing revoked, nothing deleted", async () => {
    signedIn("user-1");
    // Present but mis-provisioned (63 hex chars). This is a CONFIG fault, not the per-row
    // "seal won't open" case below — it must not fall through to a revoke-less deletion.
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY.slice(0, 63));
    gscRows = [linkedRow("user-1")];

    await expect(disconnectGscAction(PROJECT)).rejects.toThrow(/64 hex characters/i);

    expect(revokeGoogleToken).not.toHaveBeenCalled();
    expect(gscOps).toEqual(["select"]);
    expect(gscRows).toHaveLength(1);
  });

  it("fails CLOSED when TOKEN_ENCRYPTION_KEY is missing: nothing revoked, nothing deleted", async () => {
    signedIn("user-1");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    gscRows = [linkedRow("user-1")];

    await expect(disconnectGscAction(PROJECT)).rejects.toThrow(/not configured/i);

    expect(revokeGoogleToken).not.toHaveBeenCalled();
    expect(gscOps).toEqual(["select"]);
    expect(gscRows).toHaveLength(1);
  });
});
