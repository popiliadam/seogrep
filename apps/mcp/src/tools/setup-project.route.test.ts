import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * setup_project THROUGH ITS WRAPPER — the gateway's half of the proof that both surfaces open
 * projects the same way.
 *
 * `openTrackedProject` moved to `@pseo/db/projects` and this module became a thin wrapper that
 * supplies the gateway's own service-role client. That wrapper is not free of risk: it could
 * hand over the wrong client, or a later edit could quietly re-implement the route here. So this
 * drives the TOOL (not the shared function) with the service client faked, and asserts the three
 * outcomes the route decides — created, existing, restored — plus the host gate.
 *
 * It lives in the FAST lane deliberately. `setup-project.db.test.ts` proves the same invariants
 * against a real Postgres, but that lane needs Docker and does not run in `verify.sh`; a
 * regression in the shared route would otherwise be invisible to the gate on this side while the
 * panel's specs (apps/web) went red alone.
 *
 * Zero network, zero DB (NEVER #5): the client is a stateful stand-in for the `projects` table.
 */

const getServiceClient = vi.hoisted(() => vi.fn());

vi.mock("../db.ts", () => ({ getServiceClient }));

const { setupProjectTool } = await import("./setup-project.ts");

interface ProjectRow {
  id: string;
  user_id: string;
  domain: string;
  archived_at: string | null;
}

/**
 * A strict stand-in for `projects` behind PostgREST: it APPLIES every `.eq()` (so dropping the
 * tenant filter changes what comes back), PROJECTS the selected columns, and honours
 * `ignoreDuplicates` on the (user_id, domain) conflict target. Signed lesson 12 — a double more
 * permissive than the runtime turns a missing constraint into a passing test.
 */
function makeProjectsStore(initial: readonly ProjectRow[] = []) {
  const rows: ProjectRow[] = initial.map((row) => ({ ...row }));
  const inserted: { user_id: string; domain: string }[] = [];
  let nextId = 1;

  const project = (row: ProjectRow, columns: string): Record<string, unknown> =>
    Object.fromEntries(
      columns
        .split(",")
        .map((column) => column.trim())
        .map((column) => [column, row[column as keyof ProjectRow]]),
    );

  const matching = (filters: readonly [string, unknown][]): ProjectRow[] =>
    rows.filter((row) =>
      filters.every(([column, value]) => row[column as keyof ProjectRow] === value),
    );

  function selectChain(columns: string) {
    const filters: [string, unknown][] = [];
    const chain = {
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return chain;
      },
      maybeSingle() {
        const hit = matching(filters)[0];
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
            hits.forEach((hit) => Object.assign(hit, patch));
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
        throw new Error(`setup_project must not touch "${table}"`);
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
                return options.ignoreDuplicates
                  ? Promise.resolve({ data: [], error: null })
                  : Promise.resolve({ data: null, error: { message: "duplicate key" } });
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

  return { client, rows, inserted };
}

const CTX = { userId: "user-1", keyId: "key-1" };
const ARCHIVED_AT = "2026-08-01T00:00:00.000Z";

/** Run the tool (through the registry's own dispatch) and return the text block it answered. */
async function run(domain: string): Promise<{ text: string; isError: boolean }> {
  const result = await setupProjectTool.run(CTX, { domain });
  const block = result.content[0];
  return {
    text: block && block.type === "text" ? block.text : JSON.stringify(result),
    isError: result.isError === true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setup_project opens projects through the shared route", () => {
  it("creates a project for a new domain, on the normalized form of what was typed", async () => {
    const store = makeProjectsStore();
    getServiceClient.mockReturnValue(store.client);

    const { text, isError } = await run("https://Example.com/blog?a=1");

    expect(isError).toBe(false);
    expect(text).toMatch(/created: true/i);
    expect(store.inserted).toEqual([{ user_id: "user-1", domain: "example.com" }]);
  });

  it("returns the existing project for a domain already tracked, writing nothing", async () => {
    const store = makeProjectsStore([
      { id: "p-1", user_id: "user-1", domain: "example.com", archived_at: null },
    ]);
    getServiceClient.mockReturnValue(store.client);

    const { text } = await run("example.com");

    expect(text).toMatch(/already exists/i);
    expect(text).toContain("p-1");
    expect(store.inserted).toEqual([]);
  });

  /**
   * THE ARCHIVE RULE, from the gateway. The same rule apps/web's add-domain.test.ts asserts from
   * the panel: two surfaces, one route, so removing the restore branch from the shared module
   * must turn BOTH red.
   */
  it("brings an archived domain back on its ORIGINAL id instead of opening a second one", async () => {
    const store = makeProjectsStore([
      { id: "p-archived", user_id: "user-1", domain: "example.com", archived_at: ARCHIVED_AT },
    ]);
    getServiceClient.mockReturnValue(store.client);

    const { text, isError } = await run("example.com");

    expect(isError).toBe(false);
    expect(text).toMatch(/restored/i);
    expect(text).toContain("p-archived");
    expect(store.inserted).toEqual([]);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.archived_at).toBeNull();
  });

  /**
   * The host gate lives INSIDE the shared route, so it applies here without this tool doing
   * anything. Asserted on the TABLE (nothing was written) rather than on the sentence, so an
   * implementation that echoes the refused host cannot satisfy it by wording alone.
   */
  it("opens no project for an internal / reserved host", async () => {
    const store = makeProjectsStore();
    getServiceClient.mockReturnValue(store.client);

    for (const host of ["foo.internal", "a.local", "b.test"]) {
      expect((await run(host)).isError).toBe(true);
    }
    expect(store.rows).toEqual([]);
  });

  /**
   * S4 — THE `www.` SPLIT, measured 6 times in one live account on 2026-08-25.
   *
   * `setup_project`'s own description promises "calling it again for the same domain returns the
   * existing project". For the form a customer pastes out of the address bar that promise was
   * FALSE: scheme, path and query were stripped, `www.` was not, and `https://www.seogrep.com/…`
   * opened a second project beside `seogrep.com`.
   *
   * All four spellings are driven against ONE store, so the assertion is not merely "each call
   * answered something" — the table ends with a single row.
   */
  it("lands every spelling of one site on ONE project, `www.` included", async () => {
    const store = makeProjectsStore();
    getServiceClient.mockReturnValue(store.client);

    const first = await run("example.com");
    expect(first.text).toMatch(/created: true/i);

    for (const spelling of ["www.example.com", "https://www.example.com/x?y=1", "EXAMPLE.COM"]) {
      const again = await run(spelling);
      expect(again.isError).toBe(false);
      expect(again.text).toMatch(/already exists/i);
      expect(again.text).toContain("new-1");
    }
    expect(store.rows).toHaveLength(1);
    expect(store.inserted).toEqual([{ user_id: "user-1", domain: "example.com" }]);
  });

  /**
   * WHICH FORM IS WRITTEN, not merely that one row results. Measured under mutation: with the
   * `www.` strip removed from the normalizer, the spec above STAYS GREEN — the route's `www.`
   * probe finds the canonical row that the first call happened to create, so the duplication is
   * hidden as long as the bare form is registered first. A customer who pastes the address-bar
   * form FIRST is the case that then goes wrong, and this is the spec that sees it.
   */
  it("stores the CANONICAL host even when the `www.` form is registered first", async () => {
    const store = makeProjectsStore();
    getServiceClient.mockReturnValue(store.client);

    const { text, isError } = await run("https://www.example.com/pricing?utm_source=chatgpt");

    expect(isError).toBe(false);
    expect(text).toMatch(/created: true/i);
    expect(store.inserted).toEqual([{ user_id: "user-1", domain: "example.com" }]);
    // …and the bare form then lands on it rather than opening its own row.
    expect((await run("example.com")).text).toMatch(/already exists/i);
    expect(store.rows).toHaveLength(1);
  });

  /**
   * THE SIX ROWS THAT ALREADY EXIST. This fix is forward-only — no migration rewrites
   * `www.noraninsaat.com` — so a stored `www.` domain has to stay REACHABLE from the canonical
   * host, or the first call after the deploy opens a seventh project next to it.
   *
   * The sentence names the domain AS STORED, because that is what list_projects shows.
   */
  it("finds a legacy `www.` project from the canonical host, and opens nothing", async () => {
    const store = makeProjectsStore([
      { id: "p-legacy", user_id: "user-1", domain: "www.noraninsaat.com", archived_at: null },
    ]);
    getServiceClient.mockReturnValue(store.client);

    const { text, isError } = await run("noraninsaat.com");

    expect(isError).toBe(false);
    expect(text).toMatch(/already exists/i);
    expect(text).toContain("p-legacy");
    expect(text).toContain("www.noraninsaat.com");
    expect(store.inserted).toEqual([]);
    expect(store.rows).toHaveLength(1);
  });

  it("restores a legacy `www.` project from the archive instead of opening a second one", async () => {
    const store = makeProjectsStore([
      { id: "p-legacy", user_id: "user-1", domain: "www.eykom.com", archived_at: ARCHIVED_AT },
    ]);
    getServiceClient.mockReturnValue(store.client);

    const { text, isError } = await run("https://eykom.com/");

    expect(isError).toBe(false);
    expect(text).toMatch(/restored/i);
    expect(text).toContain("p-legacy");
    expect(store.inserted).toEqual([]);
    expect(store.rows[0]?.archived_at).toBeNull();
  });

  /**
   * BOTH rows exist — the live account holds `seogrep.com` AND `www.seogrep.com`. Neither is
   * merged here (that is a separate, measured decision), but the answer must not depend on which
   * row a query happened to return first: every call lands on the CANONICAL one.
   */
  it("prefers the canonical row over its `www.` twin, on every call and both ways round", async () => {
    const store = makeProjectsStore([
      { id: "p-www", user_id: "user-1", domain: "www.seogrep.com", archived_at: null },
      { id: "p-bare", user_id: "user-1", domain: "seogrep.com", archived_at: null },
    ]);
    getServiceClient.mockReturnValue(store.client);

    for (const spelling of ["seogrep.com", "www.seogrep.com"]) {
      const { text } = await run(spelling);
      expect(text).toContain("p-bare");
      expect(text).not.toContain("p-www");
    }
    expect(store.inserted).toEqual([]);
  });

  /**
   * THE TRAP. `www.` is the ONLY label that may be dropped. A subdomain is a different website
   * with different content, and folding it into the apex would merge two customers' sites — a
   * far worse failure than the duplication being fixed.
   */
  it("keeps a subdomain distinct from the apex — only `www.` is cosmetic", async () => {
    const store = makeProjectsStore([
      { id: "p-apex", user_id: "user-1", domain: "example.com", archived_at: null },
    ]);
    getServiceClient.mockReturnValue(store.client);

    const { text } = await run("blog.example.com");

    expect(text).toMatch(/created: true/i);
    expect(text).not.toContain("p-apex");
    expect(store.inserted).toEqual([{ user_id: "user-1", domain: "blog.example.com" }]);
  });

  /**
   * NEVER #4: this client is service-role and bypasses RLS, so the `user_id` filter is the only
   * tenant boundary. Another tenant's archived row for the same domain must be invisible.
   */
  it("never resolves onto another tenant's row for the same domain", async () => {
    const store = makeProjectsStore([
      { id: "p-stranger", user_id: "user-2", domain: "example.com", archived_at: ARCHIVED_AT },
    ]);
    getServiceClient.mockReturnValue(store.client);

    const { text } = await run("example.com");

    expect(text).toMatch(/created: true/i);
    expect(store.rows.find((row) => row.id === "p-stranger")?.archived_at).toBe(ARCHIVED_AT);
  });
});
