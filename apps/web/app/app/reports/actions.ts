"use server";

import { revalidatePath } from "next/cache";
import { revokeReportLink } from "../../../lib/reports";
import { createClient } from "../../../lib/supabase/server";

/**
 * Server actions for /app/reports. Same posture as /app/connection: the user is re-derived from
 * the validated session (getUser) — NEVER from a client-supplied value — and the mutation touches
 * only that user's rows.
 */

const REPORTS_PATH = "/app/reports";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated");
  }
  return user.id;
}

/**
 * Revoke one report's public link (L-13): its `public_slug` is nulled, so the /r/<slug> URL the
 * user handed out stops resolving and 404s from the next request onward.
 *
 * REVOKE ONLY. The report row, its title and its rendered html all stay — this action deletes
 * NOTHING, and no caller may present it as deletion. Whoever already opened the page keeps
 * whatever their browser cached; revoking ends future access, it cannot un-share what was read.
 *
 * Ownership: the report is addressed by (session user, report id) and BOTH filters ride on the
 * UPDATE itself (NEVER #4) — which is the whole guard here, since revokeReportLink runs the
 * service-role client and `rolbypassrls` means RLS never sees the statement. A malformed id,
 * an unknown one, and another user's report are all reported with the SAME opaque message, so
 * nothing about other users' reports leaks.
 *
 * Idempotent: re-revoking an already-revoked report succeeds and changes nothing.
 */
export async function revokeReportLinkAction(reportId: string): Promise<void> {
  const userId = await requireUserId();
  if (!UUID_RE.test(reportId)) {
    throw new Error("Report not found");
  }
  if (!(await revokeReportLink({ userId, reportId }))) {
    throw new Error("Report not found");
  }
  revalidatePath(REPORTS_PATH);
}
