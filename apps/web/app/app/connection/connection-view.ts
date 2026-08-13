import { canQuerySearchAnalytics } from "../../../lib/gsc/oauth";

/** One property on one connected Google account, with what currently reads it. */
export interface InventoryRow {
  readonly siteUrl: string;
  readonly permissionLevel: string;
  /** Whether Google will answer `searchAnalytics.query` at this permission level. */
  readonly queryable: boolean;
  /** Domains of the projects reading it THROUGH THIS ACCOUNT, in project order. */
  readonly usedBy: readonly string[];
}

/**
 * What one account can read, and what we do with it.
 *
 * `usedBy` is filtered by `accountId` on purpose. The same property string can appear on two
 * different Google accounts, and a project reads it through exactly one of them — listing a
 * project under the wrong account would tell the user their data comes from somewhere it
 * does not.
 *
 * Pure: no React, no I/O, no directive. It is imported by a Server Component, so it must not
 * live in a `"use client"` module — see ./choice for the outage that rule came from.
 */
export function inventoryRows(
  sites: readonly { siteUrl: string; permissionLevel: string }[],
  projects: readonly { domain: string; accountId: string | null; property: string | null }[],
  accountId: string,
): InventoryRow[] {
  return sites.map((site) => ({
    siteUrl: site.siteUrl,
    permissionLevel: site.permissionLevel,
    queryable: canQuerySearchAnalytics(site.permissionLevel),
    usedBy: projects
      .filter((project) => project.accountId === accountId && project.property === site.siteUrl)
      .map((project) => project.domain),
  }));
}

/** One project as the connection page reads it out of the database. */
export interface ProjectRow {
  readonly id: string;
  readonly domain: string;
  /** The Google account it reads THROUGH, or null when nothing is mapped. */
  readonly accountId: string | null;
  /** The property stored for it — survives an account disconnect (migration 0021). */
  readonly property: string | null;
  /** When it was put away, or null while it is tracked (migration 0022). */
  readonly archivedAt: string | null;
}

/** One tracked project: the page's spine, whether or not it has a property. */
export interface TrackedRow {
  readonly projectId: string;
  readonly domain: string;
  /** What it reads RIGHT NOW — null unless the mapping is live (account AND property). */
  readonly property: string | null;
  /** A property it still HOLDS while nothing reads it: mapped account gone, property kept. */
  readonly retained: string | null;
}

/** One archived project, and the mapping archiving deliberately left intact. */
export interface ArchivedRow {
  readonly projectId: string;
  readonly domain: string;
  readonly property: string | null;
}

/** One property on THIS account that nothing reads yet. */
export interface LibraryRow {
  readonly siteUrl: string;
  readonly permissionLevel: string;
  /** Whether Google will answer `searchAnalytics.query` at this permission level. */
  readonly queryable: boolean;
}

/** The three groups /app/connection is built from. */
export interface ConnectionGroups {
  readonly tracked: readonly TrackedRow[];
  readonly library: readonly LibraryRow[];
  readonly archived: readonly ArchivedRow[];
}

/**
 * Split what the page knows into the three groups it renders.
 *
 * THE SPINE IS THE PROJECT, NOT THE PROPERTY, and that was measured rather than assumed. On the
 * operator's live data (2026-08-13) a property-keyed list fails three ways at once: `example.net`
 * has no property and no suggestion and would simply vanish from the page though crawl and audit
 * run for it; `adstark.com.tr` reads `https://rkturizm.com/`, so deriving the project from the
 * property is already wrong today; and `rkturizm.com` is both a project AND the property another
 * project reads. So every project gets a row — `tracked` is never filtered by whether a property
 * exists — and the properties are what get filtered.
 *
 * SCOPED TO ONE ACCOUNT, exactly as {@link inventoryRows} is and for the same reason: the same
 * property string can appear on two Google accounts, and a project reads it through exactly one.
 * `library` therefore describes THIS account. `tracked` and `archived` do not depend on the
 * account at all, so a page with several accounts renders ONE tracked group and ONE archive and
 * a library per account — which is also how the design groups property rows, under an account
 * heading.
 *
 * A property is left OUT of the library when any project reads it through this account,
 * including an ARCHIVED one: archiving keeps `gsc_connections` intact, so the archive row
 * already offers exactly one way back. Listing it here too would put the same restore behind two
 * differently named controls, which is the duplicated surface this page redesign exists to remove.
 *
 * Pure: no React, no I/O, no directive. It is called while a Server Component renders, so it must
 * not live in a `"use client"` module — see ./choice for the outage that rule came from.
 */
export function groupConnectionRows(input: {
  readonly projects: readonly ProjectRow[];
  readonly sites: readonly { siteUrl: string; permissionLevel: string }[];
  readonly accountId: string;
}): ConnectionGroups {
  const { projects, sites, accountId } = input;
  // A live mapping needs BOTH halves. `account_id IS NULL` with `gsc_property` set is the state
  // migration 0021 left every row in, and the state an account disconnect produces: the property
  // is stored and nothing reads it. Reporting it as what the project READS would be an
  // invention; dropping it would lose the user's own earlier choice. So it is carried separately.
  const isLive = (project: ProjectRow) => project.accountId !== null && project.property !== null;

  return {
    tracked: projects
      .filter((project) => project.archivedAt === null)
      .map((project) => ({
        projectId: project.id,
        domain: project.domain,
        property: isLive(project) ? project.property : null,
        retained: project.accountId === null ? project.property : null,
      })),
    library: inventoryRows(sites, projects, accountId)
      .filter((row) => row.usedBy.length === 0)
      .map((row) => ({
        siteUrl: row.siteUrl,
        permissionLevel: row.permissionLevel,
        queryable: row.queryable,
      })),
    archived: projects
      .filter((project) => project.archivedAt !== null)
      .map((project) => ({
        projectId: project.id,
        domain: project.domain,
        property: project.property,
      })),
  };
}
