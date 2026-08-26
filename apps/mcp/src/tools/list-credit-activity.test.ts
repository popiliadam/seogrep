import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { PAID_BALANCE_TOOLS } from "../credits/paid-balance.ts";
import {
  DEFAULT_ACTIVITY_LIMIT,
  MAX_ACTIVITY_LIMIT,
  formatActivityLine,
  formatCreditActivity,
  formatSpendSummary,
  summarizeSpendRows,
  formatDelta,
  kindLabel,
  makeListCreditActivityTool,
  type CreditActivityRow,
  type ListCreditActivityFn,
} from "./list-credit-activity.ts";

/**
 * Fast-lane specs for list_credit_activity: the wording, the kind vocabulary, the input bounds and
 * the limit the handler resolves. The QUERY — the tenant filter, the zero-delta exclusion, the
 * ordering and the cap — is provable only against real rows and lives in the db lane. The double
 * below is a recorder and answers with whatever it is handed, so nothing here says anything about
 * which rows the database would return.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

function entry(overrides: Partial<CreditActivityRow> = {}): CreditActivityRow {
  return {
    project_id: null,
    id: 1,
    delta: -20,
    kind: "spend_reserve",
    reason: null,
    tool: "crawl_site",
    created_at: "2026-08-25T10:00:00.000Z",
    ...overrides,
  };
}

function recordingPort(rows: readonly CreditActivityRow[]) {
  const calls: { userId: string; limit: number; beforeId?: number }[] = [];
  const listActivity: ListCreditActivityFn = async (userId, limit, beforeId) => {
    calls.push({ userId, limit, beforeId });
    // `total` equals what the port hands back, so these specs describe an UNCUT page and none of
    // their wordings change; the cut sentence has its own specs below.
    return { rows, total: rows.length };
  };
  // The domain port is stubbed EMPTY rather than left to its default: the default reaches
  // getServiceClient, which needs the full prod env, and these specs are about the limit the read
  // port is asked for and the wording around it. An empty map changes no assertion below — every
  // scope clause they exercise renders from the row's own project_id.
  // The spend summary is stubbed for the SAME reason the domain port is: its default reaches
  // getServiceClient and would drag the full prod env into a fast-lane spec. Empty byTool renders
  // nothing, so no wording below changes; the summary has its own specs.
  return {
    calls,
    tool: makeListCreditActivityTool({
      listActivity,
      listDomains: async () => new Map(),
      summarizeSpend: async () => ({ byTool: [], totalNet: 0, rowsCovered: 0, rowsTotal: 0 }),
    }),
  };
}

const textOf = (result: { content: { text: string }[] }): string => result.content[0]?.text ?? "";

describe("list_credit_activity price and gate membership", () => {
  it("is free, as signed", () => {
    expect(TOOL_COSTS.list_credit_activity).toBe(0);
  });

  it("is not on the paid-balance gate", () => {
    expect(PAID_BALANCE_TOOLS.has("list_credit_activity")).toBe(false);
  });
});

describe("list_credit_activity input bounds", () => {
  it("asks the read port for the default number of entries when the call says nothing", async () => {
    const { calls, tool } = recordingPort([entry()]);
    await tool.run(CTX, {});
    expect(calls).toEqual([{ userId: CTX.userId, limit: DEFAULT_ACTIVITY_LIMIT }]);
  });

  it("passes an explicit limit through to the read port", async () => {
    const { calls, tool } = recordingPort([entry()]);
    await tool.run(CTX, { limit: 7 });
    expect(calls[0]?.limit).toBe(7);
  });

  it("refuses a limit outside 1..MAX and never reaches the read port", async () => {
    for (const limit of [0, -1, MAX_ACTIVITY_LIMIT + 1, 1.5]) {
      const { calls, tool } = recordingPort([entry()]);
      const result = await tool.run(CTX, { limit });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/invalid input/i);
      expect(calls).toHaveLength(0);
    }
  });
});

describe("credit kinds in the customer's words", () => {
  /**
   * `spend_reserve` is the row that TAKES the credits and `spend_release` is the row that gives
   * them back (migration 0011's CHECK constraints pin those signs). A customer reading their own
   * statement should see "charge" and "refund", not the internals of a reserve protocol.
   */
  it("names the ledger's own kinds the way a customer reads a statement", () => {
    expect(kindLabel("spend_reserve")).toMatch(/^charge$/);
    expect(kindLabel("spend_release")).toMatch(/^refund$/);
    expect(kindLabel("adjust")).toMatch(/adjust/i);
    expect(kindLabel("grant")).toMatch(/grant/i);
    expect(kindLabel("purchase")).toMatch(/purchase/i);
  });

  /**
   * AN UNKNOWN KIND IS SHOWN, NOT SWALLOWED. A kind nobody has invented yet must reach the reader
   * as itself: a generic word like "activity" would hide a movement of the customer's credits
   * behind a label that says nothing about it. Asserted with a value that is deliberately NOT one
   * of the six the migration lists, so the fallback is exercised rather than assumed.
   */
  it("passes an unrecognised kind through verbatim", () => {
    expect(kindLabel("chargeback_2027")).toBe("chargeback_2027");
    expect(formatActivityLine(entry({ kind: "chargeback_2027" }))).toMatch(/chargeback_2027/);
  });
});

