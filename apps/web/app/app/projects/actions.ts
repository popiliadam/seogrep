"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { normalizeDomain } from "@pseo/core";
import { createServiceClient } from "@pseo/db/server";
import { openTrackedProject, type ProjectResolution } from "@pseo/db/projects";
import { requireUserId } from "../connection/action-support";
import { addedUrl, errorUrl, PROJECTS_PATH } from "./add-domain-contract";

/**
 * ADD DOMAIN — the panel's half of `setup_project`.
 *
 * IT OPENS NO PROJECT OF ITS OWN. Every row it creates, finds or brings back is created, found
 * or brought back by `openTrackedProject` (@pseo/db/projects), which is the same function
 * `setup_project` and `track_gsc_property` call. That is the whole design: the route carries the
 * `normalizeDomain` gate INSIDE it, so a second insert written here would open projects for
 * hosts the MCP tools refuse (`foo.internal`, `x.local`) — the exact disagreement that was
 * measured on this codebase once already, when /app/connection had its own insert.
 * `core-identity.test.ts` next door proves the call rather than the agreement.
 *
 * Session first, explicit user_id after (constitution NEVER #4): the client is service-role and
 * bypasses RLS, so the id derived from the validated session — never from the form — is the
 * tenant boundary. Nothing here touches `credit_ledger`: adding a domain is free (NEVER #2).
 *
 * POST-redirect-GET. The action answers with a redirect carrying a status code, so a refresh
 * re-runs nothing, and the page needs no client JavaScript at all: a native <form> and a server
 * action, which is why this works with scripting off.
 */
export async function addDomain(formData: FormData): Promise<void> {
  const raw = formData.get("domain");
  const userId = await requireUserId();
  const service = createServiceClient();

  let resolved: ProjectResolution;
  try {
    resolved = await openTrackedProject(service, userId, typeof raw === "string" ? raw : "");
  } catch (error) {
    // The route throws only when a statement itself failed. The user gets one sentence and a
    // retry; the detail goes to the server log, never into the URL.
    console.error("addDomain: openTrackedProject failed:", error);
    redirect(errorUrl("failed"));
  }

  if (!resolved.ok) {
    // WHICH refusal it was. The route has ALREADY decided whether the domain may be tracked —
    // this call decides nothing and gates nothing, it only picks between two sentences for a
    // refusal that has happened. (The route's two refusals are the host gate and an archived
    // row whose un-archiving matched no row; only the first is about the domain itself.)
    redirect(errorUrl(normalizeDomain(typeof raw === "string" ? raw : "").ok
      ? "not_restored"
      : "invalid_domain"));
  }

  revalidatePath(PROJECTS_PATH);
  // `redirect` throws by design (Next's NEXT_REDIRECT), so it is deliberately NOT inside the
  // try above — a catch would swallow the navigation and leave the user on a POST that did
  // nothing visible.
  redirect(addedUrl(resolved.project.outcome, resolved.project.domain));
}
