import { describe, expect, it } from "vitest";
import { CREDIT_PACKAGES } from "../billing/packages.js";
import { welcomeEmail } from "./welcome.js";

describe("welcomeEmail", () => {
  const input = {
    dashboardUrl: "https://seogrep.com/app/connection",
    docsUrl: "https://seogrep.com/docs",
  };

  it("uses the fixed English subject", () => {
    expect(welcomeEmail(input).subject).toBe("Welcome to SeoGrep");
  });

  it("states the trial credit count from CREDIT_PACKAGES (never hardcoded)", () => {
    const { html } = welcomeEmail(input);
    expect(html).toContain(String(CREDIT_PACKAGES.trial.credits));
  });

  it("interpolates the connection CTA and the docs link", () => {
    const { html } = welcomeEmail(input);
    expect(html).toContain(input.dashboardUrl);
    expect(html).toContain(input.docsUrl);
  });
});