describe("credit amounts", () => {
  /**
   * A debit already carries its minus sign; a credit carries nothing, and "20 credits" beside
   * "-20 credits" reads as another debit. The sign is the whole information content of the line.
   */
  it("signs both directions explicitly", () => {
    expect(formatDelta(-20)).toBe("-20");
    expect(formatDelta(20)).toBe("+20");
  });
});

describe("list_credit_activity rendering", () => {
  it("guides an account whose balance has never moved", async () => {
    const { tool } = recordingPort([]);
    const text = textOf(await tool.run(CTX, {}));
    expect(text).toMatch(/no credit activity/i);
    expect(text).not.toMatch(/^-\s/m);
  });

  it("renders one line per entry with the time, the signed amount, the kind and the tool", () => {
    const line = formatActivityLine(
      entry({ delta: -65, tool: "ranked_keywords", created_at: "2026-08-25T11:22:33.000Z" }),
    );
    expect(line).toMatch(/2026-08-25T11:22:33/);
    expect(line).toMatch(/-65 credits/);
    expect(line).toMatch(/charge/);
    expect(line).toMatch(/ranked_keywords/);
  });

  it("omits the tool and reason clauses for an entry that has neither", () => {
    const line = formatActivityLine(entry({ kind: "grant", delta: 200, tool: null, reason: null }));
    expect(line).toMatch(/\+200 credits/);
    expect(line).toMatch(/grant/);
    expect(line.split("·")).toHaveLength(3); // time · amount · kind, and nothing else
  });

  it("shows a reason when the row carries one", () => {
    expect(formatActivityLine(entry({ reason: "signup trial" }))).toMatch(/signup trial/);
  });

  /**
   * THE PROPERTY THE LIST CLAIMS, said out loud because a customer cannot check it otherwise: the
   * entries shown are the ones that MOVED the balance, so a refunded run appears twice — once as
   * the charge and once as the refund — rather than vanishing. A list that quietly dropped the
   * refund would sum to something other than the balance beside it.
   */
  it("renders a charge and its refund as two entries, and says the entries are the movements", () => {
    const text = formatCreditActivity({ rows: [
      entry({ id: 2, delta: 20, kind: "spend_release", created_at: "2026-08-25T10:03:00.000Z" }),
      entry({ id: 1, delta: -20, kind: "spend_reserve" }),
    ], total: 1 });
    const rows = text.split("\n").filter((line) => line.startsWith("- "));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/refund/);
    expect(rows[1]).toMatch(/charge/);
    expect(text).toMatch(/moved your balance/i);
  });

  it("points at the tool that owns the running total instead of restating it", () => {
    const text = formatCreditActivity({ rows: [entry()], total: 1 });
    expect(text).toMatch(/get_credit_balance/);
    expect(text).toMatch(/newest first/i);
  });
});


/**
 * G11 — "which of my sites did my credits go to?" Measured 2026-08-26: unanswerable. The ledger
 * had no project column and its job_id pointed at a real jobs row in 4 of 82 cases, so 96.6% of a
 * 1,176-credit window could not be attributed to a site. Migration 0033 added the column; this is
 * where a customer reads it.
 */
