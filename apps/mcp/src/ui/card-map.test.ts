import { describe, expect, it } from "vitest";
import { TOOL_COSTS, type ToolName } from "../credits/costs.ts";
import { CARDED_TOOLS, CARD_KIND_BY_TOOL } from "./card-map.ts";
import { cardSchema } from "./card-model.ts";

/**
 * The map is the spec's §3 table as code. TypeScript catches a MISSING tool (Record<ToolName,…>
 * is exhaustive); only a test can catch an EXTRA key or a count that drifted from the spec.
 */
describe("every tool is mapped to a card kind", () => {
  const tools = Object.keys(TOOL_COSTS) as ToolName[];

  it("maps exactly the real tool surface, no more and no less", () => {
    expect(Object.keys(CARD_KIND_BY_TOOL).sort()).toEqual([...tools].sort());
  });

  it("holds the counts the spec states", () => {
    const counted = { metric: 0, list: 0, report: 0, action: 0 };
    for (const kind of Object.values(CARD_KIND_BY_TOOL)) counted[kind] += 1;
    expect(counted).toEqual({ metric: 1, list: 14, report: 14, action: 9 });
    expect(tools).toHaveLength(38);
  });

  /**
   * Staged rollout means "not carded yet" is a LEGITIMATE state — but a NAMED one. Every tool
   * that ships a card today must be in the map; nothing may ship a card without a planned kind.
   */
  it("ships cards only for tools that have a planned kind", () => {
    for (const tool of CARDED_TOOLS) {
      expect(CARD_KIND_BY_TOOL[tool]).toBeDefined();
    }
  });

  it("ships exactly the slice-1 surface", () => {
    expect([...CARDED_TOOLS]).toEqual(["get_credit_balance"]);
  });
});

describe("the card model rejects what it cannot render", () => {
  it("accepts a metric card", () => {
    expect(
      cardSchema.safeParse({ kind: "metric", title: "Credit balance", value: "4519" }).success,
    ).toBe(true);
  });

  it("rejects a kind no renderer exists for yet", () => {
    expect(cardSchema.safeParse({ kind: "list", title: "x", rows: [] }).success).toBe(false);
  });

  it("rejects an empty headline — a card may not show a blank where a number belongs", () => {
    expect(cardSchema.safeParse({ kind: "metric", title: "x", value: "" }).success).toBe(false);
  });

  /**
   * Fix round 1, finding 1. A plain `z.object` strips a key it does not recognise, so a
   * mis-shaped payload — the wrong `kind` carrying another kind's field, or a typo'd key —
   * parses clean and renders short with no error anywhere. `strictObject` must refuse it.
   */
  it("rejects an unknown key instead of silently stripping it", () => {
    expect(
      cardSchema.safeParse({ kind: "metric", title: "x", value: "1", rows: [] }).success,
    ).toBe(false);
  });

  /**
   * Fix round 1, finding 2. Whitespace-only satisfies a bare `.min(1)` while rendering exactly
   * the blank figure the "a card may not fabricate" constraint forbids.
   */
  it("rejects a whitespace-only value", () => {
    expect(cardSchema.safeParse({ kind: "metric", title: "x", value: "   " }).success).toBe(
      false,
    );
  });

  /** Keeps the schema from simply refusing everything: a real card with facts still parses. */
  it("still accepts a well-formed metric card with facts", () => {
    expect(
      cardSchema.safeParse({
        kind: "metric",
        title: "Credit balance",
        value: "4519",
        unit: "credits",
        facts: [{ label: "Plan", value: "Pro" }],
      }).success,
    ).toBe(true);
  });
});
