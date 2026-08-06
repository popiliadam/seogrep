import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "./index.ts";
import { PAID_BALANCE_TOOLS } from "../credits/paid-balance.ts";

/**
 * Honesty pins for what the four DataForSEO tools SAY about themselves in tools/list — the
 * surface an MCP client shows a user before they spend 25 / 65 / 70 / 90 credits.
 *
 * Two lies are pinned shut here, both of the same kind: a description that asserts a
 * DEPLOYMENT STATE it cannot see.
 *
 *   1. "Live DataForSEO data is off during beta" was true only while DFS_LIVE was unset. The
 *      flag is an operator switch; the moment it flips, every one of these sentences starts
 *      telling paying customers the tool does not work. A description is static text compiled
 *      into the binary — it must describe the RULE ("if access is off, you are told and charged
 *      nothing"), never claim to know which side of the switch this deployment is on.
 *   2. Silence about the paid-balance requirement. A trial user reading "Costs 65 credits" with
 *      200 credits in hand reasonably concludes they can run it. They cannot.
 */

const GATED = [...PAID_BALANCE_TOOLS];

function descriptionOf(name: string): string {
  const tool = ALL_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`${name} is not registered in ALL_TOOLS`);
  return tool.description;
}

describe("DataForSEO tool descriptions", () => {
  it("covers all four gated tools", () => {
    expect(GATED).toHaveLength(4);
  });

  it.each(GATED)("%s does not assert that live data is off", (name) => {
    // Any present-tense claim about the switch's position: true today, false the hour the
    // operator sets DFS_LIVE=1, and nothing in the deploy would flag it.
    expect(descriptionOf(name)).not.toMatch(/off during (the )?beta/i);
    expect(descriptionOf(name)).not.toMatch(/is (currently )?(turned )?off\b/i);
  });

  it.each(GATED)("%s states that a paid balance is required", (name) => {
    expect(descriptionOf(name)).toMatch(/paid (credit )?balance/i);
  });

  it.each(GATED)("%s still promises the free refusal when access is unavailable", (name) => {
    // The pre-reserve honesty gate is a real product promise (constitution NEVER #2 and #7).
    // Dropping it from the copy while fixing the beta claim would be a second lie by omission.
    expect(descriptionOf(name)).toMatch(/charges nothing|not charged|no credits/i);
  });

  it("leaves the ungated tools saying nothing about a paid balance", () => {
    // A copy fix that leaked onto crawl/audit/report would misdescribe the trial.
    const ungated = ALL_TOOLS.filter((tool) => !PAID_BALANCE_TOOLS.has(tool.name));
    for (const tool of ungated) {
      expect(tool.description, `${tool.name} should not mention a paid balance`).not.toMatch(
        /paid (credit )?balance/i,
      );
    }
  });
});
