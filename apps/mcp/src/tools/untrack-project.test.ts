import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import { projectNotFoundMessage, type ProjectRef } from "./project-target.ts";
import { makeUntrackProjectTool } from "./untrack-project.ts";

/**
 * Fast-lane (DB-less) proofs for untrack_project. Both ports are injected, so this file touches
 * no database and no network (NEVER #5).
 *
 * WHAT THIS FILE MEASURES, and what it leaves to the DB lane. Here the subject is the DECISION:
 * which of the three answers the tool gives, and whether it calls the archive WRITE at all —
 * measured by the strongest available statement, "the write port was never called". What the
 * write actually does to real rows (archived_at stamped, `gsc_connections` untouched, zero
 * ledger rows) and whether its `.eq("user_id", …)` filter really binds are claims about
 * Postgres, so they live in untrack-project.db.test.ts against real rows.
 *
 * FIXTURE RULE (the trap this branch has hit twice). No fixture value contains "archiv" or any
 * other substring of a sentence the tool prints, so no assertion can pass because a fixture name
 * leaked into a message. The domains are ordinary public `.com` names for the same reason
 * Task 6 substituted one: a reserved TLD would be refused upstream and turn a negative
 * assertion into a tautology.
 */

const OWNER = "user-untrack";
const CTX: AuthContext = { userId: OWNER, keyId: "key-untrack" };

const ACTIVE: ProjectRef = {
  id: "5f6a7b8c-9d0e-4f10-8a2b-3c4d5e6f7a8b",
  domain: "harborlane.com",
  archivedAt: null,
};
const ALREADY_PUT_AWAY: ProjectRef = {
  id: "6a7b8c9d-0e1f-4021-9b3c-4d5e6f7a8b9c",
  domain: "quillmarsh.com",
  archivedAt: "2026-08-13T00:00:00Z",
};
/** An id that resolves for nobody in this world — the unknown-id / other-tenant probe. */
const FOREIGN_ID = "7b8c9d0e-1f20-4132-8c4d-5e6f7a8b9c0d";

interface World {
  /** The projects the CALLER owns. A project absent here reads exactly as a missing one. */
  readonly own?: readonly ProjectRef[];
  /** Make the archive write report that it matched NO row (the PostgREST zero-row case). */
  readonly writeMatchesNothing?: boolean;
}

/** What the tool did to the one write port, per run. */
interface Recorder {
  readonly archived: { userId: string; projectId: string }[];
}

function toolFor(world: World, recorder: Recorder) {
  return makeUntrackProjectTool({
    // The fake MODELS the real loader's tenant filter (signed lesson 12): a project belonging
    // to anybody else reads as null here, exactly as selectOwnById's .eq("user_id", …) makes it.
    loadProject: (userId, projectId) =>
      Promise.resolve(
        userId === OWNER
          ? ((world.own ?? []).find((project) => project.id === projectId) ?? null)
          : null,
      ),
    archiveProject: (userId, projectId) => {
      recorder.archived.push({ userId, projectId });
      return Promise.resolve(world.writeMatchesNothing !== true);
    },
  });
}

interface Run {
  readonly text: string;
  readonly isError: boolean;
  readonly recorder: Recorder;
}

async function callTool(
  input: Record<string, unknown>,
  world: World = {},
  asUser = OWNER,
): Promise<Run> {
  const recorder: Recorder = { archived: [] };
  const result = await toolFor(world, recorder).run({ ...CTX, userId: asUser }, input);
  return {
    text: result.content.map((part) => part.text).join("\n"),
    isError: result.isError === true,
    recorder,
  };
}

describe("untrack_project", () => {
  it("archives the project and says the history and the Search Console link are kept", async () => {
    const run = await callTool({ project_id: ACTIVE.id }, { own: [ACTIVE] });

    expect(run.isError).toBe(false);
    expect(run.text).toContain(ACTIVE.domain);
    expect(run.text).toContain(ACTIVE.id);
    // The way back is named — an archive nobody can undo is a delete with better manners.
    expect(run.text).toMatch(/track_gsc_property/);
    // The write ran, for THIS tenant and THIS project.
    expect(run.recorder.archived).toEqual([{ userId: OWNER, projectId: ACTIVE.id }]);
  });

  it("is IDEMPOTENT: an already-archived project answers with success, not an error", async () => {
    const run = await callTool({ project_id: ALREADY_PUT_AWAY.id }, { own: [ALREADY_PUT_AWAY] });

    expect(run.isError).toBe(false);
    expect(run.text).not.toMatch(/error|failed/i);
    expect(run.text).toContain(ALREADY_PUT_AWAY.domain);
    // …and it writes NOTHING, so the date the tenant actually put it away is not overwritten.
    expect(run.recorder.archived).toEqual([]);
  });

  it("answers another tenant's project exactly like an id that exists for nobody", async () => {
    // No existence oracle (the get_job_status pattern): the two answers are compared
    // byte-for-byte rather than by a shared /not found/ pattern, which two DIFFERENT
    // sentences could both satisfy.
    const intruder = await callTool({ project_id: ACTIVE.id }, { own: [ACTIVE] }, "user-intruder");
    const unknown = await callTool({ project_id: FOREIGN_ID }, { own: [ACTIVE] });

    expect(intruder.isError).toBe(true);
    expect(intruder.text).toBe(projectNotFoundMessage(ACTIVE.id));
    expect(unknown.text).toBe(projectNotFoundMessage(FOREIGN_ID));
    // Nothing is written on either path — the ownership gate refuses BEFORE the write.
    expect(intruder.recorder.archived).toEqual([]);
    expect(unknown.recorder.archived).toEqual([]);
  });

  it("reports an UPDATE that matched NO row as a failure, never as a silent success", async () => {
    // The defect Task 4's referee found in setup-project's twin write: PostgREST returns no
    // error when an UPDATE matches zero rows, so `error === null` proves nothing was WRONG,
    // not that anything was WRITTEN. This tool must not answer "stopped tracking" for a write
    // that changed nothing.
    const run = await callTool({ project_id: ACTIVE.id }, { own: [ACTIVE], writeMatchesNothing: true });

    expect(run.isError).toBe(true);
    expect(run.text).toMatch(/nothing was changed/i);
    expect(run.text).not.toMatch(/stopped tracking/i);
    expect(run.recorder.archived).toEqual([{ userId: OWNER, projectId: ACTIVE.id }]);
  });

  it("is a 0-credit tool that takes exactly one required project_id", () => {
    const tool = toolFor({}, { archived: [] });
    expect(tool.name).toBe("untrack_project");
    expect(tool.description).toMatch(/0 credits/i);
    const schema = tool.inputJsonSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties ?? {})).toEqual(["project_id"]);
    expect(schema.required).toEqual(["project_id"]);
  });
});
