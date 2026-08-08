import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_SUBJECT_MESSAGE,
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

/**
 * A loader that models the ONE property the real one has: rows are keyed by (userId, projectId),
 * so a caller only ever sees their own. THEIRS exists — it just belongs to someone else.
 */
const store: Record<string, ProjectRef> = {
  [`user-1/${MINE}`]: { id: MINE, domain: "adstark.com.tr" },
  [`user-2/${THEIRS}`]: { id: THEIRS, domain: "other-tenant.example" },
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
      project: { id: MINE, domain: "adstark.com.tr" },
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
    });
    const resolved = await resolveTarget("user-1", { project_id: MINE }, legacy);
    expect(resolved.ok === true && resolved.domain).toBe("legacy.example.com");
  });
});

describe("subjectLabel", () => {
  it("quotes a bare target", () => {
    expect(subjectLabel("example.com", null)).toBe('"example.com"');
  });

  it("names the project a resolved target came from", () => {
    expect(subjectLabel("adstark.com.tr", { id: MINE, domain: "adstark.com.tr" })).toBe(
      'your project "adstark.com.tr"',
    );
  });
});
