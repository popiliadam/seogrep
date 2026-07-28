import { describe, expect, it } from "vitest";
import { resolveBaseUrl } from "./site";

/**
 * L-07 unit pins for the shared base-URL resolver. The class being closed: `env ?? FALLBACK`
 * only fires on null/undefined, so a SET-but-EMPTY (or malformed) value silently survives and
 * every composed link comes out relative. resolveBaseUrl treats "absent" as a STRUCTURAL
 * property (signed lesson #6: validate URL shape, not presence).
 */
describe("resolveBaseUrl", () => {
  it("returns undefined for unset, empty and whitespace-only values (the `??` blind spot)", () => {
    expect(resolveBaseUrl(undefined)).toBeUndefined();
    expect(resolveBaseUrl("")).toBeUndefined();
    expect(resolveBaseUrl("   ")).toBeUndefined();
    expect(resolveBaseUrl("\n\t ")).toBeUndefined();
  });

  it("returns undefined for values that are not absolute http(s) URLs", () => {
    expect(resolveBaseUrl("seogrep.com")).toBeUndefined(); // no scheme -> not absolute
    expect(resolveBaseUrl("/app")).toBeUndefined(); // relative path
    expect(resolveBaseUrl("javascript:alert(1)")).toBeUndefined(); // wrong scheme
    expect(resolveBaseUrl("ftp://seogrep.com")).toBeUndefined();
  });

  it("returns the trimmed origin for a valid absolute URL", () => {
    expect(resolveBaseUrl("https://seogrep.com")).toBe("https://seogrep.com");
    expect(resolveBaseUrl("  https://seogrep.com  ")).toBe("https://seogrep.com");
    expect(resolveBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("strips trailing slashes so composed links never double up", () => {
    expect(resolveBaseUrl("https://seogrep.com/")).toBe("https://seogrep.com");
    expect(resolveBaseUrl("https://seogrep.com///")).toBe("https://seogrep.com");
    expect(resolveBaseUrl("https://seogrep.com/base/")).toBe("https://seogrep.com/base");
  });
});
