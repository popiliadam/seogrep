import { describe, expect, it } from "vitest";
import { mcpHeaderEndpoint, mcpUrlDisplayParts } from "./mcp-endpoint";

describe("mcpHeaderEndpoint", () => {
  it("strips the /{key} segment from the personal-URL template", () => {
    expect(mcpHeaderEndpoint("https://mcp.seogrep.com/mcp/{key}")).toBe("https://mcp.seogrep.com/mcp");
  });

  it("tolerates a trailing slash after the placeholder", () => {
    expect(mcpHeaderEndpoint("https://mcp.seogrep.com/mcp/{key}/")).toBe("https://mcp.seogrep.com/mcp");
  });

  it("follows the template's host instead of a second hardcoded one", () => {
    expect(mcpHeaderEndpoint("http://localhost:8787/mcp/{key}")).toBe("http://localhost:8787/mcp");
  });

  it("returns null rather than inventing an address when there is no /{key} to strip", () => {
    expect(mcpHeaderEndpoint("https://mcp.seogrep.com/mcp")).toBeNull();
    expect(mcpHeaderEndpoint("")).toBeNull();
    // A key placed anywhere other than the final path segment is not a form we can reduce.
    expect(mcpHeaderEndpoint("https://mcp.seogrep.com/{key}/mcp")).toBeNull();
  });
});

describe("mcpUrlDisplayParts", () => {
  it("splits the live template around the placeholder", () => {
    expect(mcpUrlDisplayParts("https://mcp.seogrep.com/mcp/{key}")).toEqual({
      before: "https://mcp.seogrep.com/mcp/",
      after: "",
    });
  });

  // The shape the marketing pages published for weeks. It is handled not because it is coming back,
  // but because a helper that only fits today's template is the same bug in a new place.
  it("handles a placeholder that is NOT the last segment", () => {
    expect(mcpUrlDisplayParts("https://mcp.seogrep.com/u/{key}/mcp")).toEqual({
      before: "https://mcp.seogrep.com/u/",
      after: "/mcp",
    });
  });

  it("follows the template's host rather than a second hardcoded one", () => {
    expect(mcpUrlDisplayParts("http://localhost:8787/mcp/{key}")?.before).toBe("http://localhost:8787/mcp/");
  });

  it("returns null rather than inventing an address when there is no placeholder", () => {
    expect(mcpUrlDisplayParts("https://mcp.seogrep.com/mcp")).toBeNull();
    expect(mcpUrlDisplayParts("")).toBeNull();
  });

  it("reassembles into the same URL mcpUrlFor would build", () => {
    const template = "https://mcp.seogrep.com/mcp/{key}";
    const parts = mcpUrlDisplayParts(template);
    expect(`${parts?.before}sg_demo${parts?.after}`).toBe(template.replace("{key}", "sg_demo"));
  });
});
