import { describe, expect, it, vi } from "vitest";

/**
 * `../db.ts` is replaced so the NOT-FOUND branch can be driven without a database. connect_gsc
 * is the one tool in this family with no injectable ports (its readers are called directly), so
 * this is the only way its wording is reachable from the fast lane; the branch returns before
 * `gsc_connections` is ever read, so a project reader that answers null is the whole fixture.
 */
let projectRow: { id: string; domain: string; archived_at: string | null } | null = null;

vi.mock("../db.ts", () => ({
  getServiceClient: () => ({}),
  markGscAccountTokenInvalid: vi.fn(),
  forUser: () => ({
    selectOwnById: () => Promise.resolve(projectRow),
  }),
}));

import {
  connectGscTool,
  makeConnectGscTool,
  renderAlreadyConnected,
  type GscMappingRow,
} from "./connect-gsc.ts";
import { ARCHIVED_PROJECT_MESSAGE, projectNotFoundMessage } from "./project-target.ts";
import { makeUntrackProjectTool } from "./untrack-project.ts";
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

/**
 * CG-2 / UP-2 — ONE state, TWO sentences, measured live side by side on 2026-09-02. For a
 * project id that does not resolve, `connect_gsc` wrote its own wording while `untrack_project`
 * printed the shared `projectNotFoundMessage` that thirteen tools print. Two answers to one
 * question is how a user learns that the same refusal means different things.
 *
 * The strongest form of the claim is the one asserted here: the two tools' answers are compared
 * to EACH OTHER, not each to a copy of the string — a spec that pinned a literal would go green
 * again the moment one of the two drifted (signed lesson 11).
 */
describe("an unresolvable project id gets the family's ONE sentence", () => {
  const UNKNOWN = "11111111-1111-4111-8111-111111111111";

  it("answers with the shared projectNotFoundMessage", async () => {
    projectRow = null;
    const result = await connectGscTool.run(CTX, { project_id: UNKNOWN });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(projectNotFoundMessage(UNKNOWN));
  });

  it("says exactly what untrack_project says for the same state", async () => {
    projectRow = null;
    const untrack = makeUntrackProjectTool({ loadProject: () => Promise.resolve(null) });

    const connect = await connectGscTool.run(CTX, { project_id: UNKNOWN });
    const untracked = await untrack.run(CTX, { project_id: UNKNOWN });

    expect(connect.content[0]?.text).toBe(untracked.content[0]?.text);
  });
});

const CONNECT_URL = "https://app.example.test/api/gsc/connect?project_id=p-1";
const PICKER_URL = "https://app.example.test/app/connection";

describe("connect_gsc already-connected copy", () => {
  it("names the matched property and points at pull_gsc_data", () => {
    const text = renderAlreadyConnected({
      domain: "adstark.com.tr",
      property: "https://adstark.com.tr/",
      connectUrl: CONNECT_URL,
      pickerUrl: PICKER_URL,
    });
    expect(text).toMatch(/already connected/i);
    expect(text).toContain("https://adstark.com.tr/");
    expect(text).toMatch(/pull_gsc_data/);
    expect(text).toContain(CONNECT_URL);
  });

  /**
   * RE-AIMED from "If you need to connect a DIFFERENT property … re-approve here". Migration
   * 0021 moved the property choice out of the OAuth callback and onto /app/connection — the
   * callback stores a Google ACCOUNT and writes no connection row — so that sentence sent the
   * user through a Google round trip that CANNOT change which property a project reads. The
   * assertion that survives is "a property change has somewhere to happen"; where it happens
   * changed, so the link did.
   */
  it("sends a PROPERTY change to the picker, and says approving again will not do it", () => {
    const text = renderAlreadyConnected({
      domain: "adstark.com.tr",
      property: "https://adstark.com.tr/",
      connectUrl: CONNECT_URL,
      pickerUrl: PICKER_URL,
    });
    expect(text).toContain(PICKER_URL);
    expect(text).toMatch(/different property/i);
    expect(text).toMatch(/does not change which property/i);
    // The connect link survives for the one job it still has: a withdrawn grant.
    expect(text).toMatch(/revoked on google's side/i);
  });

  /**
   * The unmatched branch carried the same stale instruction ("once the property is verified,
   * re-approve access here"). Verifying a property in Search Console does not make the OAuth
   * callback pick it any more; a human picks it on the Connection page.
   */
  it("sends an unmatched property to the picker once it is verified", () => {
    const text = renderAlreadyConnected({
      domain: "www.noraninsaat.com",
      property: null,
      connectUrl: CONNECT_URL,
      pickerUrl: PICKER_URL,
    });
    expect(text).toMatch(/once the property is verified/i);
    expect(text).toContain(PICKER_URL);
    expect(text).toContain(CONNECT_URL); // still offered, for an account that lost access
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
      pickerUrl: PICKER_URL,
    });
    expect(text).not.toContain("null");
    expect(text).not.toMatch(/undefined/);
  });

  it("tells the truth about an unmatched property: connected, no property, what to do", () => {
    const text = renderAlreadyConnected({
      domain: "www.noraninsaat.com",
      property: null,
      connectUrl: CONNECT_URL,
      pickerUrl: PICKER_URL,
    });
    expect(text).toContain("www.noraninsaat.com"); // WHICH domain we looked for
    expect(text).toMatch(/no.*matched|matched it/i);
    expect(text).toMatch(/verify a property/i);
    expect(text).toContain(CONNECT_URL);
    // It must NOT claim the data path works — that was the whole failure.
    expect(text).not.toMatch(/already connected .* — property/);
  });
});

