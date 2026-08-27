import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_SUBJECT_MESSAGE,
  ARCHIVED_PROJECT_MESSAGE,
  NO_SUBJECT_MESSAGE,
  projectNotFoundMessage,
  resolveTarget,
  subjectLabel,
  type LoadProjectFn,
  type ProjectRef,
} from "./project-target.ts";

/**
 * Proofs for the shared project/target resolver the three premium domain tools call BEFORE
 * their credit reserve. Nothing here touches the DB: the loader is injected, which is also
 * how the tenant filter is observed — the real loader's `.eq("user_id", …)` is proven against
 * the live schema in project-target.db.test.ts.
 */

const MINE = "11111111-1111-4111-8111-111111111111";
const THEIRS = "22222222-2222-4222-8222-222222222222";
const NOBODYS = "33333333-3333-4333-8333-333333333333";
const MINE_ARCHIVED = "44444444-4444-4444-8444-444444444444";
const THEIRS_ARCHIVED = "55555555-5555-4555-8555-555555555555";

/**
 * MEASURED, not chosen for looks. The first draft of this fixture used "archived.example",
 * and the archive spec below went GREEN against the UNCHANGED resolver: `.example` is a
 * reserved name, so normalizeDomain refused it with `"archived.example" is not a public
 * domain` — a refusal whose text carries the fixture's own name straight into /archived/i.
 * The domain must therefore be PUBLIC (so the resolver reaches the archive branch at all) and
 * must not contain the word being matched. Both are asserted, not assumed.
 */
const ARCHIVED_DOMAIN = "retired-shop.com";

/**
 * A loader that models the ONE property the real one has: rows are keyed by (userId, projectId),
 * so a caller only ever sees their own. THEIRS exists — it just belongs to someone else.
 * Archived rows are rows: the loader still returns them, exactly as the real tenant-scoped read
 * does. Refusing them is the RESOLVER's job, and a fake that hid them would prove nothing.
 */
const store: Record<string, ProjectRef> = {
  [`user-1/${MINE}`]: { id: MINE, domain: "adstark.com.tr", archivedAt: null },
  [`user-1/${MINE_ARCHIVED}`]: {
    id: MINE_ARCHIVED,
    domain: ARCHIVED_DOMAIN,
    archivedAt: "2026-08-13T00:00:00Z",
  },
  [`user-2/${THEIRS}`]: { id: THEIRS, domain: "other-tenant.example", archivedAt: null },
  [`user-2/${THEIRS_ARCHIVED}`]: {
    id: THEIRS_ARCHIVED,
    domain: "other-tenant-retired.com",
    archivedAt: "2026-08-13T00:00:00Z",
  },
};

const loadProject: LoadProjectFn = async (userId, projectId) =>
  store[`${userId}/${projectId}`] ?? null;

describe("resolveTarget", () => {
  it("uses a bare target as-is, canonicalized, with no project and no loader call", async () => {
    let called = false;
    const spy: LoadProjectFn = async (...args) => {
      called = true;
      return loadProject(...args);
    };
    const resolved = await resolveTarget("user-1", { target: "https://Example.COM/pricing" }, spy);
    expect(resolved).toEqual({ ok: true, domain: "example.com", project: null });
    // The bare-target path must not read the DB at all — that is what keeps it working for a
    // caller who has no projects, and what the env-stripped tool gates rely on.
    expect(called).toBe(false);
  });

  it("derives the target from the project's stored domain", async () => {
    const resolved = await resolveTarget("user-1", { project_id: MINE }, loadProject);
    expect(resolved).toEqual({
      ok: true,
      domain: "adstark.com.tr",
      project: { id: MINE, domain: "adstark.com.tr", archivedAt: null },
    });
  });

  it("passes the CALLER's user id to the loader, never the project's owner", async () => {
    const seen: string[] = [];
    const spy: LoadProjectFn = async (userId, projectId) => {
      seen.push(userId);
      return loadProject(userId, projectId);
    };
    await resolveTarget("user-1", { project_id: THEIRS }, spy);
    expect(seen).toEqual(["user-1"]);
  });

  it("rejects a call that names NEITHER a project nor a target", async () => {
    const resolved = await resolveTarget("user-1", {}, loadProject);
    expect(resolved).toEqual({ ok: false, error: NO_SUBJECT_MESSAGE });
    expect(NO_SUBJECT_MESSAGE).toMatch(/not charged/i);
  });

  it("rejects a call that names BOTH rather than guessing which one was meant", async () => {
    const resolved = await resolveTarget(
      "user-1",
      { project_id: MINE, target: "competitor.example" },
      loadProject,
    );
    expect(resolved).toEqual({ ok: false, error: AMBIGUOUS_SUBJECT_MESSAGE });
    // Neither input may win by precedence: the message must name the rule, not a resolution.
    expect(AMBIGUOUS_SUBJECT_MESSAGE).toMatch(/not both/i);
  });

  /**
   * The existence-leak proof. get_job_status set the pattern: an id that never existed and an id
   * that belongs to someone else must be INDISTINGUISHABLE, or the tool becomes an oracle for
   * probing which project ids are real. Byte equality, not "both are errors".
   */
  it("answers another tenant's project id with the SAME text as a nonexistent one", async () => {
    const theirs = await resolveTarget("user-1", { project_id: THEIRS }, loadProject);
    const nobodys = await resolveTarget("user-1", { project_id: NOBODYS }, loadProject);
    expect(theirs.ok).toBe(false);
    expect(nobodys.ok).toBe(false);
    const theirText = theirs.ok === false ? theirs.error : "";
    const nobodyText = nobodys.ok === false ? nobodys.error : "";
    // Identical up to the id the CALLER supplied — nothing about the row leaks through.
    expect(theirText).toBe(projectNotFoundMessage(THEIRS));
    expect(nobodyText).toBe(projectNotFoundMessage(NOBODYS));
    expect(theirText.replace(THEIRS, "<id>")).toBe(nobodyText.replace(NOBODYS, "<id>"));
    // The other tenant's domain must not appear anywhere in what we say back.
    expect(theirText).not.toContain("other-tenant.example");
  });

  it("rejects an unusable target with the shared domain normalizer's own message", async () => {
    const resolved = await resolveTarget("user-1", { target: "not a domain" }, loadProject);
    expect(resolved.ok).toBe(false);
    expect(resolved.ok === false && resolved.error).toMatch(/not a valid domain/i);
  });

  it("re-normalizes the project's stored domain instead of trusting the row", async () => {
    const legacy: LoadProjectFn = async () => ({
      id: MINE,
      domain: "HTTPS://Legacy.Example.COM/x",
      archivedAt: null,
    });
    const resolved = await resolveTarget("user-1", { project_id: MINE }, legacy);
    expect(resolved.ok === true && resolved.domain).toBe("legacy.example.com");
  });
});

