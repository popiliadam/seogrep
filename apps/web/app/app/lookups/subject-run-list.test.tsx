import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  SUBJECT_RUN_HISTORY_LIMIT,
  buildSubjectRunHistory,
  type SubjectRunHistoryRow,
} from "../../../lib/projects/subject-history";
import { SubjectRunList } from "./subject-run-list";

/**
 * The RENDER of /app/lookups' THIRD section, driven through the REAL history builder rather than
 * hand-written entry objects — its two siblings' rule, for their reason: a fixture typed straight
 * into entry shape would let the markup agree with a history the builder never produces.
 *
 * Fragments are matched with a case-insensitive REGEX on the shortest distinctive piece, never as
 * a pasted sentence: a literal-matched spec silently stops testing the moment the copy is reworded
 * (signed lesson 11).
 */

function row(over: Partial<SubjectRunHistoryRow> = {}): SubjectRunHistoryRow {
  return {
    tool: "discover_keywords",
    subject_kind: "keyword_set",
    subject: ["rank tracker", "seo tools"],
    project_id: null,
    created_at: "2026-08-10T00:00:00.000Z",
    mode: "ideas",
    platform: null,
    total: 4321,
    shown: 25,
    answered: null,
    top: { keyword: "seo tools", search_volume: 9000 },
    locale: { language_code: "en", location_code: 2840 },
    compared_target_count: null,
    ...over,
  };
}

function listOf(rows: readonly SubjectRunHistoryRow[], limit?: number) {
  return render(<SubjectRunList history={buildSubjectRunHistory(rows, limit)} />).container;
}

describe("the empty state says what was measured and no more", () => {
  it("says no run is RECORDED rather than that the tenant never ran one", () => {
    const text = listOf([]).textContent ?? "";
    expect(text).toMatch(/no discovery or ai visibility runs recorded/i);
    // The word "recorded" is the load-bearing one: a run from before the table existed is not in
    // it, so "you have never done this" is a claim this page cannot make.
    expect(text).toMatch(/recorded/i);
    expect(text).not.toMatch(/you have never/i);
  });
});

describe("a row shows WHAT was looked up, of WHAT KIND, and WHAT was asked", () => {
  it("prints the subject beside its kind — the pair that IS the identity", () => {
    const text = listOf([row()]).textContent ?? "";
    expect(text).toMatch(/rank tracker, seo tools/i);
    // The KIND, because the same word can be a keyword on one row and a seed on the next.
    expect(text).toMatch(/2 seed keywords/i);
  });

  it("prints the tool and the question asked about the subject", () => {
    const text = listOf([row({ mode: "related" })]).textContent ?? "";
    expect(text).toMatch(/discover_keywords/i);
    expect(text).toMatch(/related/i);
  });

  it("prints the assistant as the question on an AI run", () => {
    const text =
      listOf([
        row({
          tool: "ai_visibility",
          subject_kind: "domain",
          subject: ["example.com"],
          mode: null,
          platform: "chat_gpt",
          shown: 1,
          total: 77,
          top: null,
          locale: { location_name: "United States", language_code: "en" },
        }),
      ]).textContent ?? "";
    expect(text).toMatch(/ai_visibility/i);
    expect(text).toMatch(/chat_gpt/i);
    expect(text).toMatch(/en · united states/i);
  });

  /**
   * A SEED SET MAY HOLD TWO HUNDRED KEYWORDS. The words are truncated; the SIZE is not, because
   * the kind caption carries the count — so the truncation never hides how much was measured.
   */
  it("truncates a long subject while still stating its full size", () => {
    const subject = Array.from({ length: 30 }, (_, index) => `kw-${index}`);
    const text = listOf([row({ subject })]).textContent ?? "";
    expect(text).toMatch(/\+24 more/);
    expect(text).toMatch(/30 seed keywords/i);
    expect(text).not.toMatch(/kw-29/);
  });

  /** WHERE THE REQUEST CAME FROM is shown, and never dressed up with a name nothing read. */
  it("marks a project-scoped run and leaves a project-less one unmarked", () => {
    expect(listOf([row({ project_id: "p1" })]).textContent ?? "").toMatch(/for your project/i);
    expect(listOf([row()]).textContent ?? "").not.toMatch(/for your project/i);
  });

  it("says a market was not recorded rather than inventing one", () => {
    expect(listOf([row({ locale: null })]).textContent ?? "").toMatch(/not recorded/i);
  });
});

