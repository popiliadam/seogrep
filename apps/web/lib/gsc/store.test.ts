// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { upsertGscConnection, type GscConnectionWrite } from "./store";

/**
 * The connection write is a read-then-update/insert. These specs pin that logic against a
 * fake client: a re-link updates in place (one row), a first link inserts via an ON CONFLICT
 * (user_id, project_id) upsert (migration 0010 — merge on conflict so a concurrent first-link
 * racer can't open a second row), and a re-consent that returns NO new refresh token keeps the
 * stored token rather than nulling it.
 */

interface FakeOpts {
  existing?: { id: string } | null;
  findError?: { message: string } | null;
  updateError?: { message: string } | null;
  upsertError?: { message: string } | null;
}

function fakeClient(opts: FakeOpts = {}) {
  const calls = {
    upsert: [] as { row: unknown; options: unknown }[],
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
    upsert: (row: unknown, options: unknown) => {
      calls.upsert.push({ row, options });
      return Promise.resolve({ error: opts.upsertError ?? null });
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
  it("inserts a new connection via an ON CONFLICT upsert when none exists", async () => {
    const { client, calls } = fakeClient({ existing: null });
    const outcome = await upsertGscConnection(client, WRITE);
    expect(outcome).toBe("inserted");
    expect(calls.upsert).toEqual([
      {
        row: {
          user_id: "u1",
          project_id: "p1",
          encrypted_refresh_token: "\\xdeadbeef",
          gsc_property: "sc-domain:example.com",
        },
        // Bound to the (user_id, project_id) conflict target so a concurrent racer merges
        // instead of opening a second row.
        options: { onConflict: "user_id,project_id" },
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
    expect(calls.upsert).toHaveLength(0);
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
    expect(calls.upsert).toHaveLength(0);
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

  it("throws when the upsert fails", async () => {
    const { client } = fakeClient({ existing: null, upsertError: { message: "no ins" } });
    await expect(upsertGscConnection(client, WRITE)).rejects.toThrowError(/insert failed: no ins/);
  });
});
