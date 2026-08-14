import { describe, expect, it, vi } from "vitest";

/**
 * IMPORT IDENTITY — the card does not merely agree with core's ladder, it CALLS core's ladder.
 *
 * Its own file because `vi.mock` is hoisted to the top of whichever module it appears in: the
 * value-parity specs next door must run against the real, unwrapped module, so the wrapping
 * lives here. `importOriginal` keeps the real implementation (this is a spy, not a stub), so the
 * assertion below is about WHICH function ran, not about what it returned.
 */
const decideSpy = vi.hoisted(() => vi.fn());

vi.mock("@pseo/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pseo/core")>();
  decideSpy.mockImplementation(actual.decideProjectNextStep);
  return { ...actual, decideProjectNextStep: decideSpy };
});

const { buildProjectCard } = await import("./card");

describe("buildProjectCard's ladder", () => {
  it("is @pseo/core's decideProjectNextStep, called with the derived signals", () => {
    const card = buildProjectCard(
      {
        project: { id: "p-1", domain: "example.com", created_at: "2026-01-02T00:00:00.000Z" },
        crawl: null,
        pull: null,
        connection: { account_id: null, gsc_property: "https://example.com/" },
      },
      new Date("2026-08-14T12:00:00.000Z"),
    );

    // Wrapping core's export changed what the card ran, which is only possible if the card
    // imports it from there — a local copy would be untouched by this mock.
    expect(decideSpy).toHaveBeenCalledExactlyOnceWith({
      hasCrawl: false,
      crawlFresh: false,
      gscConnected: false,
      hasPull: false,
      pullFresh: false,
    });
    expect(card.nextStep.primary).toBe("crawl_site");
  });
});
