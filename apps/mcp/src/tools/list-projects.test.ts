import { describe, expect, it } from "vitest";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
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
    expect(text).toBe("You are tracking 1 project(s):\n- example.com (project_id: p-1)");
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
