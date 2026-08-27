import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DATA_FRESHNESS_DAYS, dataAgeInDays } from "@pseo/core";
import type { AuthContext } from "../auth.ts";
import type { AuditCrawl } from "../audit/index.ts";
import { auditSchema, formatSchemaReport } from "../audit/index.ts";
import { TOOL_COSTS, type ToolName } from "../credits/costs.ts";
import { STALE_PULL_DAYS } from "../gsc-data/index.ts";
import { renderReportHtml } from "../report/html.ts";
import { buildReportModel, STALE_CRAWL_DAYS } from "../report/model.ts";
import {
  decideProjectNextStep,
  formatNextStep,
  FRESHNESS_WINDOW_DAYS,
  makeWhatsNextTool,
  priceLabel,
  renderWhatsNext,
  type ProjectSignals,
  type WhatsNextState,
} from "./whats-next.ts";

/**
 * Fast-lane (DB-less) proofs for whats_next — the "guide for non-experts" router. The tenant-scoped
 * state READS are proven against the real stack in whats-next.db.test.ts; here we prove the pure
 * decision ladder, the rendering of every top-level state, and the tool metadata / handler wiring
 * (via an injected loadState, so no DB is touched).
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

/** Build a ProjectSignals with sensible "everything present + fresh" defaults, overridable. */
function signals(over: Partial<ProjectSignals> = {}): ProjectSignals {
  return {
    hasCrawl: true,
    crawlFresh: true,
    gscConnected: true,
    hasPull: true,
    pullFresh: true,
    ...over,
  };
}

describe("decideProjectNextStep — the state ladder", () => {
  it("no crawl -> crawl_site (the GSC-less foundation)", () => {
    const step = decideProjectNextStep(signals({ hasCrawl: false, crawlFresh: false, hasPull: false, pullFresh: false, gscConnected: false }));
    expect(step.primary).toBe("crawl_site");
    expect(step.allSet).toBe(false);
    expect(step.upcoming).toContain("connect_gsc (optional)");
  });

  it("crawl present, GSC not connected, no pull -> audit_onpage with connect_gsc kept OPTIONAL", () => {
    const step = decideProjectNextStep(signals({ gscConnected: false, hasPull: false, pullFresh: false }));
    expect(step.primary).toBe("audit_onpage");
    expect(step.upcoming).toContain("audit_tech");
    expect(step.upcoming).toContain("audit_schema");
    expect(step.upcoming).toContain("connect_gsc (optional)");
    expect(step.reason).toMatch(/optional/i);
    expect(step.allSet).toBe(false);
  });

  it("crawl present, GSC connected, no pull -> pull_gsc_data", () => {
    const step = decideProjectNextStep(signals({ hasPull: false, pullFresh: false }));
    expect(step.primary).toBe("pull_gsc_data");
    expect(step.upcoming).toContain("find_quick_wins");
    expect(step.allSet).toBe(false);
  });

  it("stale pull -> pull_gsc_data refresh (reason mentions the freshness window)", () => {
    const step = decideProjectNextStep(signals({ pullFresh: false }));
    expect(step.primary).toBe("pull_gsc_data");
    expect(step.reason).toMatch(/days old/i);
    expect(step.allSet).toBe(false);
  });

  it("fresh pull but stale crawl -> crawl_site refresh", () => {
    const step = decideProjectNextStep(signals({ crawlFresh: false }));
    expect(step.primary).toBe("crawl_site");
    expect(step.reason).toMatch(/days old/i);
    expect(step.allSet).toBe(false);
  });

  it("everything present and fresh -> all set: generate_report + monthly-routine prompt", () => {
    const step = decideProjectNextStep(signals());
    expect(step.primary).toBe("generate_report");
    expect(step.allSet).toBe(true);
    expect(step.upcoming).toContain("monthly-routine (prompt)");
  });

  /**
   * Live product test, 2026-08-07. A/B on two real projects with the SAME crawl state and only
   * the Search Console link differing: the un-connected one was told to run the audits, the
   * connected one was never told about them at all. Connecting GSC must not HIDE the analysis
   * of a crawl the user has already paid 20 credits for — the ladder picks ONE primary step,
   * but the audits stay visible on every rung where a crawl exists.
   */
  it("keeps the audit trio visible on every rung where a crawl exists", () => {
    const rungs: ReadonlyArray<readonly [string, ProjectSignals]> = [
      ["GSC connected, nothing pulled", signals({ hasPull: false, pullFresh: false })],
      ["stale pull", signals({ pullFresh: false })],
      ["all set", signals()],
    ];
    for (const [label, s] of rungs) {
      const step = decideProjectNextStep(s);
      expect(step.upcoming, `${label}: audit_onpage missing`).toContain("audit_onpage");
      expect(step.upcoming, `${label}: audit_tech missing`).toContain("audit_tech");
      expect(step.upcoming, `${label}: audit_schema missing`).toContain("audit_schema");
    }
  });

  it("does not offer the audits when there is no crawl to audit", () => {
    const step = decideProjectNextStep(
      signals({ hasCrawl: false, crawlFresh: false, hasPull: false, pullFresh: false }),
    );
    // Rung 1 lists them as what comes AFTER the crawl, which is correct — but the primary
    // step must still be the crawl itself, never an audit with nothing to analyze.
    expect(step.primary).toBe("crawl_site");
  });
});