/**
 * The archive refusal. It lives HERE, in the one resolver, rather than in each tool: a check
 * copied into nine handlers is a check the ninth handler forgets (the `rsc-boundary` gate grew
 * SIX holes exactly that way). Each converted tool has its own spec proving it comes through
 * here — one check in one place does not prove every caller reaches it.
 */
describe("resolveTarget — archived projects", () => {
  it("refuses an archived project of the caller's own", async () => {
    // The fixture may not smuggle the matched word in, and it must be a domain the normalizer
    // ACCEPTS — otherwise the refusal under test is the normalizer's, not the archive check's.
    expect(ARCHIVED_DOMAIN).not.toMatch(/archiv/i);
    expect(await resolveTarget("user-1", { target: ARCHIVED_DOMAIN }, loadProject)).toMatchObject({
      ok: true,
    });
    const resolved = await resolveTarget("user-1", { project_id: MINE_ARCHIVED }, loadProject);
    // Asserted by regex, not by the source literal: a test that re-states the string it is
    // pinning proves only that the string was copied twice (signed lesson 11).
    expect(resolved).toMatchObject({ ok: false, error: expect.stringMatching(/archived/i) });
  });

  it("names the repair in the refusal instead of leaving the caller stuck", () => {
    expect(ARCHIVED_PROJECT_MESSAGE).toMatch(/track_gsc_property|connection page/i);
  });

  /**
   * THE REPAIR IT NAMES MUST BE RUNNABLE BY THE PROJECT MOST LIKELY TO SEE IT.
   *
   * The assertion above is an OR, and an OR cannot see the hole this closes: deleting
   * `track_gsc_property` from the sentence entirely leaves it green on `connection page`.
   * Measured live 2026-08-27 — an archived project with no Google account, no property and a
   * domain that does not resolve was told to restore it with `track_gsc_property`, which refuses
   * such a caller with NO_ACCOUNT before it looks at anything. So the sentence must ALSO name the
   * route that has no Search Console precondition, and say so rather than listing two tools as if
   * they were interchangeable.
   *
   * Pinned as separate `toMatch`es, never as the source literal (signed lesson 11): each one is
   * an independent claim, and a single re-stated string would prove only that it was copied.
   */
  it("names a restore route that needs no Search Console property", () => {
    expect(ARCHIVED_PROJECT_MESSAGE).toMatch(/setup_project/);
    expect(ARCHIVED_PROJECT_MESSAGE).toMatch(/whether or not/i);
  });

  it("still resolves an active project exactly as before", async () => {
    const resolved = await resolveTarget("user-1", { project_id: MINE }, loadProject);
    expect(resolved).toMatchObject({ ok: true, domain: "adstark.com.tr" });
  });

  /**
   * ORDER PROOF — the reason the archive check sits AFTER the ownership check. If it came
   * first, another tenant's archived project would be answered "that project is archived",
   * which says the row EXISTS. Today missing and other-tenant are indistinguishable; an
   * archived other-tenant project must stay in that same indistinguishable class.
   */
  it("answers another tenant's ARCHIVED project as not-found, never as archived", async () => {
    const theirs = await resolveTarget("user-1", { project_id: THEIRS_ARCHIVED }, loadProject);
    const nobodys = await resolveTarget("user-1", { project_id: NOBODYS }, loadProject);
    const theirText = theirs.ok === false ? theirs.error : "";
    const nobodyText = nobodys.ok === false ? nobodys.error : "";
    expect(theirText).toBe(projectNotFoundMessage(THEIRS_ARCHIVED));
    expect(theirText).not.toMatch(/archived/i);
    expect(theirText.replace(THEIRS_ARCHIVED, "<id>")).toBe(nobodyText.replace(NOBODYS, "<id>"));
  });

  /** A bare target names no project, so nothing can be archived about it — and no read happens. */
  it("leaves the bare-target path untouched", async () => {
    const resolved = await resolveTarget("user-1", { target: "example.com" }, loadProject);
    expect(resolved).toEqual({ ok: true, domain: "example.com", project: null });
  });
});

describe("subjectLabel", () => {
  it("quotes a bare target", () => {
    expect(subjectLabel("example.com", null)).toBe('"example.com"');
  });

  it("names the project a resolved target came from", () => {
    expect(
      subjectLabel("adstark.com.tr", { id: MINE, domain: "adstark.com.tr", archivedAt: null }),
    ).toBe(
      'your project "adstark.com.tr"',
    );
  });
});
