import { describe, expect, it } from "vitest";
import {
  REL_ATTRIBUTES_NOTE,
  hasQualifyingRelAttribute,
  relAttributesClause,
} from "./rel-attributes.ts";

/**
 * R-6.2 lives in one module because FOUR tools print the same vendor field, and the same
 * distinction explained four ways is how one of them ends up flattening `sponsored` into
 * "nofollow" again.
 */
describe("relAttributesClause", () => {
  it("prints the vendor's values under the vendor's own field name, in the order they arrived", () => {
    expect(relAttributesClause(["sponsored", "nofollow"])).toBe(
      "DataForSEO attributes: sponsored, nofollow",
    );
  });

  it("does not rename, sort or deduplicate what the vendor sent", () => {
    expect(relAttributesClause(["ugc", "noopener", "ugc"])).toBe(
      "DataForSEO attributes: ugc, noopener, ugc",
    );
  });

  /** A silence stays a silence: no clause at all, never "no rel attribute". */
  it("returns null for an absent list AND for an empty one", () => {
    expect(relAttributesClause(null)).toBeNull();
    expect(relAttributesClause([])).toBeNull();
  });
});

describe("hasQualifyingRelAttribute", () => {
  it("is true for each of the three values R-6.2 names", () => {
    expect(hasQualifyingRelAttribute(["nofollow"])).toBe(true);
    expect(hasQualifyingRelAttribute(["sponsored"])).toBe(true);
    expect(hasQualifyingRelAttribute(["ugc"])).toBe(true);
  });

  it("is false for a value that says nothing about link equity, and for a vendor silence", () => {
    expect(hasQualifyingRelAttribute(["noopener"])).toBe(false);
    expect(hasQualifyingRelAttribute([])).toBe(false);
    expect(hasQualifyingRelAttribute(null)).toBe(false);
  });

  it("finds a qualifying value beside a non-qualifying one", () => {
    expect(hasQualifyingRelAttribute(["noopener", "sponsored"])).toBe(true);
  });
});

describe("REL_ATTRIBUTES_NOTE", () => {
  it("names all three declarations and says whose judgement is absent", () => {
    expect(REL_ATTRIBUTES_NOTE).toContain("nofollow");
    expect(REL_ATTRIBUTES_NOTE).toContain("sponsored");
    expect(REL_ATTRIBUTES_NOTE).toContain("ugc");
    expect(REL_ATTRIBUTES_NOTE).toContain("SeoGrep adds no judgement of its own");
  });
});