describe("renderWhatsNext — every top-level state", () => {
  it("no_projects points at setup_project", () => {
    const text = renderWhatsNext({ kind: "no_projects" });
    expect(text).toMatch(/setup_project/);
    expect(text).toMatch(/no projects/i);
  });

  it("choose_project lists the projects and asks for a project_id", () => {
    const state: WhatsNextState = {
      kind: "choose_project",
      projects: [
        { id: "p-1", domain: "a.com" },
        { id: "p-2", domain: "b.com" },
      ],
    };
    const text = renderWhatsNext(state);
    expect(text).toMatch(/project_id/);
    expect(text).toContain("a.com");
    expect(text).toContain("p-2");
  });

  it("project_not_found names the id and points at list_projects / setup_project", () => {
    const text = renderWhatsNext({ kind: "project_not_found", projectId: "missing-1" });
    expect(text).toContain("missing-1");
    expect(text).toMatch(/list_projects/);
    expect(text).toMatch(/setup_project/);
  });

  /**
   * The dead-connection rung, through the RENDERER — the ladder itself is pinned in
   * packages/core (guide/next-step.test.ts). What this adds is the sentence a user actually
   * reads: whats_next's text must not name pull_gsc_data anywhere, because on this rung every
   * mention of it is an instruction that cannot succeed.
   */
  it("a project whose Google account is dead renders reconnect-first, naming no pull", () => {
    const state: WhatsNextState = {
      kind: "project",
      domain: "expired-token.example",
      signals: signals({ gscTokenInvalid: true }),
    };
    const text = renderWhatsNext(state);
    expect(text).toContain("connect_gsc");
    expect(text).toMatch(/expired/i);
    expect(text).not.toContain("pull_gsc_data");
    expect(text).not.toContain("find_quick_wins");
    expect(text).not.toMatch(/all set/i);
    // The audits stay: they read the crawl, which needs no Google account at all.
    expect(text).toContain("audit_onpage");
  });

  it("project renders the decided next step with the domain and a Then: list", () => {
    const state: WhatsNextState = {
      kind: "project",
      domain: "seogrep.example",
      signals: signals({ hasCrawl: false, crawlFresh: false, hasPull: false, pullFresh: false, gscConnected: false }),
    };
    const text = renderWhatsNext(state);
    expect(text).toContain("seogrep.example");
    expect(text).toMatch(/crawl_site/);
    expect(text).toMatch(/Then:/);
  });
});

