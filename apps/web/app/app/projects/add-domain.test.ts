import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the panel's Add-domain action actually DOES to the projects table, driven end to end
 * against a stateful stand-in for PostgREST.
 *
 * The action itself decides almost nothing — `openTrackedProject` (@pseo/db/projects) does, and
 * these specs run the REAL one (only the client underneath is faked). That is the point: the
 * panel and `setup_project` are supposed to be the same route, so the panel's specs assert the
 * route's invariants THROUGH the panel — the host gate, the archive restore on the ORIGINAL id,
 * the tenant boundary. Whether the action CALLS that route (rather than agreeing with it by
 * coincidence) is a different question, answered next door in add-domain-route-identity.test.ts.
 */

const { RedirectError } = vi.hoisted(() => {
  /** Stand-in for Next's NEXT_REDIRECT throw, carrying the URL the action chose. */
  class RedirectError extends Error {
    constructor(readonly url: string) {
      super(`NEXT_REDIRECT ${url}`);
    }
  }
  return { RedirectError };
});

const revalidatePath = vi.hoisted(() => vi.fn());
const getUser = vi.hoisted(() => vi.fn());
const serviceClient = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new RedirectError(url);
  },
}));
vi.mock("@pseo/db/server", () => ({ createServiceClient: () => serviceClient() }));
vi.mock("../../../lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser } }),
}));

const { addDomain } = await import("./actions");

interface ProjectRow {
  id: string;
  user_id: string;
  domain: string;
  archived_at: string | null;
}

/**
 * A stateful stand-in for the `projects` table behind PostgREST, and deliberately a STRICT one
 * (signed lesson 12: a double more permissive than the runtime turns a missing constraint into
 * a passing test). It:
 *
 *   - APPLIES every `.eq()` rather than merely recording it, so dropping the `user_id` filter
 *     changes what comes back — that is what makes the cross-tenant spec below mean anything;
 *   - PROJECTS the selected columns, so a statement that forgets `archived_at` hands the code
 *     `undefined` here exactly as the real one would;
 *   - honours `ignoreDuplicates` on the (user_id, domain) conflict target, which is the whole
 *     race-safety mechanism: a second insert for the same pair returns NO row;
 *   - errors on `.maybeSingle()` with more than one match, like PostgREST.
 *
 * Every write it accepts is also recorded, so a spec can assert that NOTHING was written — an
 * assertion about the table, not about a message.
 */
function makeProjectsStore(initial: readonly ProjectRow[] = []) {
  const rows: ProjectRow[] = initial.map((row) => ({ ...row }));
  const inserted: { user_id: string; domain: string }[] = [];
  const updated: { id: string; patch: Partial<ProjectRow> }[] = [];
  let nextId = 1;

  const project = (row: ProjectRow, columns: string): Record<string, unknown> =>
    Object.fromEntries(
      columns
        .split(",")
        .map((column) => column.trim())
        .map((column) => [column, row[column as keyof ProjectRow]]),
    );

  const matching = (filters: readonly [string, unknown][]): ProjectRow[] =>
    rows.filter((row) => filters.every(([column, value]) => row[column as keyof ProjectRow] === value));

  function selectChain(columns: string) {
    const filters: [string, unknown][] = [];
    const chain = {
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return chain;
      },
      maybeSingle() {
        const hits = matching(filters);
        if (hits.length > 1) {
          return Promise.resolve({ data: null, error: { message: "multiple rows returned" } });
        }
        const hit = hits[0];
        return Promise.resolve({ data: hit ? project(hit, columns) : null, error: null });
      },
    };
    return chain;
  }

  function updateChain(patch: Partial<ProjectRow>) {
    const filters: [string, unknown][] = [];
    const chain = {
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return chain;
      },
      select(columns: string) {
        return {
          maybeSingle() {
            const hits = matching(filters);
            for (const hit of hits) {
              Object.assign(hit, patch);
              updated.push({ id: hit.id, patch });
            }
            const hit = hits[0];
            return Promise.resolve({ data: hit ? project(hit, columns) : null, error: null });
          },
        };
      },
    };
    return chain;
  }

  const client = {
    from(table: string) {
      if (table !== "projects") {
        throw new Error(`the Add-domain action must not touch "${table}"`);
      }
      return {
        select: selectChain,
        update: updateChain,
        upsert(
          values: { user_id: string; domain: string },
          options: { onConflict: string; ignoreDuplicates: boolean },
        ) {
          return {
            select(columns: string) {
              const clash = rows.find(
                (row) => row.user_id === values.user_id && row.domain === values.domain,
              );
              if (clash) {
                if (!options.ignoreDuplicates) {
                  return Promise.resolve({
                    data: null,
                    error: { message: "duplicate key value violates unique constraint" },
                  });
                }
                return Promise.resolve({ data: [], error: null });
              }
              const row: ProjectRow = {
                id: `new-${nextId++}`,
                user_id: values.user_id,
                domain: values.domain,
                archived_at: null,
              };
              rows.push(row);
              inserted.push({ user_id: values.user_id, domain: values.domain });
              return Promise.resolve({ data: [project(row, columns)], error: null });
            },
          };
        },
      };
    },
  };

  return { client, rows, inserted, updated };
}