describe("the numbers a row shows are the ones that were stored", () => {
  it("prints the window count, the vendor's total and the headline keyword", () => {
    const text = listOf([row()]).textContent ?? "";
    expect(text).toMatch(/25 keywords in this window/i);
    expect(text).toMatch(/4,321 matching in total/i);
    expect(text).toMatch(/seo tools.*9,000\/mo/i);
  });

  /**
   * THE UNANSWERED COMPARED TARGET, on the page. It cost 90 credits to learn, and a row that
   * simply showed nothing would be indistinguishable from a target with zero mentions.
   */
  it("names an unanswered compare target as unanswered, never as a zero", () => {
    const text =
      listOf([
        row({
          tool: "ai_visibility_compare",
          subject_kind: "domain",
          subject: ["rival.com"],
          mode: null,
          platform: "chat_gpt",
          total: null,
          shown: 0,
          answered: false,
          top: null,
          compared_target_count: 3,
          locale: { location_name: null, language_code: "en" },
        }),
      ]).textContent ?? "";
    expect(text).toMatch(/compared with 2 other targets/i);
    expect(text).toMatch(/unanswered, not zero/i);
    expect(text).not.toMatch(/\b0 rows\b/i);
  });

  /** An unreadable report shows the subject and NO numbers — never a fabricated zero. */
  it("says no numbers were recorded rather than printing a zero", () => {
    const text = listOf([row({ shown: null, total: null, top: null })]).textContent ?? "";
    expect(text).toMatch(/no numbers recorded/i);
    expect(text).toMatch(/rank tracker/i);
  });
});

describe("the section never prints a change clause", () => {
  /**
   * NO RUN ON THIS TABLE GETS ONE, for three separate reasons (lib/projects/subject-history.ts).
   * Pinned at the RENDER as well as at the builder, because the two could drift apart: a clause
   * assembled in the markup out of two entries would satisfy every builder spec.
   */
  it("shows no since-clause even for two runs of the identical subject", () => {
    const text =
      listOf([
        row({ created_at: "2026-08-20T00:00:00.000Z", total: 5000 }),
        row({ created_at: "2026-08-10T00:00:00.000Z", total: 4000 }),
      ]).textContent ?? "";
    expect(text).not.toMatch(/since\s/i);
    expect(text).not.toMatch(/no change/i);
    expect(text).not.toMatch(/[+−-][\d,]+\s+since/i);
  });
});

describe("the ceiling is disclosed only when it bites", () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      row({ created_at: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z` }),
    );

  it("says nothing about older runs when the window was not full", () => {
    expect(listOf(many(3), 3).textContent ?? "").not.toMatch(/older runs exist/i);
  });

  /**
   * …AND SAYS IT WITH THE SHARED CONSTANT plus the note that a comparison writes a row per compared
   * target, so a reader is not left thinking the number counts their calls.
   */
  it("discloses the ceiling and explains why it fills faster than the call count", () => {
    const text = listOf(many(4), 3).textContent ?? "";
    expect(text).toMatch(/older runs exist/i);
    expect(text).toMatch(/one run per compared target/i);
    expect(listOf(many(SUBJECT_RUN_HISTORY_LIMIT + 1)).textContent ?? "").toMatch(
      new RegExp(String(SUBJECT_RUN_HISTORY_LIMIT)),
    );
  });
});
