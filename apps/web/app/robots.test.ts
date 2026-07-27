import { describe, expect, it } from "vitest";
import { SITE_URL } from "../lib/site";
import robots from "./robots";

const rules = () => {
  const value = robots().rules;
  if (Array.isArray(value)) throw new Error("expected a single rule group");
  return value;
};

describe("robots.txt", () => {
  it("keeps the public site crawlable by everyone", () => {
    expect(rules().userAgent).toBe("*");
    expect(rules().allow).toBe("/");
  });

  it("keeps the signed-in dashboard out of the index", () => {
    expect(rules().disallow).toBe("/app");
  });

  it("points crawlers at the sitemap on the canonical host", () => {
    expect(robots().sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });
});
