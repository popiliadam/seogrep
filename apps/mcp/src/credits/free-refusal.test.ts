import { describe, expect, it, vi } from "vitest";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

/**
 * withCredits is a PASS-THROUGH here. The three tools below are PRICED (5 / 12 / 10 credits) and
 * charge:"surface", so the real guard opens a reserve against Supabase before the handler runs —
 * which this DB-less lane has no stack for. The pass-through removes the reserve and NOTHING else:
 * it cannot supply the sentence under test, because the sentence is appended by the registry's
 * catch, in a different module, after the handler has already thrown.
 */
vi.mock("./guard.ts", () => ({
  withCredits: async <T>(_ctx: unknown, _meta: unknown, fn: () => Promise<T>): Promise<T> => fn(),
  isReserveCommitFailed: () => false,
}));

import type { AuthContext } from "../auth.ts";
import type { ToolName } from "./costs.ts";
import { TOOL_COSTS } from "./costs.ts";
import { NO_CRAWL_MESSAGE } from "../audit/load.ts";
import { NO_PULL_MESSAGE } from "../gsc-data/load.ts";
import { ARCHIVED_PROJECT_MESSAGE } from "../tools/project-target.ts";
import { registerAll, type RegisteredTool } from "../tools/registry.ts";
import { makeAuditSchemaTool } from "../tools/audit-schema.ts";
import { makeAuditContentTool } from "../tools/audit-content.ts";
import { makeFindQuickWinsTool } from "../tools/find-quick-wins.ts";
import { NOT_CHARGED_SENTENCE, statesNoCharge, withNoChargeNote } from "./free-refusal.ts";

/**
 * The fee sentence — "you were not charged" — on the branches that refuse for free.
 *
 * Measured 2026-08-25 (tool review card 12): `audit_schema` on a project with no crawl left the
 * balance at 5630 before and 5630 after, and said nothing about it, while `keyword_positions` in
 * the same state says so. The assertions below are REGEXES ON MEANING, never a copy of the
 * source string: a test that greps the literal it is guarding passes whatever the literal says
 * (signed lesson 11).
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };
const PROJECT_ID = "0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7";
const ARCHIVED = {
  id: PROJECT_ID,
  domain: "example.com",
  archivedAt: "2026-08-01T00:00:00.000Z",
};

/** "this money cost you nothing", however a refusal chooses to word it. */
const NO_CHARGE = /\b(?:not|never)\s+charged\b|\bcharge[sd]?\s+nothing\b|\bno\s+credits\s+were\s+charged\b/i;

type CallFn = (request: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;

/** Wire ONE tool behind registerAll — the real dispatch path, catch included. */
function call(tool: RegisteredTool, name: ToolName): Promise<{ content: { text: string }[]; isError?: boolean }> {
  const handlers = new Map<unknown, (request: unknown) => unknown>();
  const server = {
    setRequestHandler: (schema: unknown, handler: (request: unknown) => unknown) => {
      handlers.set(schema, handler);
    },
  } as unknown as Server;
  registerAll(server, { ctx: CTX, tools: [tool] });
  const dispatch = handlers.get(CallToolRequestSchema) as CallFn;
  return dispatch({ params: { name, arguments: { project_id: PROJECT_ID } } });
}

describe("withNoChargeNote", () => {
  it("appends the sentence to a refusal that does not carry one", () => {
    expect(withNoChargeNote("No crawl found for this project.")).toMatch(NO_CHARGE);
  });

  it("leaves the refusal's own words in front, whole", () => {
    expect(withNoChargeNote("abc").startsWith("abc ")).toBe(true);
  });

  it("adds NOTHING to a refusal that already says it, in any of the wordings in use", () => {
    for (const already of [
      "…and you were not charged.",
      "…the tool says so and charges nothing.",
      "…No credits were charged.",
      "…so you will not be charged for it.",
      "…nothing was charged.",
    ]) {
      expect(statesNoCharge(already)).toBe(true);
      expect(withNoChargeNote(already)).toBe(already);
    }
  });

  it("promises NOTHING when the caller has nothing to promise (note === null)", () => {
    // The charge:"worker" carve-out: the reserve belongs to a background job this request
    // cannot see, so a blanket "you were not charged" would be a claim about an undecided charge.
    expect(withNoChargeNote("No crawl found.", null)).toBe("No crawl found.");
  });

  it("does not mistake an ordinary refusal for one that states the fee", () => {
    expect(statesNoCharge(NO_CRAWL_MESSAGE)).toBe(false);
    expect(statesNoCharge(NO_PULL_MESSAGE)).toBe(false);
    expect(statesNoCharge(ARCHIVED_PROJECT_MESSAGE)).toBe(false);
  });
});

describe("every free refusal states the fee — one helper, three priced tools", () => {
  /**
   * The three loaders' own sentences carry no fee wording. Pinned FIRST and explicitly, because
   * the fakes below hand those very constants to the tools: if a constant already said it, the
   * assertions after would pass without the production path doing anything at all.
   */
  it("the loader sentences the fakes supply say nothing about money", () => {
    expect(NO_CRAWL_MESSAGE).not.toMatch(NO_CHARGE);
    expect(NO_PULL_MESSAGE).not.toMatch(NO_CHARGE);
    expect(ARCHIVED_PROJECT_MESSAGE).not.toMatch(NO_CHARGE);
  });

  it("audit_schema (5 credits): no crawl -> refuses, and says the refusal was free", async () => {
    const tool = makeAuditSchemaTool({
      loadCrawl: async () => ({ ok: false, error: NO_CRAWL_MESSAGE }),
      loadProject: async () => null,
    });
    const result = await call(tool, "audit_schema");

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text.startsWith(NO_CRAWL_MESSAGE)).toBe(true);
    expect(result.content[0]?.text).toMatch(NO_CHARGE);
    expect(result.content[0]?.text).not.toMatch(/failed unexpectedly/i);
  });

  it("audit_content (12 credits): archived project -> refuses, and says the refusal was free", async () => {
    const tool = makeAuditContentTool({
      loadProject: async () => ARCHIVED,
      loadPull: async () => ({ ok: false, error: NO_PULL_MESSAGE }),
      loadCrawl: async () => ({ ok: false, error: NO_CRAWL_MESSAGE }),
    });
    const result = await call(tool, "audit_content");

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text.startsWith(ARCHIVED_PROJECT_MESSAGE)).toBe(true);
    expect(result.content[0]?.text).toMatch(NO_CHARGE);
  });

  it("find_quick_wins (10 credits): no Search Console pull -> refuses, and says the refusal was free", async () => {
    const tool = makeFindQuickWinsTool({
      loadPull: async () => ({ ok: false, error: NO_PULL_MESSAGE }),
      loadProject: async () => null,
    });
    const result = await call(tool, "find_quick_wins");

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text.startsWith(NO_PULL_MESSAGE)).toBe(true);
    expect(result.content[0]?.text).toMatch(NO_CHARGE);
  });

  it("all three are PRICED — which is the only reason the sentence is worth saying", () => {
    expect(TOOL_COSTS.audit_schema).toBeGreaterThan(0);
    expect(TOOL_COSTS.audit_content).toBeGreaterThan(0);
    expect(TOOL_COSTS.find_quick_wins).toBeGreaterThan(0);
  });

  it("the sentence has ONE source", () => {
    expect(withNoChargeNote("x")).toBe(`x ${NOT_CHARGED_SENTENCE}`);
  });
});