describe("formatNextStep", () => {
  it("labels the all-set state and still surfaces the recommended action", () => {
    const text = formatNextStep("x.com", decideProjectNextStep(signals()));
    expect(text).toMatch(/all set/i);
    expect(text).toContain("generate_report");
  });
});

describe("whats_next tool metadata + handler wiring", () => {
  const tool = makeWhatsNextTool();

  it("advertises its name, the 0-credit cost, and an optional project_id — and NO reserved confirm field", () => {
    expect(tool.name).toBe("whats_next");
    expect(tool.description).toMatch(/0 credits/i);
    const schema = tool.inputJsonSchema as { required?: string[]; properties: Record<string, unknown> };
    // project_id is optional (no `required`), and `confirm` is a registry param — never advertised.
    expect(schema.required ?? []).not.toContain("project_id");
    expect(Object.keys(schema.properties)).toEqual(["project_id"]);
    expect(Object.keys(schema.properties)).not.toContain("confirm");
  });

  it("runs the handler over an injected state loader (no DB) and renders its text", async () => {
    const loaded: WhatsNextState = {
      kind: "project",
      domain: "injected.example",
      signals: signals({ hasPull: false, pullFresh: false }),
    };
    const injected = makeWhatsNextTool({ loadState: async () => loaded });
    const result = await injected.run(CTX, { project_id: "11111111-1111-4111-8111-111111111111" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("injected.example");
    expect(result.content[0]?.text).toContain("pull_gsc_data");
  });

  /**
   * The per-tool archive proof. It injects the PROJECT LOADER, not the state loader: injecting
   * the state would skip the very code path under test and prove only that a rendered string
   * comes back. The refusal itself lives once, in project-target.ts; this asserts whats_next
   * goes through it.
   *
   * It also runs with NO Supabase env, which pins a second property: the archive answer returns
   * before any signal read. Were the service client reached, it would throw on the missing env
   * rather than answer.
   */
  it("refuses an ARCHIVED project instead of routing it — and reads no further", async () => {
    const domain = "retired-shop.com"; // carries no form of the matched word
    expect(domain).not.toMatch(/archiv/i);
    const archived = makeWhatsNextTool({
      loadProject: async (_userId, projectId) => ({
        id: projectId,
        domain,
        archivedAt: "2026-08-13T00:00:00Z",
      }),
    });
    const result = await archived.run(CTX, { project_id: "11111111-1111-4111-8111-111111111111" });
    expect(result.content[0]?.text).toMatch(/archived/i);
    // It must not go on to recommend a next step for a project that is not being tracked.
    expect(result.content[0]?.text).not.toMatch(/next step/i);
  });
});

/**
 * PRICES IN THE ROUTING (defect card 5, 2026-08-25). The router printed eight recommendations and
 * not one credit cost: `generate_report` (15) and `audit_onpage` (30) sat in the same list with
 * nothing to tell them apart, and the audience this tool exists for — people who do not know the
 * tool names — had to leave it to find out what "next step" would charge.
 *
 * NEVER #6 is not in play: no number moves here. Every assertion below derives its expectation
 * from TOOL_COSTS rather than restating one, so this file cannot become a second price table.
 */
describe("every recommendation carries its price", () => {
  /** Every recommendation the ladder can emit, over the whole signal space plus both new signals. */
  function everyRecommendation(): string[] {
    const out = new Set<string>();
    for (let mask = 0; mask < 32; mask++) {
      const base = {
        hasCrawl: Boolean(mask & 1),
        crawlFresh: Boolean(mask & 2),
        gscConnected: Boolean(mask & 4),
        hasPull: Boolean(mask & 8),
        pullFresh: Boolean(mask & 16),
      };
      for (const extra of [{}, { gscTokenInvalid: true }, { domainUnreachable: true }]) {
        const step = decideProjectNextStep({ ...base, ...extra });
        out.add(step.primary);
        for (const item of step.upcoming) out.add(item);
      }
    }
    return [...out];
  }

  it("labels every priced tool it can ever name, and none of them silently", () => {
    const priced = everyRecommendation().filter((r) => {
      const name = r.split(" ")[0] ?? "";
      return name in TOOL_COSTS && TOOL_COSTS[name as ToolName] > 0;
    });
    // A sanity floor: if the ladder ever stopped naming priced tools this whole describe would
    // pass vacuously, which is the failure mode a "for each" assertion cannot see by itself.
    expect(priced.length).toBeGreaterThanOrEqual(5);
    for (const item of priced) {
      const cost = TOOL_COSTS[(item.split(" ")[0] ?? "") as ToolName];
      expect(priceLabel(item), item).toBe(`${cost} credits`);
    }
  });

  it("marks the free ones free rather than leaving them blank beside a priced one", () => {
    expect(priceLabel("connect_gsc")).toBe("free");
    expect(priceLabel("connect_gsc (optional)")).toBe("free");
    expect(priceLabel("setup_project")).toBe("free");
    expect(priceLabel("whats_next")).toBe("free");
  });

  /** Guessing that an unrecognised step is free is the one wrong answer available here. */
  it("says nothing at all about a step that is not a priced tool", () => {
    expect(priceLabel("monthly-routine (prompt)")).toBe("");
    expect(priceLabel("some_tool_that_does_not_exist")).toBe("");
  });

  /**
   * A per-unit tool must render the RANGE a call really costs, never the unit price. None of the
   * ladder's current recommendations is per-unit; this pins the branch so that adding one cannot
   * print "8 credits" for a call that bills 13 to 85.
   */
  it("renders a per-unit tool's real call range, not its unit price", () => {
    const label = priceLabel("serp_snapshot");
    expect(label).toMatch(/per call/);
    expect(label).not.toBe(`${TOOL_COSTS.serp_snapshot} credits`);
  });

  it("puts the price on the primary step and on every line of the Then: list", () => {
    const text = renderWhatsNext({
      kind: "project",
      domain: "x.com",
      signals: signals({ hasCrawl: false, crawlFresh: false, hasPull: false, pullFresh: false, gscConnected: false }),
    });
    expect(text).toMatch(new RegExp(`run crawl_site \\(${TOOL_COSTS.crawl_site} credits\\)`));
    expect(text).toMatch(new RegExp(`- audit_onpage — ${TOOL_COSTS.audit_onpage} credits`));
    expect(text).toMatch(/- connect_gsc \(optional\) — free/);
  });

  it("prices the no-projects onboarding list too", () => {
    const text = renderWhatsNext({ kind: "no_projects" });
    expect(text).toMatch(new RegExp(`crawl_site \\(${TOOL_COSTS.crawl_site} credits\\)`));
    expect(text).toMatch(new RegExp(`generate_report \\(${TOOL_COSTS.generate_report} credits\\)`));
    expect(text).toMatch(/setup_project \(free\)/);
  });
});

/**
 * S18 item 1 — the description promised routing it does not do.
 *
 * Measured on an account with 15 projects: the schema said "omit it to route from your project
 * list" and the tool printed the same rows list_projects prints. THE DESCRIPTION WAS CORRECTED
 * rather than the behaviour changed: routing N projects means running four tenant-scoped queries
 * and a DNS lookup PER PROJECT for a 0-credit tool, and then still picking one "next step" out of
 * fifteen unrelated sites — a guess presented as a recommendation.
 */
describe("the description says what the tool does", () => {
  const tool = makeWhatsNextTool();

  function projectIdDescription(): string {
    const schema = tool.inputJsonSchema as {
      properties: { project_id?: { description?: string } };
    };
    return schema.properties.project_id?.description ?? "";
  }

  it("no longer claims that omitting project_id routes from the project list", () => {
    for (const text of [tool.description, projectIdDescription()]) {
      expect(text).not.toMatch(/route from your project list/i);
    }
  });

  it("states both halves of what omitting it really does — one routes, several are listed", () => {
    const both = `${tool.description}\n${projectIdDescription()}`;
    expect(both).toMatch(/only project|one project/i);
    expect(both).toMatch(/lists them|asks which|several/i);
  });

  it("advertises that the routing shows what each step costs", () => {
    expect(tool.description).toMatch(/cost/i);
  });

  it("answers a multi-project account with the rule, not a bare copy of list_projects", () => {
    const text = renderWhatsNext({
      kind: "choose_project",
      projects: [
        { id: "p-1", domain: "a.com" },
        { id: "p-2", domain: "b.com" },
      ],
    });
    expect(text).toContain("2 projects");
    expect(text).toMatch(/project_id/);
    // The rule a reader could not otherwise infer: a single project needs no id at all.
    expect(text).toMatch(/exactly one project/i);
  });
});

/**
 * S18 item 3, at the RENDERER — a surviving pull is not a live connection.
 *
 * The ladder's own proofs live in packages/core (guide/next-step.test.ts). What this adds is the
 * sentence a user reads, and the money claim: for the exact state measured on dentnotion.com
 * (a succeeded pull_gsc_data job dated 2026-08-09, a fresh crawl, and NO connection — in the same
 * session `list_gsc_properties` said "not used by any project" and `connect_gsc` took its
 * not-connected branch) whats_next answered "you're all set" and recommended a 15-credit report.
 */
describe("renderWhatsNext — a pull that outlived its connection", () => {
  const DENTNOTION: WhatsNextState = {
    kind: "project",
    domain: "dentnotion.com",
    signals: signals({ gscConnected: false, crawlAgeDays: 16, pullAgeDays: 16 }),
  };

  it("routes to the FREE connect_gsc and stops claiming the project is all set", () => {
    const text = renderWhatsNext(DENTNOTION);
    expect(text).toMatch(/run connect_gsc \(free\)/);
    expect(text).not.toMatch(/all set/i);
  });

  /**
   * The money assertion, made on MEANING rather than on a copy of the source sentence: whatever
   * the recommendation is worded as, the ONE thing the router tells this project to run must not
   * be a tool that charges. `generate_report` — the old answer — costs 15.
   */
  it("does not make a charged tool the one recommendation", () => {
    const primary = /run ([a-z_]+)/.exec(renderWhatsNext(DENTNOTION))?.[1] ?? "";
    expect(TOOL_COSTS[primary as ToolName]).toBe(0);
  });

  it("says the connection is not live, and does not blame an expired credential", () => {
    const text = renderWhatsNext(DENTNOTION);
    expect(text).toMatch(/no live connection/i);
    expect(text).not.toMatch(/expired/i);
  });
});

/**
 * S18 item 6 / S17 — the router must not recommend paid work against a domain that is not there.
 */
describe("renderWhatsNext — a domain that does not resolve", () => {
  const DEAD: WhatsNextState = {
    kind: "project",
    domain: "bu-domain-kesinlikle-yok-9f3a2c.com",
    signals: signals({ hasCrawl: false, crawlFresh: false, hasPull: false, pullFresh: false,
      gscConnected: false, domainUnreachable: true }),
  };

  it("names no priced tool anywhere in the answer", () => {
    const text = renderWhatsNext(DEAD);
    const priced = (Object.keys(TOOL_COSTS) as ToolName[]).filter((t) => TOOL_COSTS[t] > 0);
    expect(priced.length).toBeGreaterThan(10);
    for (const tool of priced) expect(text, tool).not.toContain(tool);
  });

  it("replaces the 20-credit crawl recommendation the live call produced", () => {
    expect(renderWhatsNext(DEAD)).not.toMatch(/crawl_site/);
    expect(renderWhatsNext(DEAD)).toMatch(/does not resolve/i);
  });

  /** A check that could not RUN must change nothing — the fail-open half, at the renderer. */
  it("routes an unchecked project exactly as before", () => {
    const unchecked = { ...DEAD, signals: { ...DEAD.signals, domainUnreachable: false } };
    const never = { ...DEAD, signals: signals({ hasCrawl: false, crawlFresh: false,
      hasPull: false, pullFresh: false, gscConnected: false }) };
    expect(renderWhatsNext(unchecked)).toBe(renderWhatsNext(never));
    expect(renderWhatsNext(never)).toMatch(/crawl_site/);
  });
});

describe("whats_next wires the DNS port", () => {
  it("accepts an injected reachability check and defaults to the real one", () => {
    // The tool builds with the port injected and with it omitted; the END-TO-END read
    // (project row -> domain -> port -> signal) needs a database and is pinned in
    // whats-next.db.test.ts, which this lane does not run.
    expect(makeWhatsNextTool({ checkDomain: async () => "no_such_domain" }).name).toBe("whats_next");
    expect(makeWhatsNextTool().name).toBe("whats_next");
  });
});

/**
 * S18 item 4 — ONE 16-day-old crawl, described by all three surfaces that talk about it.
 *
 * Measured 2026-08-25, same crawl, same day: `audit_schema` said `crawl from 2026-08-09`,
 * `generate_report` said `16 days ago`, and `whats_next` said "fresh" — with nothing anywhere
 * saying what "fresh" meant. Underneath, the number 30 was written out three times in three
 * packages, each with a comment explaining that it deliberately matched the others.
 *
 * WHAT IS PROVEN HERE, and what is not. The threshold is now ONE binding and all three names
 * resolve to it; the two surfaces that quote an age quote the same words from the same function;
 * and none of the three calls this crawl stale. NOT proven: `audit_schema` still prints a bare
 * timestamp and quotes no age — its renderers are pure and clockless and their output is frozen
 * byte-for-byte (audit/format-signals.test.ts) and digest-pinned (audit/format-graph.test.ts), so
 * giving them a clock is a different change. It cannot CONTRADICT the window; it does not yet
 * quote it, and the last case below pins exactly that much rather than pretending otherwise.
 */
describe("one crawl, three surfaces, one freshness window", () => {
  const CRAWLED_AT = "2026-08-09T00:00:00.000Z";
  const TODAY = "2026-08-25T00:00:00.000Z";
  const AGE_DAYS = 16;

  const CRAWL: AuditCrawl = {
    fetchedAt: CRAWLED_AT,
    skipped: [],
    pages: [
      {
        url: "https://dentnotion.com/",
        status: 200,
        title: "Home",
        metaDescription: "A description that is long enough to avoid a finding on this axis.",
        h1s: ["Home"],
        canonical: null,
        robotsMeta: null,
        links: [],
        wordCount: 500,
        jsonLdTypes: ["Organization"],
      },
    ],
  };

  /** The number itself: three names, one binding — not three numbers that happen to agree. */
  it("is one threshold under all three surfaces' names for it", () => {
    expect(FRESHNESS_WINDOW_DAYS).toBe(DATA_FRESHNESS_DAYS);
    expect(STALE_PULL_DAYS).toBe(DATA_FRESHNESS_DAYS);
    expect(STALE_CRAWL_DAYS).toBe(DATA_FRESHNESS_DAYS);
  });

  it("generate_report dates the crawl, ages it at 16 days, and does not call it stale", () => {
    const model = buildReportModel({
      domain: "dentnotion.com",
      title: "SEO report",
      generatedAt: TODAY,
      crawl: CRAWL,
      pull: null,
      pulledAt: null,
    });
    expect(model.crawl?.ageDays).toBe(AGE_DAYS);
    expect(model.crawl?.stale).toBe(false);
    const html = renderReportHtml(model);
    expect(html).toContain(CRAWLED_AT.slice(0, 10));
    expect(html).toContain(`${AGE_DAYS} days ago`);
    expect(html).not.toMatch(/This data is \d+ days old/);
  });

  it("whats_next quotes the SAME age in the SAME words, instead of an unanchored 'fresh'", () => {
    const text = renderWhatsNext({
      kind: "project",
      domain: "dentnotion.com",
      signals: signals({
        crawlAgeDays: dataAgeInDays(CRAWLED_AT, TODAY),
        pullAgeDays: dataAgeInDays(CRAWLED_AT, TODAY),
      }),
    });
    expect(text).toContain(`${AGE_DAYS} days ago`);
    expect(text).toContain(`${DATA_FRESHNESS_DAYS}-day freshness window`);
    // The word survives — it is now accompanied by the number that justifies it.
    expect(text).toMatch(/fresh crawl/);
  });

  it("audit_schema names the same crawl and contradicts neither of them", () => {
    const text = formatSchemaReport(auditSchema(CRAWL), CRAWL.fetchedAt);
    expect(text).toContain(CRAWLED_AT);
    // It makes no freshness claim at all — which is the honest reading of "does not disagree",
    // and is the remaining gap this describe's header names.
    expect(text).not.toMatch(/stale|fresh|days old|days ago/i);
  });

  /** The whole point of one binding: move it, and all three move together. */
  it("all three names move together — there is nothing left to drift", () => {
    expect(new Set([FRESHNESS_WINDOW_DAYS, STALE_PULL_DAYS, STALE_CRAWL_DAYS]).size).toBe(1);
    expect(dataAgeInDays(CRAWLED_AT, TODAY)).toBe(AGE_DAYS);
    expect(AGE_DAYS).toBeLessThan(DATA_FRESHNESS_DAYS);
  });
});

/**
 * IDN PROJECTS READ AS THE CUSTOMER TYPED THEM, on BOTH renderers.
 *
 * Projects are stored as A-labels. `list_projects` has rendered them through `displayDomain`
 * since 2026-08-26 and `setup_project`'s receipt through `displayDomainWithAscii` — whats_next
 * did neither, so the same project was `smoke-dalga2-örnek.com` in one free tool and
 * `xn--smoke-dalga2-rnek-c0b.com` in the next (measured live 2026-08-27, defect E-1).
 *
 * TWO renderers, pinned separately, because that is the axis the previous round missed: the
 * choose_project LIST and the formatNextStep HEADER are different code paths over the same field,
 * and fixing one leaves the other printing punycode (signed lesson 14 — the D-6 shape: which
 * SENTENCE inside one answer, not which tool).
 *
 * The U-label is asserted present AND the A-label absent. Present-only would pass on a renderer
 * that printed both, which is the receipt's format, not this one's.
 */
describe("whats_next renders IDN projects as the customer typed them", () => {
  const ASCII = "xn--smoke-dalga2-rnek-c0b.com";
  const UNICODE = "smoke-dalga2-örnek.com";

  it("the choose_project list shows the U-label, not the A-label", () => {
    const text = renderWhatsNext({
      kind: "choose_project",
      projects: [
        { id: "p-1", domain: ASCII },
        { id: "p-2", domain: "plain-ascii.com" },
      ],
    });
    expect(text).toContain(UNICODE);
    expect(text).not.toContain(ASCII);
    // The id is what the caller pastes back; it must survive the display change untouched.
    expect(text).toContain("p-1");
  });

  it("the routed header shows the U-label, not the A-label", () => {
    const text = formatNextStep(ASCII, decideProjectNextStep(signals({ hasCrawl: false, crawlFresh: false })));
    expect(text).toContain(UNICODE);
    expect(text).not.toContain(ASCII);
  });

  it("the all-set header shows it too — the other half of the same sentence", () => {
    const text = formatNextStep(ASCII, decideProjectNextStep(signals()));
    expect(text).toMatch(/all set/i);
    expect(text).toContain(UNICODE);
    expect(text).not.toContain(ASCII);
  });

  it("leaves a plain ASCII domain byte-identical", () => {
    const text = formatNextStep("example.com", decideProjectNextStep(signals()));
    expect(text).toContain("example.com");
  });
});

/**
 * E-9's probe, pinned at the SOURCE — the half no fast-lane double can reach.
 *
 * `readHasAnalysis` runs on a service-role client that BYPASSES RLS, so its `.eq("user_id", …)`
 * is the only thing standing between one tenant's ladder and another tenant's analysis rows
 * (NEVER #4). A recorder double cannot prove a filter it never receives, and the db lane proves
 * the behaviour on one path; this asserts the construction on all three, so a filter dropped from
 * the SECOND statement cannot hide behind the first.
 */
/**
 * The slice of `body` belonging to ONE `.from("<table>")` statement: from that call up to the
 * NEXT `.from(` (or the end).
 *
 * A SLICE, NOT A SPANNING REGEX, and this is measured rather than cautious. The first version
 * asserted `.from("X") … .eq("user_id") … .eq("project_id")` with a lazy `[\s\S]{0,300}?`
 * between them, and its own comment claimed that stopped a filter "belonging to a NEIGHBOURING
 * read" from satisfying it. It did not: deleting `.eq("user_id", …)` from the SECOND of the three
 * statements left the pin green, because the lazy gap simply ran on into the third statement and
 * borrowed its filters. Only the LAST statement was actually pinned — two of the three tenant
 * guards were unenforced by a spec that read as though it covered all three.
 *
 * Signed lesson 14, on the position axis: the pin was written against one arrangement of the
 * statements and never varied WHICH of them was broken.
 */
function fromSegment(body: string, table: string): string {
  const start = body.search(new RegExp(`\\.from\\(\\s*["']${table}["']\\s*\\)`));
  if (start === -1) throw new Error(`no .from("${table}") call to slice`);
  const rest = body.slice(start + 1);
  const next = rest.search(/\.from\(/);
  return next === -1 ? body.slice(start) : body.slice(start, start + 1 + next);
}

describe("readHasAnalysis is scoped by construction", () => {
  const SOURCE = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "whats-next.ts"),
    "utf8",
  );
  /**
   * Comments out, statements only — PROSE IS NOT CODE, the same rule parity.test.ts states and
   * for the same reason, measured here on the first run: the negative below matched the word
   * `selectOwn` inside this function's own doc comment, which EXPLAINS why selectOwn is not used.
   * A pin that reddens on an accurate explanation of itself is a pin that gets deleted.
   */
  const codeOf = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  const BODY = SOURCE.slice(SOURCE.indexOf("export async function readHasAnalysis"));
  const PROBE = codeOf(BODY.slice(0, BODY.indexOf("\n}") + 2));

  it.each(["audit_runs", "gsc_discovery_runs", "audit_content_runs"])(
    "scopes its %s read by BOTH user_id and project_id",
    (table) => {
      const segment = fromSegment(PROBE, table);
      expect(segment, `${table}: no user_id filter in its own statement`).toMatch(
        /\.eq\(\s*["']user_id["']/,
      );
      expect(segment, `${table}: no project_id filter in its own statement`).toMatch(
        /\.eq\(\s*["']project_id["']/,
      );
    },
  );

  it("never reaches for the id-only read, and never widens past `id`", () => {
    expect(PROBE).not.toMatch(/selectOwn|\.select\(\s*["']\*/);
    expect([...PROBE.matchAll(/\.select\(\s*["']([^"']*)["']\s*\)/g)].map((m) => m[1])).toEqual([
      "id",
      "id",
      "id",
    ]);
    // Existence, not a census: one row answers the ladder's question on each table.
    expect([...PROBE.matchAll(/\.limit\(\s*1\s*\)/g)]).toHaveLength(3);
  });

  /**
   * THE ARGUMENT ORDER, which `tsc` cannot see: `userId` and `projectId` are both `string`, so
   * swapping them at the call site typechecks and silently answers `false` forever — every
   * all-set customer routed to find_quick_wins, every gate green. Pinned where the caller is.
   */
  it("is called with (client, userId, projectId), in that order", () => {
    expect(codeOf(SOURCE)).toMatch(/readHasAnalysis\(\s*client\s*,\s*userId\s*,\s*projectId\s*\)/);
  });
});
