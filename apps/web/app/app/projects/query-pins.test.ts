import { describe, expect, it } from "vitest";
import {
  errorBranchOf,
  fanOutBindingsOf,
  filtersOf,
  paramsOf,
  returnPropsOf,
  singleRowTerminatorsOf,
} from "./query-pins";

/**
 * THE PARSERS' OWN GATE — because a source pin is only worth what its parser rejects.
 *
 * The six functions in `query-pins.ts` are what turn "the column name appears" into "the column is
 * compared against the right thing". Each of them can fail in exactly one direction that no spec
 * using them would notice: understand a body it should have refused, and hand back an empty Map or
 * a `-1` that makes the pin above it pass forever (signed lesson 12).
 *
 * So the cases below are mostly NEGATIVE. The positive ones fix the reading; the negative ones are
 * the whole point — each is a body a careless parser accepts, and each must throw.
 */

const WHAT = "the parser self-test";

describe("paramsOf names the identifiers a read was handed", () => {
  it("drops the types and keeps the order", () => {
    expect(paramsOf("function f(supabase: Supabase, userId: string, tool: string) {", WHAT)).toEqual([
      "supabase",
      "userId",
      "tool",
    ]);
  });

  /** A generic parameter type carries a comma; splitting on every comma would invent a parameter. */
  it("does not split inside a generic type", () => {
    expect(paramsOf("function f(a: Map<string, Row>, b: string) {", WHAT)).toEqual(["a", "b"]);
  });

  it("refuses a body with no parameter list rather than reporting none", () => {
    expect(() => paramsOf("const x = 1;", WHAT)).toThrow(/no parameter list/i);
  });
});

describe("filtersOf reads the VALUE each column is compared against", () => {
  it("reads .eq and .is alike", () => {
    const filters = filtersOf('.eq("user_id", userId).is("archived_at", null)', WHAT);
    expect(filters.get("user_id")).toBe("userId");
    expect(filters.get("archived_at")).toBe("null");
  });

  /**
   * THE FALSE-POSITIVE LINE. `.filter("user_id", "eq", userId)` is the same query written the long
   * way; a parser that only knew `.eq` would redden on a legitimate rewording, and a spec that
   * reddens on a rewording is a spec people learn to edit.
   */
  it("accepts the longhand .filter(column, \"eq\", value) as the same filter", () => {
    expect(filtersOf('.filter("user_id", "eq", userId)', WHAT).get("user_id")).toBe("userId");
  });

  /** …but not `.filter(column, "neq", …)`, which is a different query entirely. */
  it("does not read a non-equality .filter as an equality filter", () => {
    expect(() => filtersOf('.filter("user_id", "neq", userId)', WHAT)).toThrow(/no .*filter at all/i);
  });

  /** A `)` inside the select list must not close the filter call early. */
  it("is not confused by a bracket inside a string literal", () => {
    const filters = filtersOf('.select("a, b(c)").eq("user_id", userId)', WHAT);
    expect(filters.get("user_id")).toBe("userId");
  });

  it("refuses a chain with no filter at all instead of returning an empty map", () => {
    expect(() => filtersOf('.from("jobs").select("id")', WHAT)).toThrow(/unscoped/i);
  });

  it("refuses a column named by an expression, which it cannot pin", () => {
    expect(() => filtersOf(".eq(column, userId)", WHAT)).toThrow(/names its column with an expression/i);
  });

  it("refuses one column filtered twice against two different values", () => {
    expect(() => filtersOf('.eq("user_id", userId).eq("user_id", projectId)', WHAT)).toThrow(
      /filtered twice/i,
    );
  });
});

describe("singleRowTerminatorsOf tells maybeSingle from single, and both from neither", () => {
  it("lists what the chain actually ends with", () => {
    expect(singleRowTerminatorsOf(".limit(1).maybeSingle()")).toEqual(["maybeSingle"]);
    expect(singleRowTerminatorsOf(".limit(1).single()")).toEqual(["single"]);
    expect(singleRowTerminatorsOf(".limit(5)")).toEqual([]);
  });
});

describe("errorBranchOf hands back what a failed read actually does", () => {
  it("reads a braced branch", () => {
    expect(errorBranchOf("if (error) {\n  throw new Error(`x: ${error.message}`);\n}", WHAT)).toMatch(
      /throw new Error/,
    );
  });

  /** Brace-less is a formatting choice, not a defect: the pin must survive it. */
  it("reads a brace-less branch", () => {
    expect(errorBranchOf("if (error) throw new Error(`x`);\nreturn data;", WHAT)).toMatch(/throw/);
    expect(errorBranchOf("if (error) throw new Error(`x`);\nreturn data;", WHAT)).not.toMatch(
      /return/,
    );
  });

  it("refuses a read that never looks at its error", () => {
    expect(() => errorBranchOf("const { data } = await q;\nreturn data;", WHAT)).toThrow(
      /does not look at its own error/i,
    );
  });
});

describe("fanOutBindingsOf pairs each read with the binding it lands in", () => {
  const BODY =
    "const [crawl, pull] = await Promise.all([\n" +
    "  latestSucceeded(supabase, userId, id, \"crawl_site\"),\n" +
    "  latestPullSummary(supabase, userId, id),\n" +
    "]);";

  it("maps callee to binding, not binding to position", () => {
    const bindings = fanOutBindingsOf(BODY, WHAT);
    expect(bindings.get("latestSucceeded")).toBe("crawl");
    expect(bindings.get("latestPullSummary")).toBe("pull");
  });

  /** The swap this parser exists to catch: same names, wrong rows behind them. */
  it("follows the reads when two bindings are swapped", () => {
    const swapped = BODY.replace("[crawl, pull]", "[pull, crawl]");
    expect(fanOutBindingsOf(swapped, WHAT).get("latestSucceeded")).toBe("pull");
  });

  it("refuses a fan-out with fewer bindings than reads", () => {
    expect(() => fanOutBindingsOf(BODY.replace("[crawl, pull]", "[crawl]"), WHAT)).toThrow(
      /bindings for 2 reads/i,
    );
  });

  it("refuses a body that no longer gathers its reads here", () => {
    expect(() => fanOutBindingsOf("const crawl = await latestSucceeded();", WHAT)).toThrow(
      /Promise\.all/,
    );
  });
});

describe("returnPropsOf reads what the object literal actually carries", () => {
  it("treats shorthand as the binding itself", () => {
    const props = returnPropsOf("return {\n  crawl,\n  pull: pull,\n  lookupRuns: undefined,\n};", WHAT);
    expect(props.get("crawl")).toBe("crawl");
    expect(props.get("pull")).toBe("pull");
    expect(props.get("lookupRuns")).toBe("undefined");
  });

  /** A call-valued property carries a comma of its own; splitting on it would lose the property. */
  it("does not split inside a property's own call", () => {
    const props = returnPropsOf("return {\n  a: f(x, y),\n  b,\n};", WHAT);
    expect(props.get("a")).toBe("f(x, y)");
    expect(props.get("b")).toBe("b");
  });

  it("refuses a body with no returned object", () => {
    expect(() => returnPropsOf("return null;", WHAT)).toThrow(/no `return \{`/);
  });
});
