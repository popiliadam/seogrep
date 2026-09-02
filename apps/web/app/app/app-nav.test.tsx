import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppNav } from "./app-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/projects" }));

const ITEMS = [
  { href: "/app", label: "Projects" },
  { href: "/app/projects", label: "Detail" },
  { href: "/app/billing", label: "Billing" },
] as const;

describe("AppNav", () => {
  it("marks the active section with aria-current", () => {
    render(<AppNav items={ITEMS} />);
    expect(screen.getByRole("link", { name: "Detail" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Billing" }).getAttribute("aria-current")).toBeNull();
  });

  /**
   * L-07 and the WCAG 2.1.1 failure underneath it. The strip scrolls horizontally on a narrow
   * viewport; a scrollable region that cannot take focus cannot be panned without a pointer.
   * Tabbing to the LINKS is not the same thing — with more tabs than fit, the region itself has
   * to be reachable.
   */
  it("is a keyboard-reachable, named scroll region", () => {
    render(<AppNav items={ITEMS} />);
    const strip = screen.getByRole("list", { name: "Sections" });
    expect(strip.getAttribute("tabindex")).toBe("0");
  });

  it("carries the pure-CSS scroll affordance alongside the overflow (L-07)", () => {
    render(<AppNav items={ITEMS} />);
    const strip = screen.getByRole("list", { name: "Sections" });
    // Both halves are asserted: overflow WITHOUT the hint is the shipped defect, and the hint
    // without overflow would be decoration on a strip that never scrolls.
    expect(strip.className).toContain("overflow-x-auto");
    expect(strip.className).toContain("scroll-hint-x");
  });
});