describe("the project a charge was for", () => {
  const domains = new Map([["p-1", "dentnotion.com"]]);

  it("names the project on a charge", () => {
    const line = formatActivityLine(
      entry({ kind: "spend_reserve", delta: -65, tool: "ranked_keywords", project_id: "p-1" }),
      domains,
    );
    expect(line).toMatch(/dentnotion\.com/);
  });

  it("names it on the refund of that charge too", () => {
    const line = formatActivityLine(
      entry({ kind: "spend_release", delta: 65, tool: "ranked_keywords", project_id: "p-1" }),
      domains,
    );
    expect(line).toMatch(/dentnotion\.com/);
  });

  /**
   * THE NEGATIVE IS PRINTED, not left blank. A keyword set, a seed and a subject that is nobody's
   * tracked site are legitimately project-less, and a silent line would read as "the tool forgot"
   * rather than as "there was no site". It is also the answer to the customer's question for that
   * row — the same rule the tour applied to unreported numbers.
   */
  it("says so, in words, when a charge really had no project scope", () => {
    const line = formatActivityLine(
      entry({
        kind: "spend_reserve",
        delta: -25,
        tool: "research_keywords",
        project_id: null,
        // AFTER the ledger learned to store a project — so this null is a finding, not a gap.
        created_at: "2026-08-27T09:00:00.000Z",
      }),
      domains,
    );
    expect(line).toMatch(/no project scope/i);
  });

  /**
   * D-7, measured live 2026-08-26. The SAME null means something else on an older row: the column
   * did not exist when it was written. The tool printed "no project scope" for a crawl_site charge
   * whose job row names noraninsaat.com — an unrecorded value asserted as a positive finding, the
   * precise shape of "unreported, never as a zero".
   */
  it("calls an older null NOT RECORDED — the column did not exist when it was written", () => {
    const line = formatActivityLine(
      entry({
        kind: "spend_reserve",
        delta: -20,
        tool: "crawl_site",
        project_id: null,
        created_at: "2026-08-25T10:00:00.000Z",
      }),
      domains,
    );
    expect(line).toMatch(/project not recorded/i);
    expect(line).not.toMatch(/no project scope/i);
  });

  /**
   * A project the ledger names but the tenant no longer has. 0033 keeps no foreign key on
   * purpose, so this is reachable — and the id is TRUE where a blank would be a shrug.
   */
  it("falls back to the id when the project is gone", () => {
    const line = formatActivityLine(
      entry({ kind: "spend_reserve", delta: -20, tool: "crawl_site", project_id: "p-vanished" }),
      domains,
    );
    expect(line).toMatch(/p-vanished/);
    expect(line).not.toMatch(/no project scope/i);
  });

  /**
   * Grants and purchases are not spends. "Which project was this grant for?" is not a question
   * anybody has, and answering it on every row would bury the ones where it matters.
   */
  it("says nothing about scope on a grant or a purchase", () => {
    for (const kind of ["grant", "purchase"]) {
      const line = formatActivityLine(entry({ kind, delta: 200, project_id: null }), domains);
      expect(line).not.toMatch(/project/i);
    }
  });
});


/**
 * KAPSAM — measured live 2026-08-26: 512 balance-moving rows behind an answer that said "your 50
 * most recent credit entries" and nothing else. True, and read as the whole ledger by a customer
 * with no way to tell it was cut.
 */
