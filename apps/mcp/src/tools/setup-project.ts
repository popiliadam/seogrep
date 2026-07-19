import { z } from "zod";
import { getServiceClient } from "../db.ts";
import { defineTool, errorResult, textResult } from "./registry.ts";

/**
 * setup_project — register (or return) a tracked domain for the tenant. 0 credits.
 * Idempotent by (user_id, domain): a second call for the same site returns the existing
 * project rather than creating a duplicate. A tenant-scoped read-first serves the common
 * repeat call, and the residual race of two truly-simultaneous first calls is closed at the
 * DB level — the (user_id, domain) unique constraint (migration 0010) plus an ON CONFLICT
 * DO NOTHING upsert: the loser's insert is a no-op and it reads back the winner's row, so two
 * concurrent first calls still produce ONE row with consistent created: true/false flags.
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

    const existing = await readProject(client, ctx.userId, normalized.domain);
    if (existing) {
      return alreadyExists(normalized.domain, existing);
    }

    // Race-safe insert: ON CONFLICT (user_id, domain) DO NOTHING (ignoreDuplicates). A row is
    // returned ONLY when THIS call inserted it (created: true); an empty result means a
    // concurrent first call won the row between our read and this write, so we read it back
    // and report created: false — one row, consistent flags, no unique-violation surfaced.
    const upserted = await client
      .from("projects")
      .upsert({ user_id: ctx.userId, domain: normalized.domain }, {
        onConflict: "user_id,domain",
        ignoreDuplicates: true,
      })
      .select("id");
    if (upserted.error) {
      throw new Error(`projects upsert failed: ${upserted.error.message}`);
    }
    const insertedId = upserted.data?.[0]?.id;
    if (insertedId) {
      return textResult(
        `Created project for "${normalized.domain}" (project_id: ${insertedId}, created: true).`,
      );
    }

    const winner = await readProject(client, ctx.userId, normalized.domain);
    if (!winner) {
      throw new Error("projects upsert reported a conflict but no existing row was found");
    }
    return alreadyExists(normalized.domain, winner);
  },
});

/** Tenant-scoped read of a project id by (user_id, domain); null when absent. */
async function readProject(
  client: ReturnType<typeof getServiceClient>,
  userId: string,
  domain: string,
): Promise<{ id: string } | null> {
  const { data, error } = await client
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .eq("domain", domain)
    .maybeSingle();
  if (error) {
    throw new Error(`projects lookup failed: ${error.message}`);
  }
  return data;
}

function alreadyExists(domain: string, row: { id: string }) {
  return textResult(
    `Project already exists for "${domain}" (project_id: ${row.id}, created: false).`,
  );
}