/** Submit the form and report the URL the action redirected to. */
async function submit(domain: unknown): Promise<string> {
  const form = new FormData();
  if (typeof domain === "string") {
    form.set("domain", domain);
  }
  try {
    await addDomain(form);
  } catch (error) {
    if (error instanceof RedirectError) {
      return error.url;
    }
    throw error;
  }
  throw new Error("addDomain returned without redirecting");
}

const TENANT = "user-1";
const ARCHIVED_AT = "2026-08-01T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: TENANT } } });
});

describe("addDomain writes through the shared project route", () => {
  it("creates a project for a new domain and reports it as created", async () => {
    const store = makeProjectsStore();
    serviceClient.mockReturnValue(store.client);

    const url = await submit("https://Example.com/blog?a=1");

    // The domain in the URL is the NORMALIZED one, not what was typed — so the banner names the
    // site the way every other surface does.
    expect(url).toBe("/app/projects?added=created&domain=example.com");
    expect(store.inserted).toEqual([{ user_id: TENANT, domain: "example.com" }]);
    expect(revalidatePath).toHaveBeenCalledWith("/app/projects");
  });

  it("reports an already-tracked domain as existing, and writes nothing", async () => {
    const store = makeProjectsStore([
      { id: "p-1", user_id: TENANT, domain: "example.com", archived_at: null },
    ]);
    serviceClient.mockReturnValue(store.client);

    expect(await submit("example.com")).toBe("/app/projects?added=existing&domain=example.com");
    expect(store.inserted).toEqual([]);
    expect(store.updated).toEqual([]);
  });

  /**
   * THE ARCHIVE RULE, from the panel. A domain the tenant archived comes back on its ORIGINAL
   * id — a second row is impossible (unique (user_id, domain), migration 0010) and would in any
   * case orphan the crawls, reports and Search Console mapping hanging off the first one.
   */
  it("restores an archived domain on the SAME id instead of opening a second project", async () => {
    const store = makeProjectsStore([
      { id: "p-archived", user_id: TENANT, domain: "example.com", archived_at: ARCHIVED_AT },
    ]);
    serviceClient.mockReturnValue(store.client);

    expect(await submit("example.com")).toBe("/app/projects?added=restored&domain=example.com");
    expect(store.inserted).toEqual([]);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.id).toBe("p-archived");
    expect(store.rows[0]?.archived_at).toBeNull();
  });

  /**
   * THE HOST GATE, from the panel — the reason this action opens no project of its own.
   *
   * Asserted on the TABLE and on the redirect CODE, never on the refusal sentence: a spec that
   * checked the message contained "foo.internal" would pass on any implementation that echoes
   * its input back, including one that echoes it and then inserts the row anyway. What is
   * actually at stake is that NOTHING was written.
   */
  it("opens no project at all for an internal / reserved host", async () => {
    const store = makeProjectsStore();
    serviceClient.mockReturnValue(store.client);

    for (const host of ["foo.internal", "metadata.google.internal", "a.local", "b.test"]) {
      expect(await submit(host)).toBe("/app/projects?error=invalid_domain");
    }
    expect(store.inserted).toEqual([]);
    expect(store.rows).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a missing or unusable field without touching the table", async () => {
    const store = makeProjectsStore();
    serviceClient.mockReturnValue(store.client);

    expect(await submit(undefined)).toBe("/app/projects?error=invalid_domain");
    expect(await submit("   ")).toBe("/app/projects?error=invalid_domain");
    expect(store.rows).toEqual([]);
  });

  /**
   * NEVER #4 through the panel. The client is service-role and bypasses RLS, so the only thing
   * separating two tenants who track the same site is the `user_id` filter on every read and
   * every write. Here ANOTHER tenant has archived example.com: the caller must get their OWN
   * new project, not the stranger's row un-archived.
   */
  it("never resolves onto another tenant's row for the same domain", async () => {
    const store = makeProjectsStore([
      { id: "p-stranger", user_id: "user-2", domain: "example.com", archived_at: ARCHIVED_AT },
    ]);
    serviceClient.mockReturnValue(store.client);

    expect(await submit("example.com")).toBe("/app/projects?added=created&domain=example.com");
    expect(store.updated).toEqual([]);
    expect(store.rows.find((row) => row.id === "p-stranger")?.archived_at).toBe(ARCHIVED_AT);
    expect(store.inserted).toEqual([{ user_id: TENANT, domain: "example.com" }]);
  });

  it("reports a failed statement as a retryable error rather than crashing the page", async () => {
    serviceClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq() {
            return this;
          },
          maybeSingle: () => Promise.resolve({ data: null, error: { message: "boom" } }),
        }),
      }),
    });

    expect(await submit("example.com")).toBe("/app/projects?error=failed");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("derives the tenant from the session, never from the form", async () => {
    const store = makeProjectsStore();
    serviceClient.mockReturnValue(store.client);
    getUser.mockResolvedValue({ data: { user: { id: "session-user" } } });

    const form = new FormData();
    form.set("domain", "example.com");
    form.set("user_id", "somebody-else");
    await expect(addDomain(form)).rejects.toBeInstanceOf(RedirectError);

    expect(store.inserted).toEqual([{ user_id: "session-user", domain: "example.com" }]);
  });

  it("throws rather than writing anything when there is no session", async () => {
    const store = makeProjectsStore();
    serviceClient.mockReturnValue(store.client);
    getUser.mockResolvedValue({ data: { user: null } });

    await expect(submit("example.com")).rejects.toThrow(/not authenticated/i);
    expect(store.rows).toEqual([]);
  });
});