describe("what the answer leaves out", () => {
  // Newest first, as the read port returns them — so the OLDEST id is the last element, and that
  // is the one a cursor must carry. A fixture in the other order would let a `rows[0].id` cursor
  // pass while paging the same entries forever.
  const rows = [entry({ id: 512 }), entry({ id: 511 })];

  it("says how many entries exist and how many are not shown", () => {
    const text = formatCreditActivity({ rows, total: 512 });
    expect(text).toMatch(/2 most recent credit entries of 512/i);
    expect(text).toMatch(/510 older entries not shown/i);
  });

  /**
   * D-8, measured live 2026-08-26: the sentence said "raise `limit` (max 50)" TO A CALLER ALREADY
   * AT 50. True about the count, a dead end about the remedy — 462 entries with no way to reach
   * them. Actionable now means a cursor carrying the value to pass, and the value must be the
   * OLDEST id on screen or the next page repeats what was just read.
   */
  it("hands back the cursor for the next page, not an argument already at its maximum", () => {
    const text = formatCreditActivity({ rows, total: 512 });
    expect(text).toMatch(/before_id: 511/);
    expect(text).not.toMatch(/raise `?limit/i);
  });

  it("says nothing about a cut when the page IS the whole ledger", () => {
    const text = formatCreditActivity({ rows, total: rows.length });
    expect(text).not.toMatch(/not shown/i);
  });

  it("counts one leftover entry in the singular", () => {
    expect(formatCreditActivity({ rows, total: 3 })).toMatch(/1 older entry not shown/i);
  });
});


/**
 * D-8's other half, measured live 2026-08-26. Asked "which tools did my credits go to?", the
 * product could not answer: 512 entries, 50 per call, no total anywhere. The numbers had to be
 * computed out of the database by hand — which is exactly what a customer cannot do.
 */
describe("where the credits went", () => {
  const rows = (...pairs: [string, number][]) => pairs.map(([tool, delta]) => ({ tool, delta }));

  it("nets a refunded reserve out of its tool's total", () => {
    // 36 charges of 30 with 12 released is 720, not 1080 — the number that LEFT the balance.
    const summary = summarizeSpendRows(rows(["audit_onpage", -30], ["audit_onpage", 30], ["audit_onpage", -30]), 3);
    expect(summary.byTool).toEqual([{ tool: "audit_onpage", net: 30 }]);
    expect(summary.totalNet).toBe(30);
  });

  it("drops a tool whose every call was refunded, rather than printing a useless zero", () => {
    const summary = summarizeSpendRows(rows(["ai_visibility", -90], ["ai_visibility", 90], ["crawl_site", -20]), 3);
    expect(summary.byTool).toEqual([{ tool: "crawl_site", net: 20 }]);
  });

  it("orders by net spend and names the tail as a number instead of listing it", () => {
    const summary = summarizeSpendRows(
      rows(["a", -10], ["b", -60], ["c", -50], ["d", -40], ["e", -30], ["f", -20]),
      6,
    );
    expect(summary.byTool.map((entry_) => entry_.tool)).toEqual(["b", "c", "d", "e", "f", "a"]);
    const text = formatSpendSummary(summary);
    expect(text).toMatch(/b 60 · c 50 · d 40 · e 30 · f 20/);
    expect(text).toMatch(/10 across 1 other tool\./);
    expect(text).toMatch(/210 credits, net of refunds, across 6 tools/);
  });

  /**
   * THE CAP HAS A VOICE. A partial sum that calls itself the whole ledger is the failure this
   * review keeps finding; when the row cap bites, the sentence says what it covered.
   */
  it("says when the total covers only the most recent rows", () => {
    const capped = summarizeSpendRows(rows(["crawl_site", -20]), 9_000);
    expect(formatSpendSummary(capped)).toMatch(/the most recent 1 of 9000 spend entries/);
    const complete = summarizeSpendRows(rows(["crawl_site", -20]), 1);
    expect(formatSpendSummary(complete)).not.toMatch(/most recent/);
  });

  it("renders nothing at all for an account that has never spent", () => {
    expect(formatSpendSummary(summarizeSpendRows([], 0))).toBe("");
  });
});

describe("paging and the not-recorded note", () => {
  it("passes before_id through to the read port untouched", async () => {
    const port = recordingPort([entry({ id: 4 })]);
    await port.tool.run({ userId: "u-1", keyId: "k-1" }, { limit: 10, before_id: 99 });
    expect(port.calls).toEqual([{ userId: "u-1", limit: 10, beforeId: 99 }]);
  });

  it("explains 'not recorded' ONLY when such a row is on screen", () => {
    const older = entry({ project_id: null, created_at: "2026-08-25T10:00:00.000Z" });
    const newer = entry({ project_id: null, created_at: "2026-08-27T10:00:00.000Z" });
    expect(formatCreditActivity({ rows: [older], total: 1 })).toMatch(/cannot be filled in/i);
    expect(formatCreditActivity({ rows: [newer], total: 1 })).not.toMatch(/cannot be filled in/i);
  });
});
