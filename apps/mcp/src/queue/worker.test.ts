import { afterEach, describe, expect, it } from "vitest";
import { clearToolHandlers, getToolHandler, registerToolHandler } from "./worker.ts";

/**
 * Fast-lane tests for the tool-handler registry. Real tool handlers land in later
 * tasks; the registry contract (register once, look up, no silent overwrite) is
 * what the queue consumer builds on.
 */

afterEach(() => {
  clearToolHandlers();
});

describe("tool handler registry", () => {
  it("returns a registered handler", () => {
    const handler = async (): Promise<null> => null;
    registerToolHandler("whats_next", handler);
    expect(getToolHandler("whats_next")).toBe(handler);
  });

  it("returns undefined for a tool with no handler", () => {
    expect(getToolHandler("crawl_site")).toBeUndefined();
  });

  it("rejects duplicate registration instead of silently overwriting", () => {
    registerToolHandler("whats_next", async () => null);
    expect(() => registerToolHandler("whats_next", async () => null)).toThrow(
      /already registered/,
    );
  });
});
