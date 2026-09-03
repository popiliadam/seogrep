import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import type { LoadProjectFn, ProjectRef } from "../tools/project-target.ts";
import type { RegisteredTool } from "../tools/registry.ts";
import { currentRecorder, resetRecorder } from "./ledger-recorder.ts";

/**
 * H-1 — WHICH PROJECT THE SPEND WAS FOR, pinned at the `charge:"handler"` call sites.
 *
 * The registry writes this column for every `charge:"surface"` tool generically
 * (`declaredProjectId(parsed.data)`, registry.ts) and cannot forget to. The `charge:"handler"`
 * family settles its OWN credits, so each of its call sites has to hand `withCredits` the project
 * itself — and measured 2026-09-03, not one of them did. Every ledger row those tools wrote read
 * `no project scope`, which is exactly what `list_credit_activity project_id=…` filters on and what
 * "Spent so far on X" adds up: the answer to "which of my sites did my credits go to?" was
 * structurally blank for the most expensive tools in the product.
 *
 * The claim is about ARGUMENTS, not rows: `reserve_credits(p_user_id, p_amount, p_tool, p_job_id,
 * p_project_id)` is the one write that opens a spend, and 0033's settlement RPCs read the scope
 * back OFF the reserve row — so pinning `p_project_id` on the reserve pins the scope of the whole
 * spend rather than a proxy for it. What the fake does and refuses to do: ledger-recorder.ts.
 *
 * BOTH DIRECTIONS ARE PINNED, and the second is not filler: undefined is a REAL answer here ("this
 * call had no project scope", credits/guard.ts), so a call naming a bare competitor domain must
 * still record null. A fix that attributed every call to some project would pass a one-sided spec
 * and invent a number somebody adds up.
 */

export const CTX: AuthContext = { userId: "user-under-test", keyId: "key-1" };
export const PROJECT_ID = "3f1d5b7a-9c2e-4a6b-8d10-2b4c6e8a0f12";
export const PROJECT: ProjectRef = { id: PROJECT_ID, domain: "example.com", archivedAt: null };

/** The bare-subject call names a domain that is nobody's project — the commonest paid call. */
export const BARE_TARGET = "competitor.com";

/**
 * A well-formed uuid the loader below does NOT own: another tenant's project, or none at all.
 * Production cannot tell those two apart and neither can this (project-target.ts).
 */
export const FOREIGN_PROJECT_ID = "0d9b7c31-5e42-4f18-9a63-8c05e21d7b4a";

/** Models the real loader: rows are keyed by (userId, projectId), so nobody sees another tenant's. */
export const loadProject: LoadProjectFn = async (userId, projectId) =>
  userId === CTX.userId && projectId === PROJECT_ID ? PROJECT : null;

/** Every tool below records its lookup; the write itself is another spec's subject. */
export const writeRun = async (): Promise<void> => {};

/**
 * One tool's two calls: the same lookup named by `project_id` and named without one. The inputs
 * carry nothing beyond what each schema requires, so a schema change surfaces as a red spec rather
 * than as a call that silently never reserved.
 */
export interface ProjectScopeCase {
  readonly tool: string;
  readonly make: () => RegisteredTool;
  readonly project: Record<string, unknown>;
  readonly bare: Record<string, unknown>;
}

/**
 * Run one tool and hand back the arguments of the reserve the guard opened.
 *
 * A vendor failure leaves `withCredits` no exit but a throw — that throw is WHAT MAKES IT RELEASE —
 * and `run` does not catch it (the registry's tools/call handler does, one level up). So a throw is
 * swallowed here rather than allowed to fail the spec: what is under test is the reserve the guard
 * assembled, which exists either way.
 */
export async function reserveFor(
  make: () => RegisteredTool,
  input: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  resetRecorder();
  try {
    await make().run(CTX, input);
  } catch {
    // deliberate — see above.
  }
  return currentRecorder().reserve()?.args;
}

export function describeProjectScope(cases: readonly ProjectScopeCase[]): void {
  describe.each(cases)("$tool records which project its spend was for (H-1)", (scope) => {
    it("reserves against the project the call named", async () => {
      const args = await reserveFor(scope.make, scope.project);
      expect(args?.p_tool).toBe(scope.tool);
      expect(args?.p_project_id).toBe(PROJECT_ID);
    });

    it("records no project scope when the call named no project", async () => {
      const args = await reserveFor(scope.make, scope.bare);
      expect(args?.p_tool).toBe(scope.tool);
      expect(args?.p_project_id).toBeNull();
    });

    /**
     * THE SOURCE, not just the value. The two assertions above are equally happy with
     * `projectId: input.project_id` — the caller's RAW, unchecked string — which would write
     * another tenant's project id onto this tenant's ledger row and turn `list_credit_activity
     * project_id=…` into an existence oracle for project ids that are not theirs.
     *
     * What separates the two is WHERE the id comes from: the ownership-gated resolver runs BEFORE
     * the reserve, so a project the caller does not own is refused for free and there is no reserve
     * at all. Undefined here is therefore the whole claim — it says the gate ran first, which no
     * assertion about a recorded id can say (signed lesson 12: a spec that would pass on the wrong
     * mechanism is not measuring the mechanism).
     */
    it("opens NO reserve at all for a project id that is not the caller's", async () => {
      const args = await reserveFor(scope.make, {
        ...scope.project,
        project_id: FOREIGN_PROJECT_ID,
      });
      expect(args).toBeUndefined();
    });
  });
}
