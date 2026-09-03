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
  });
}
