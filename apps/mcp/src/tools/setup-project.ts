import { z } from "zod";
import { getServiceClient } from "../db.ts";
import { defineTool, errorResult, textResult } from "./registry.ts";

/**
 * setup_project — register (or return) a tracked domain for the tenant. 0 credits.
 * Idempotent by (user_id, domain): a second call for the same site returns the
 * existing project rather than creating a duplicate (migration 0001 has no unique
 * on (user_id, domain) yet, so idempotency is enforced by a tenant-scoped read
 * first; the residual race of two truly-simultaneous first calls is an accepted v0
 * limitation for personal-key usage).
 */

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type NormalizedDomain = { readonly ok: true; readonly domain: string } | {
  readonly ok: false;
  readonly error: string;
};

/**
 * Canonicalize a domain input. Accepts a bare host or a full URL; extracts the host,
 * lowercases it, drops any trailing dot (FQDN) — the scheme/path/port/query fall away
 * with the URL parse. Returns a descriptive English error for anything that is not a
 * valid public domain (no host, single label, illegal characters).
 */
export function normalizeDomain(raw: string): NormalizedDomain {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, error: "Domain is required (received an empty value)." };
  }
  let host: string;
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
    host = new URL(hasScheme ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return { ok: false, error: `"${raw}" is not a valid domain or URL.` };
  }
  const domain = host.toLowerCase().replace(/\.+$/, "");
  if (!DOMAIN_RE.test(domain)) {
    return {
      ok: false,
      error: `"${raw}" is not a valid domain — expected a host like "example.com".`,
    };
  }
  return { ok: true, domain };
}

export const setupProjectTool = defineTool({
  name: "setup_project",
  description:
    "Register a website domain to track. Accepts a domain or URL; returns the project id. " +
    "Idempotent — calling it again for the same domain returns the existing project.",
  inputSchema: z.object({
    domain: z
      .string()
      .min(1)
      .describe("The website to track, e.g. \"example.com\" or \"https://example.com\"."),
  }),
  handler: async (ctx, { domain }) => {
    const normalized = normalizeDomain(domain);
    if (!normalized.ok) {
      return errorResult(normalized.error);
    }
    const client = getServiceClient();

    const existing = await client
      .from("projects")
      .select("id")
      .eq("user_id", ctx.userId)
      .eq("domain", normalized.domain)
      .maybeSingle();
    if (existing.error) {
      throw new Error(`projects lookup failed: ${existing.error.message}`);
    }
    if (existing.data) {
      return textResult(
        `Project already exists for "${normalized.domain}" (project_id: ${existing.data.id}, created: false).`,
      );
    }

    const inserted = await client
      .from("projects")
      .insert({ user_id: ctx.userId, domain: normalized.domain })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      throw new Error(`projects insert failed: ${inserted.error?.message ?? "no row returned"}`);
    }
    return textResult(
      `Created project for "${normalized.domain}" (project_id: ${inserted.data.id}, created: true).`,
    );
  },
});
