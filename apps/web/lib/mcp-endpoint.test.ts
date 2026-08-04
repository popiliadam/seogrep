import { describe, expect, it } from "vitest";
import { mcpHeaderEndpoint } from "./mcp-endpoint";

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