/**
 * CG-1 — the handler's own branches, which had no fast-lane gate at all until the ports landed.
 *
 * Measured 2026-09-02, both against the WHOLE fast lane (143 files / 3680 tests) and both green:
 *   · disabling the archive refusal, so an archived project is handed a connect link;
 *   · `if (mapping && mapping.account_id !== null)` → `if (mapping)`, which is defect #52 back
 *     byte for byte — a mapping row with no credential behind it reported as "already connected
 *     — property https://…", the exact sentence measured live on 2026-08-27.
 *
 * Neither is exotic: each is one clause, and each was pinned only by `connect-gsc.db.test.ts`,
 * in a lane `make verify` does not run. The db lane keeps those specs — it proves the branches
 * against real rows; this proves the DECISIONS without Docker.
 */
describe("connect_gsc decides on the credential, and refuses the archive (CG-1)", () => {
  const PROJECT = "6d7e8f90-1a2b-4c3d-8e4f-506172839405";
  const DOMAIN = "credential-under-test.example";
  const PROPERTY = "https://credential-under-test.example/";
  const BASE_URL = "https://base-url-under-test.example";

  function toolFor(
    project: { id: string; domain: string; archivedAt: string | null } | null,
    mapping: GscMappingRow | null,
  ) {
    return makeConnectGscTool({
      loadProject: () => Promise.resolve(project),
      loadConnection: () => Promise.resolve(mapping),
    });
  }

  const tracked = { id: PROJECT, domain: DOMAIN, archivedAt: null };

  async function answer(
    project: { id: string; domain: string; archivedAt: string | null } | null,
    mapping: GscMappingRow | null,
  ): Promise<{ isError: boolean; text: string }> {
    const previous = process.env.WEB_BASE_URL;
    process.env.WEB_BASE_URL = BASE_URL;
    try {
      const result = await toolFor(project, mapping).run(CTX, { project_id: PROJECT });
      return { isError: result.isError === true, text: result.content[0]?.text ?? "" };
    } finally {
      if (previous === undefined) delete process.env.WEB_BASE_URL;
      else process.env.WEB_BASE_URL = previous;
    }
  }

  it("refuses an ARCHIVED project and hands out no link", async () => {
    const { isError, text } = await answer(
      { ...tracked, archivedAt: "2026-08-01T00:00:00.000Z" },
      { account_id: "acct-1", gsc_property: PROPERTY },
    );
    expect(isError).toBe(true);
    expect(text).toBe(ARCHIVED_PROJECT_MESSAGE);
    // The whole point of the refusal: no OAuth link leaves the building for an untracked project.
    expect(text).not.toContain(BASE_URL);
  });

  it("a mapping whose account_id is NULL is NOT connected (defect #52)", async () => {
    const { isError, text } = await answer(tracked, { account_id: null, gsc_property: PROPERTY });
    expect(isError).toBe(false);
    // It offers the connect link…
    expect(text).toContain(`${BASE_URL}/api/gsc/connect?project_id=${PROJECT}`);
    // …and does NOT claim the data path works. This is the sentence the defect produced.
    expect(text).not.toMatch(/already connected/i);
  });

  it("a mapping WITH an account_id is connected, and names the property", async () => {
    const { isError, text } = await answer(tracked, {
      account_id: "acct-1",
      gsc_property: PROPERTY,
    });
    expect(isError).toBe(false);
    expect(text).toMatch(/already connected/i);
    expect(text).toContain(PROPERTY);
  });

  it("no mapping row at all is not connected either", async () => {
    const { text } = await answer(tracked, null);
    expect(text).not.toMatch(/already connected/i);
  });

  it("an unresolvable project_id gets the shared not-found sentence, before any mapping read", async () => {
    const { isError, text } = await answer(null, { account_id: "acct-1", gsc_property: PROPERTY });
    expect(isError).toBe(true);
    expect(text).toBe(projectNotFoundMessage(PROJECT));
  });
});
