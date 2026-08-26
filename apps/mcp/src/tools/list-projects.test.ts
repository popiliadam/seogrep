import { describe, expect, it } from "vitest";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  duplicatePropertyNotes,
  JOB_SCOPE_NOTE,
  NO_PROJECTS_MESSAGE,
  NO_TRACKED_PROJECTS_MESSAGE,
  formatProjectList,
  listProjectsTool,
  type ProjectListRow,
} from "./list-projects.ts";

/**
 * Fast-lane specs for the four shapes list_projects can render — nothing at all, tracked only,
 * archive only, and both. The tenant-scoped READ is proven against real rows in
 * list-projects.db.test.ts; these pin the sentences, the two orderings, and the one message that
 * used to be false.
 */

function project(overrides: Partial<ProjectListRow> = {}): ProjectListRow {
  return {
    id: "p-1",
    domain: "example.com",
    created_at: "2026-01-01T00:00:00.000Z",
    archived_at: null,
    gsc: { kind: "not_connected" },
    lastJob: null,
    ...overrides,
  };
}

/** The `- domain (…)` lines of a rendered answer, in the order they were rendered. */
const bullets = (text: string): string[] => text.split("\n").filter((line) => line.startsWith("- "));

describe("list_projects stays free", () => {
  it("costs 0 credits", () => {
    expect(TOOL_COSTS.list_projects).toBe(0);
  });
});

describe("an account with nothing at all", () => {
  it("gets the create-your-first-project guidance, unchanged", () => {
    const text = formatProjectList([]);
    expect(text).toBe(NO_PROJECTS_MESSAGE);
    expect(text).toMatch(/no projects yet/i);
    expect(text).toMatch(/setup_project/);
  });
});

describe("the tracked section", () => {
  it("lists tracked projects oldest first, with their ids", () => {
    const text = formatProjectList([
      project({ id: "p-new", domain: "second.com", created_at: "2026-02-02T00:00:00.000Z" }),
      project({ id: "p-old", domain: "first.com", created_at: "2026-01-01T00:00:00.000Z" }),
    ]);
    expect(text).toMatch(/tracking 2 project/i);
    expect(bullets(text)[0]).toMatch(/first\.com/);
    expect(bullets(text)[1]).toMatch(/second\.com/);
    expect(text).toMatch(/p-old/);
    expect(text).toMatch(/p-new/);
  });

  /**
   * An account with no archive must read EXACTLY as it did before the archive section existed —
   * the overwhelmingly common case, and the one an extra heading would clutter for no one's
   * benefit.
   */
  it("renders nothing about an archive when there is none", () => {
    const text = formatProjectList([project()]);
    expect(text).toBe(
      "You are tracking 1 project(s):\n" +
        "- example.com (project_id: p-1) — Search Console: not connected · last job: none yet\n" +
        JOB_SCOPE_NOTE,
    );
  });
});

describe("the archive section", () => {
  it("lists archived projects separately, most recently archived first", () => {
    const text = formatProjectList([
      project({ id: "p-a", domain: "kept.com" }),
      project({
        id: "p-old-archive",
        domain: "long-gone.com",
        archived_at: "2026-03-01T00:00:00.000Z",
      }),
      project({
        id: "p-new-archive",
        domain: "just-left.com",
        archived_at: "2026-08-01T00:00:00.000Z",
      }),
    ]);
    // The tracked count counts only what is tracked — an archived row is not "1 more project".
    expect(text).toMatch(/tracking 1 project/i);
    expect(text).toMatch(/archived — 2 project/i);
    const archived = bullets(text).slice(1);
    expect(archived[0]).toMatch(/just-left\.com/);
    expect(archived[1]).toMatch(/long-gone\.com/);
  });

  /**
   * DONE_WHEN 2: visible AND restorable without recalling the exact domain. The line therefore has
   * to carry the id and the archive date, and the section has to name BOTH ways back —
   * `track_gsc_property` alone does not work for a project that never had a Search Console
   * property, which is every project created by `setup_project` and never connected.
   */
  it("gives an archived project its id, its date, and both routes back", () => {
    const text = formatProjectList([
      project({ id: "p-z", domain: "retired.com", archived_at: "2026-08-01T09:30:00.000Z" }),
    ]);
    expect(text).toMatch(/p-z/);
    expect(text).toMatch(/2026-08-01T09:30:00/);
    expect(text).toMatch(/setup_project/);
    expect(text).toMatch(/track_gsc_property/);
  });

  /**
   * THE SENTENCE THAT USED TO BE FALSE. A tenant whose only project is archived was told "No
   * projects yet" and pointed at creating a new one — the exact customer the archive read-back
   * exists for. The guidance must now say what is true, and must NOT be the empty-account
   * sentence.
   */
  it("does not tell a tenant with an archive that they have no projects", () => {
    const text = formatProjectList([
      project({ id: "p-z", domain: "retired.com", archived_at: "2026-08-01T00:00:00.000Z" }),
    ]);
    expect(text).not.toBe(NO_PROJECTS_MESSAGE);
    expect(text).not.toMatch(/no projects yet/i);
    expect(text).toContain(NO_TRACKED_PROJECTS_MESSAGE);
    expect(text).toMatch(/retired\.com/);
  });
});

