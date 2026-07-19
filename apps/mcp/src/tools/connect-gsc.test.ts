import { describe, expect, it } from "vitest";
import { connectGscTool } from "./connect-gsc.ts";
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
