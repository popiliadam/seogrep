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
  afterEach(() => vi.clearAllMocks());

  describe("createKeyAction", () => {
    it("rejects with no session and never writes", async () => {
      signedOut();
      await expect(createKeyAction()).rejects.toThrow(/not authenticated/i);
      expect(createKeyMock).not.toHaveBeenCalled();
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
    });
  });

  describe("rotateKeyAction", () => {
    it("rejects when the target key belongs to another user", async () => {
      signedIn("user-1");
      getKeyOwnerMock.mockResolvedValue("someone-else");
      await expect(rotateKeyAction(KEY_ID)).rejects.toThrow(/not found/i);
      expect(createKeyMock).not.toHaveBeenCalled();
      expect(revokeKeyMock).not.toHaveBeenCalled();
    });

    it("rejects a malformed key id without querying the DB", async () => {
      signedIn("user-1");
      await expect(rotateKeyAction("not-a-uuid")).rejects.toThrow(/not found/i);
      expect(getKeyOwnerMock).not.toHaveBeenCalled();
      expect(createKeyMock).not.toHaveBeenCalled();
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
    });
  });
});