describe("the tool description", () => {
  /**
   * Selection: a customer asking "what did I archive?" reaches this tool only if its tools/list
   * sentence says it answers that. The tracked half of the sentence — and its stated ordering —
   * is preserved design and is pinned alongside it.
   */
  it("advertises both the tracked list and the archive", () => {
    expect(listProjectsTool.description).toMatch(/oldest first/i);
    expect(listProjectsTool.description).toMatch(/archiv/i);
    // …and it does NOT put a restore verb here: that competes with the tools that restore.
    expect(listProjectsTool.description).not.toMatch(/bring .* back|restore/i);
  });
});


/**
 * G5 + G7 (operator-signed 2026-08-26). Every tracked line now carries the two facts a customer
 * with fifteen identical-looking domains actually needs: whether Search Console can be read for
 * it, and whether anything has ever run against it.
 *
 * THE POINT OF THESE SPECS IS THAT "CONNECTED" IS NOT A BOOLEAN. Live measurement on 2026-08-26
 * found a project (example.net) holding a gsc_connections row with a NULL gsc_property: a boolean
 * column would have printed a tick beside a project that can pull nothing at all. That is the
 * "unreported, never as a zero" promise on the connection axis, and it is pinned here as a
 * POSITION (a distinct third sentence), not as an absence.
 */
