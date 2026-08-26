import { forUser, getServiceClient } from "../db.ts";

/**
 * The tenant's projects as id -> domain — the map every surface that prints a stored `project_id`
 * needs to turn it into something a person can read.
 *
 * IT LIVES ON ITS OWN because two tools want it (`list_credit_activity` and `list_jobs`) and a
 * third surface, the panel, keeps its own copy against a different client. Importing one tool's
 * helper from another would make the dependency between them look like a relationship they do not
 * have; a module whose whole subject is "id -> domain for this tenant" says what it is.
 *
 * ARCHIVED PROJECTS ARE INCLUDED, deliberately: the job ran, and the credits were spent, while the
 * project was tracked. Untracking it later must not turn readable history into a uuid.
 */
export type ListProjectDomainsFn = (userId: string) => Promise<ReadonlyMap<string, string>>;

/**
 * The production read. Tenant-scoped through `forUser` (constitution NEVER #4).
 *
 * A failure THROWS rather than degrading to an empty map: an empty map is indistinguishable from
 * "this tenant has no projects", and the whole answer would quietly fall back to printing uuids —
 * the exact defect this read exists to remove, reintroduced as a silent one.
 */
export async function listOwnProjectDomains(userId: string): Promise<ReadonlyMap<string, string>> {
  const { data, error } = await forUser(getServiceClient(), userId).selectOwn(
    "projects",
    "id, domain",
  );
  if (error) {
    throw new Error(`project domain lookup failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as { id: string; domain: string }[];
  return new Map(rows.map((row) => [row.id, row.domain]));
}

/**
 * What a surface prints for one stored `project_id`. THREE answers, and the middle one is why this
 * is a function rather than a `?? id`:
 *   • a known project  -> its domain
 *   • no project at all -> "no project scope", in words. A dropped clause reads as "the tool
 *     forgot" rather than as "there was no site", and it is the answer for that row.
 *   • an id the tenant no longer has -> the id itself, which is TRUE where a shrug is not.
 */
export function projectLabel(
  projectId: string | null,
  domains: ReadonlyMap<string, string>,
): string {
  if (projectId === null) return "no project scope";
  return domains.get(projectId) ?? projectId;
}
