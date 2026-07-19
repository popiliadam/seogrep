import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  decideProjectNextStep,
  formatNextStep,
  makeWhatsNextTool,
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
});
