import { afterEach, describe, expect, it, vi } from "vitest";

// Server-action deps are mocked: no real service-role client, no live DB. These tests
// pin the two security invariants — session required, ownership enforced — plus the
// chef-mandated rotate order (mint new BEFORE revoking old).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@pseo/core", () => ({
  generateApiKey: vi.fn(),
  mcpUrlFor: (key: string, template: string) => template.replace("{key}", key),
  mcpUrlTemplate: () => "https://mcp.seogrep.com/mcp/{key}",
}));
vi.mock("@pseo/db/api-keys-repo", () => ({
  createKey: vi.fn(),
  getKeyOwner: vi.fn(),
  revokeKey: vi.fn(),
}));
vi.mock("@pseo/db/server", () => ({ createServiceClient: vi.fn(() => ({})) }));

const getUser = vi.fn();
vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

const captureKeyCreated = vi.fn();
vi.mock("../../../lib/analytics", () => ({
  captureKeyCreated: (userId: string, rotated: boolean) => captureKeyCreated(userId, rotated),
}));

import { generateApiKey } from "@pseo/core";
import { createKey, getKeyOwner, revokeKey } from "@pseo/db/api-keys-repo";
import { createKeyAction, revokeKeyAction, rotateKeyAction } from "./actions";

const generateApiKeyMock = vi.mocked(generateApiKey);
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
