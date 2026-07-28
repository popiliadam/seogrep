// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  deleteGscConnection,
  findGscConnection,
  upsertGscConnection,
  type GscConnectionWrite,
} from "./store";

/**
 * The connection write is a read-then-update/insert. These specs pin that logic against a
 * fake client: a re-link updates in place (one row), a first link inserts via an ON CONFLICT
 * (user_id, project_id) upsert (migration 0010 — merge on conflict so a concurrent first-link
 * racer can't open a second row), and a re-consent that returns NO new refresh token keeps the
 * stored token rather than nulling it.
 *
 * The disconnect pair (find + delete) is pinned here too, on the invariant that matters most:
 * BOTH tenant filters ride on every statement, so no query can reach another user's row
 * (constitution NEVER #4).
 */

interface FakeOpts {
  existing?: { id: string; encrypted_refresh_token?: string | null } | null;
  findError?: { message: string } | null;
  updateError?: { message: string } | null;
  upsertError?: { message: string } | null;
  deleteError?: { message: string } | null;
}

type Filter = { column: string; value: unknown };

function fakeClient(opts: FakeOpts = {}) {
  const calls = {
    upsert: [] as { row: unknown; options: unknown }[],
    update: [] as unknown[],
    updateWhereId: [] as unknown[],
    selectFilters: [] as Filter[],
    deleteFilters: [] as Filter[],
    deletes: 0,
  };
  const selectChain = {
    select: () => selectChain,
    eq: (column: string, value: unknown) => {
      calls.selectFilters.push({ column, value });
      return selectChain;
    },
    maybeSingle: async () => ({ data: opts.existing ?? null, error: opts.findError ?? null }),
  };
  // A PostgREST delete builder is thenable: `.delete().eq().eq()` resolves when awaited.
  const deleteChain = {
    eq: (column: string, value: unknown) => {
      calls.deleteFilters.push({ column, value });
      return deleteChain;
    },
    then: (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve({ error: opts.deleteError ?? null }).then(onFulfilled, onRejected),
  };
  const builder = {
    select: () => selectChain,
    delete: () => {
      calls.deletes += 1;
      return deleteChain;
    },
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

const REF = { userId: "u1", projectId: "p1" };
/** Both tenant coordinates, as the filters a statement must carry. */
const TENANT_FILTERS: Filter[] = [
  { column: "user_id", value: "u1" },
  { column: "project_id", value: "p1" },
];

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

describe("findGscConnection", () => {
  it("returns the row id + sealed token, read with BOTH tenant filters", async () => {
    const { client, calls } = fakeClient({
      existing: { id: "conn-9", encrypted_refresh_token: "\\xdeadbeef" },
    });

    const found = await findGscConnection(client, REF);

    expect(found).toEqual({ id: "conn-9", encryptedTokenHex: "\\xdeadbeef" });
    expect(calls.selectFilters).toEqual(TENANT_FILTERS);
  });

  it("returns null when the project is not linked (or the row is another user's)", async () => {
    const { client, calls } = fakeClient({ existing: null });

    await expect(findGscConnection(client, REF)).resolves.toBeNull();
    // Still scoped: absence is produced BY the filters, not by the caller trusting a row.
    expect(calls.selectFilters).toEqual(TENANT_FILTERS);
  });

  it("reports a null token for a row that never stored one", async () => {
    const { client } = fakeClient({ existing: { id: "conn-9", encrypted_refresh_token: null } });
    await expect(findGscConnection(client, REF)).resolves.toEqual({
      id: "conn-9",
      encryptedTokenHex: null,
    });
  });

  it("throws a clear error when the lookup fails", async () => {
    const { client } = fakeClient({ findError: { message: "boom" } });
    await expect(findGscConnection(client, REF)).rejects.toThrowError(/lookup failed: boom/);
  });
});

describe("deleteGscConnection", () => {
  it("deletes the ROW with BOTH tenant filters on the statement", async () => {
    const { client, calls } = fakeClient();

    await deleteGscConnection(client, REF);

    expect(calls.deletes).toBe(1);
    // The forged-project_id case is covered by the statement itself: user_id rides along, so
    // the DELETE can only ever match a row owned by the caller (constitution NEVER #4).
    expect(calls.deleteFilters).toEqual(TENANT_FILTERS);
    // Disconnect drops the row — it does not patch the token column and leave "connected".
    expect(calls.update).toHaveLength(0);
    expect(calls.upsert).toHaveLength(0);
  });

  it("throws a clear error when the delete fails", async () => {
    const { client } = fakeClient({ deleteError: { message: "no del" } });
    await expect(deleteGscConnection(client, REF)).rejects.toThrowError(/delete failed: no del/);
  });
});
