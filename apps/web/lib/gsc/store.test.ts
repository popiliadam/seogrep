// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { upsertGscConnection, type GscConnectionWrite } from "./store";

/**
 * The connection upsert has no DB unique constraint to lean on (migration 0003/0009), so
 * it is a read-then-update/insert. These specs pin that logic against a fake client: a
 * re-link updates in place (one row), a first link inserts, and a re-consent that returns
 * NO new refresh token keeps the stored token rather than nulling it.
 */

interface FakeOpts {
  existing?: { id: string } | null;
  findError?: { message: string } | null;
  updateError?: { message: string } | null;
  insertError?: { message: string } | null;
}

function fakeClient(opts: FakeOpts = {}) {
  const calls = {
    insert: [] as unknown[],
    update: [] as unknown[],
    updateWhereId: [] as unknown[],
  };
  const selectChain = {
    select: () => selectChain,
    eq: () => selectChain,
    maybeSingle: async () => ({ data: opts.existing ?? null, error: opts.findError ?? null }),
  };
  const builder = {
    select: () => selectChain,
    update: (patch: unknown) => {
      calls.update.push(patch);
      return {
        eq: (_col: string, id: unknown) => {
          calls.updateWhereId.push(id);
          return Promise.resolve({ error: opts.updateError ?? null });
        },
      };
    },
    insert: (row: unknown) => {
      calls.insert.push(row);
      return Promise.resolve({ error: opts.insertError ?? null });
    },
  };
  const client = { from: vi.fn(() => builder) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, calls };
}

const WRITE: GscConnectionWrite = {
  userId: "u1",
  projectId: "p1",
  encryptedTokenHex: "\\xdeadbeef",
  gscProperty: "sc-domain:example.com",
};

describe("upsertGscConnection", () => {
  it("inserts a new connection when none exists", async () => {
    const { client, calls } = fakeClient({ existing: null });
    const outcome = await upsertGscConnection(client, WRITE);
    expect(outcome).toBe("inserted");
    expect(calls.insert).toEqual([
      {
        user_id: "u1",
        project_id: "p1",
        encrypted_refresh_token: "\\xdeadbeef",
        gsc_property: "sc-domain:example.com",
      },
    ]);
    expect(calls.update).toHaveLength(0);
  });

  it("updates the existing row (token + property) when one exists", async () => {
    const { client, calls } = fakeClient({ existing: { id: "conn-9" } });
    const outcome = await upsertGscConnection(client, WRITE);
    expect(outcome).toBe("updated");
    expect(calls.update).toEqual([
      { gsc_property: "sc-domain:example.com", encrypted_refresh_token: "\\xdeadbeef" },
    ]);
    expect(calls.updateWhereId).toEqual(["conn-9"]);
    expect(calls.insert).toHaveLength(0);
  });

  it("keeps the stored token when re-consent returns none, updating only the property", async () => {
    const { client, calls } = fakeClient({ existing: { id: "conn-9" } });
    const outcome = await upsertGscConnection(client, { ...WRITE, encryptedTokenHex: null });
    expect(outcome).toBe("kept");
    // The patch must NOT carry encrypted_refresh_token (nulling it would break the link).
    expect(calls.update).toEqual([{ gsc_property: "sc-domain:example.com" }]);
    expect(calls.updateWhereId).toEqual(["conn-9"]);
  });

  it("reports no_token when there is neither an existing row nor a new token", async () => {
    const { client, calls } = fakeClient({ existing: null });
    const outcome = await upsertGscConnection(client, { ...WRITE, encryptedTokenHex: null });
    expect(outcome).toBe("no_token");
    expect(calls.insert).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
  });

  it("throws a clear error when the lookup fails", async () => {
    const { client } = fakeClient({ findError: { message: "boom" } });
    await expect(upsertGscConnection(client, WRITE)).rejects.toThrowError(/lookup failed: boom/);
  });

  it("throws when the update fails", async () => {
    const { client } = fakeClient({ existing: { id: "c" }, updateError: { message: "no upd" } });
    await expect(upsertGscConnection(client, WRITE)).rejects.toThrowError(/update failed: no upd/);
  });

  it("throws when the insert fails", async () => {
    const { client } = fakeClient({ existing: null, insertError: { message: "no ins" } });
    await expect(upsertGscConnection(client, WRITE)).rejects.toThrowError(/insert failed: no ins/);
  });
});
