import { describe, expect, it } from "vitest";
import { connectGscTool, renderAlreadyConnected } from "./connect-gsc.ts";
import type { AuthContext } from "../auth.ts";

/**
 * Fast-lane specs for the connect_gsc SURFACE: schema validation happens before any DB
 * read or env access (defineTool validates first), so these cases touch no stack. The
 * happy path (real project -> link-out) and the cross-tenant guard live in the db-test.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

describe("connect_gsc input schema", () => {
  it("requires a uuid project_id", () => {
    const schema = connectGscTool.inputJsonSchema as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties)).toEqual(["project_id"]);
    expect(schema.required).toEqual(["project_id"]);
  });

  it("rejects a non-uuid project_id before any DB/env access", async () => {
    const result = await connectGscTool.run(CTX, { project_id: "not-a-uuid" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input/i);
  });

  it("rejects a missing project_id", async () => {
    const result = await connectGscTool.run(CTX, {});
    expect(result.isError).toBe(true);
  });
});

const CONNECT_URL = "https://app.example.test/api/gsc/connect?project_id=p-1";

describe("connect_gsc already-connected copy", () => {
  it("names the matched property and points at pull_gsc_data", () => {
    const text = renderAlreadyConnected({
      domain: "adstark.com.tr",
      property: "https://adstark.com.tr/",
      connectUrl: CONNECT_URL,
    });
    expect(text).toMatch(/already connected/i);
    expect(text).toContain("https://adstark.com.tr/");
    expect(text).toMatch(/pull_gsc_data/);
    expect(text).toContain(CONNECT_URL);
  });

  /**
   * Live 2026-08-09, www.noraninsaat.com: the unmatched property was interpolated raw and
   * the user read "property null" — a JS value rendered as a status. The honest answer has
   * to say the connection stands, that NO property matched, which domain we looked for, and
   * what to do about it.
   */
  it("never prints the word null when no property matched", () => {
    const text = renderAlreadyConnected({
      domain: "www.noraninsaat.com",
      property: null,
      connectUrl: CONNECT_URL,
    });
    expect(text).not.toContain("null");
    expect(text).not.toMatch(/undefined/);
  });

  it("tells the truth about an unmatched property: connected, no property, what to do", () => {
    const text = renderAlreadyConnected({
      domain: "www.noraninsaat.com",
      property: null,
      connectUrl: CONNECT_URL,
    });
    expect(text).toContain("www.noraninsaat.com"); // WHICH domain we looked for
    expect(text).toMatch(/no.*matched|matched it/i);
    expect(text).toMatch(/verify a property/i);
    expect(text).toContain(CONNECT_URL);
    // It must NOT claim the data path works — that was the whole failure.
    expect(text).not.toMatch(/already connected .* — property/);
  });
});
