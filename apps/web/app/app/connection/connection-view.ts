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
