import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Page from "./page";

describe("pricing page", () => {
  it("pins the draft package numbers from the spec", () => {
    render(<Page />);
    for (const text of ["$19", "$49", "$149", "1,000", "3,500", "12,000", "200 credits"]) {
      expect(screen.getAllByText(new RegExp(text.replace("$", "\\$"))).length).toBeGreaterThan(0);
    }
  });

  it("shows the beta badge and no popularity claims", () => {
    render(<Page />);
    expect(screen.getAllByText(/beta pricing/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/most popular/i)).toBeNull();
  });
});
