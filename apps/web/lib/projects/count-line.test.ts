import { describe, expect, it } from "vitest";
import { projectCountLine } from "./count-line";

/**
 * Overview's one-line answer to "am I tracking anything?". The copy is pinned verbatim — it is
 * the first sentence a new account reads about projects, and the whole line exists to send them
 * to /app/projects.
 */
describe("projectCountLine", () => {
  it("says nothing is tracked yet at zero", () => {
    expect(projectCountLine(0)).toBe("No projects yet.");
  });

  it("uses the singular for exactly one — the count a first-day account has", () => {
    expect(projectCountLine(1)).toBe("You are tracking 1 project.");
  });

  it("names the number for more than one", () => {
    expect(projectCountLine(2)).toBe("You are tracking 2 projects.");
    expect(projectCountLine(9)).toBe("You are tracking 9 projects.");
    expect(projectCountLine(137)).toBe("You are tracking 137 projects.");
  });

  /**
   * A count PostgREST did not return, or a nonsense one, reads as none rather than inventing a
   * figure — the page would otherwise say "You are tracking null projects."
   */
  it("treats an absent or impossible count as none", () => {
    expect(projectCountLine(null)).toBe("No projects yet.");
    expect(projectCountLine(-1)).toBe("No projects yet.");
  });
});