describe("the Search Console state on each tracked line", () => {
  it("names a live property", () => {
    const text = formatProjectList([
      project({ domain: "dentnotion.com", gsc: { kind: "connected", property: "sc-domain:dentnotion.com", expired: false } }),
    ]);
    expect(text).toMatch(/Search Console: sc-domain:dentnotion\.com/);
  });

  it("says a connection with no property selected is NOT usable, in its own words", () => {
    const text = formatProjectList([
      project({ domain: "example.net", gsc: { kind: "connected", property: null, expired: false } }),
    ]);
    expect(text).toMatch(/connected, no property selected/i);
    // …and it must not read like a working connection.
    expect(text).not.toMatch(/Search Console: example\.net/);
  });

  it("says plainly when there is no connection at all", () => {
    const text = formatProjectList([project({ domain: "seogrep.com" })]);
    expect(text).toMatch(/Search Console: not connected/i);
  });

  /**
   * Health is a DIFFERENT fact from the mapping: the property is still the right one, the
   * credential behind it is dead. It is appended to the mapping rather than replacing it, so a
   * reconnect does not look like a re-mapping.
   */
  it("flags a dead credential without hiding which property it belongs to", () => {
    const text = formatProjectList([
      project({ gsc: { kind: "connected", property: "https://a.com/", expired: true } }),
    ]);
    expect(text).toMatch(/https:\/\/a\.com\//);
    expect(text).toMatch(/reconnect/i);
  });

  it("never calls an unconnected project expired", () => {
    const text = formatProjectList([project({ gsc: { kind: "not_connected" } })]);
    expect(text).not.toMatch(/reconnect/i);
  });
});

describe("the last-job fact on each tracked line", () => {
  it("names the tool and the day, not a bare timestamp", () => {
    const text = formatProjectList([
      project({ lastJob: { tool: "crawl_site", at: "2026-08-26T10:36:21.643Z" } }),
    ]);
    expect(text).toMatch(/last job: crawl_site 2026-08-26/);
  });

  it("says none yet rather than printing a zero or an empty date", () => {
    const text = formatProjectList([project({ lastJob: null })]);
    expect(text).toMatch(/last job: none yet/);
    expect(text).not.toMatch(/last job: (0|-|null|undefined)/);
  });

  /**
   * KAPSAM: `jobs` holds background runs only — measured 2026-08-26, its `tool` column carries
   * exactly crawl_site and pull_gsc_data. A project audited ten times and never crawled reads
   * "none yet", which is TRUE of jobs and FALSE of activity, so the answer says which one it
   * means — once, under the list, rather than on every line.
   */
  it("states what a job is, once, under the tracked list", () => {
    const text = formatProjectList([project(), project({ id: "p-2", domain: "b.com" })]);
    expect(text).toContain(JOB_SCOPE_NOTE);
    expect(text.split(JOB_SCOPE_NOTE).length - 1).toBe(1);
    expect(JOB_SCOPE_NOTE).toMatch(/crawl_site/);
    expect(JOB_SCOPE_NOTE).toMatch(/pull_gsc_data/);
  });

  it("puts no job note on an account that tracks nothing", () => {
    expect(formatProjectList([])).not.toContain(JOB_SCOPE_NOTE);
  });
});

describe("A4 — the description states the price", () => {
  /**
   * Measured 2026-08-26: list_gsc_properties, track_keywords and untrack_project all say
   * "Costs 0 credits." in their tools/list sentence; list_projects did not. A customer reading
   * the surface should not have to open the docs to learn a read is free.
   */
  it("says the read is free", () => {
    expect(listProjectsTool.description).toMatch(/costs 0 credits/i);
  });
});


/**
 * G6 — measured live on 2026-08-26: `noraninsaat.com` and `www.noraninsaat.com` are two separate
 * projects mapped to the SAME `sc-domain:noraninsaat.com`. Every Search Console pull for them
 * fetches one set of data and is billed twice, and nothing anywhere said so. Naming the property
 * once, under the list, is the smallest thing that makes the duplication visible without
 * pretending to know which of the two the customer meant to keep.
 */
describe("two projects mapped to one Search Console property", () => {
  const mapped = (id: string, domain: string, property: string): ProjectListRow =>
    project({ id, domain, gsc: { kind: "connected", property, expired: false } });

  it("names the shared property and both projects", () => {
    const text = formatProjectList([
      mapped("p-1", "noraninsaat.com", "sc-domain:noraninsaat.com"),
      mapped("p-2", "www.noraninsaat.com", "sc-domain:noraninsaat.com"),
    ]);
    expect(text).toMatch(/same Search Console property/i);
    expect(text).toMatch(/sc-domain:noraninsaat\.com/);
    expect(text).toMatch(/noraninsaat\.com, www\.noraninsaat\.com/);
  });

  it("says what the duplication costs, so it reads as a warning and not as trivia", () => {
    const text = formatProjectList([
      mapped("p-1", "a.com", "sc-domain:x.com"),
      mapped("p-2", "b.com", "sc-domain:x.com"),
    ]);
    expect(text).toMatch(/twice|billed|credits/i);
  });

  it("stays silent when every mapped property is distinct", () => {
    const text = formatProjectList([
      mapped("p-1", "a.com", "sc-domain:a.com"),
      mapped("p-2", "b.com", "sc-domain:b.com"),
      project({ id: "p-3", domain: "c.com" }),
    ]);
    expect(text).not.toMatch(/same Search Console property/i);
  });

  /**
   * The unmapped state is NOT a shared value. Three projects each holding a connection with no
   * property would otherwise group under "null" and be reported as reading one property — a
   * warning invented out of an absence, which is the same fault as printing a zero for a fact
   * nobody reported.
   */
  it("does not treat several unmapped connections as one shared property", () => {
    const text = formatProjectList([
      project({ id: "p-1", domain: "a.com", gsc: { kind: "connected", property: null, expired: false } }),
      project({ id: "p-2", domain: "b.com", gsc: { kind: "connected", property: null, expired: false } }),
      project({ id: "p-3", domain: "c.com" }),
    ]);
    expect(text).not.toMatch(/same Search Console property/i);
  });

  it("reports each shared property once, on its own line", () => {
    const notes = duplicatePropertyNotes([
      mapped("p-1", "a.com", "sc-domain:x.com"),
      mapped("p-2", "b.com", "sc-domain:x.com"),
      mapped("p-3", "c.com", "sc-domain:y.com"),
      mapped("p-4", "d.com", "sc-domain:y.com"),
    ]);
    expect(notes).toHaveLength(2);
  });

  /** An archived project is not being pulled for, so it cannot be paying twice. */
  it("ignores archived projects", () => {
    const text = formatProjectList([
      mapped("p-1", "a.com", "sc-domain:x.com"),
      project({
        id: "p-2",
        domain: "b.com",
        archived_at: "2026-08-01T00:00:00.000Z",
        gsc: { kind: "connected", property: "sc-domain:x.com", expired: false },
      }),
    ]);
    expect(text).not.toMatch(/same Search Console property/i);
  });
});
