import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "./page";

describe("Home", () => {
  it("h1 kod adını gösteriyor", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("pseo-saas");
  });
});
