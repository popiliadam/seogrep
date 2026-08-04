import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PrivacyPage from "../app/(marketing)/privacy/page";

/**
 * M-25: the deletion promise must read the SAME on every official surface, and that shared reading
 * must be the one the schema actually enforces.
 *
 * WHAT WAS MEASURED, on the local 0001-0020 stack (2026-08-03), not inferred from the DDL:
 *
 *   1. Deleting the account row is REFUSED outright while any ledger row exists —
 *      `credit_ledger.user_id -> auth.users ON DELETE RESTRICT`
 *      (packages/db/supabase/migrations/0002_credit_ledger.sql:12). Probed with one grant row
 *      present: `ERROR: update or delete on table "users" violates foreign key constraint
 *      "credit_ledger_user_id_fkey" on table "credit_ledger"`.
 *   2. A ledger row cannot be deleted by ANYONE, up to and including the table owner: the
 *      `credit_ledger_append_only` BEFORE UPDATE OR DELETE trigger raises regardless of role
 *      (0002_credit_ledger.sql:36-40). Probed as the postgres superuser:
 *      `ERROR: append-only table: DELETE blocked on credit_ledger`.
 *   3. EVERY completed signup has at least one such row — `claim_trial` appends the trial grant in
 *      the same transaction as the lock (0009_faz3_jobs_reports_indexes.sql:125-127), called from
 *      apps/web/app/auth/callback/route.ts:84. So (1) applies to every real account, not an edge
 *      case.
 *   4. Everything else in the tenant tree is ON DELETE CASCADE from auth.users — users_profile,
 *      projects, api_keys, subscriptions, jobs, reports, gsc_connections (0001_core_tables.sql:11,
 *      29, 48, 69, 91, 112 and 0003_paddle_events.sql:26) — so "everything else is removed" is the
 *      honest other half of the sentence.
 *
 * "We remove all of it" is therefore false, and "we remove it, except the ledger entries and the
 * account record they hang off" is true. These guards pin BOTH halves: a surface may not drop the
 * exception (the M-25 contradiction), and it may not quietly retreat from the deletion right
 * either — a page that answers a GDPR/KVKK request by promising less is not a fix.
 */

/**
 * The @pseo/web package root. `import.meta.url` is not a file: URL under the jsdom environment, so
 * this follows lib/node-floor.test.ts and resolves from the cwd vitest is launched in.
 */
const ROOT = process.cwd();
if (!existsSync(join(ROOT, "content/docs"))) {
  throw new Error(`expected to run from the @pseo/web package root; got ${ROOT}`);
}

/** The append-only exception, in the words every surface has to share. */
const LEDGER_EXCEPTION = [/append-only/i, /accounting records/i] as const;

/** Unconditional removal — the exact class of claim the ledger armor makes untrue. */
const UNCONDITIONAL =
  /remove (all|everything|all of it)|erase everything|delete everything|without exception|no exceptions/i;

/**
 * Reads a surface and refuses to hand back copy that would make the negative guards pass
 * vacuously: the anchor proves we read the right file, the floor proves we read a populated one.
 *
 * Whitespace is normalised because these are hard-wrapped .mdx files — "kept as accounting
 * records" is one sentence to a reader and two lines on disk, and a guard that could be defeated
 * by a reflow would be pinning the line breaks rather than the promise.
 */
function surface(relativePath: string, anchor: string, floor: number): string {
  const text = readFileSync(join(ROOT, relativePath), "utf8").replace(/\s+/g, " ");
  expect(text, `${relativePath} is missing its anchor — wrong file, or the section was renamed`)
    .toContain(anchor);
  expect(text.length, `${relativePath} holds far less copy than the page has`).toBeGreaterThan(floor);
  return text;
}

/** The privacy policy as a reader sees it: rendered, not source-scraped. */
function privacyText(): string {
  const { container } = render(<PrivacyPage />);
  const text = container.textContent ?? "";
  expect(text, "empty render — the negative guards would pass vacuously").toContain("Your rights");
  expect(text.length, "privacy page rendered far less copy than the policy has").toBeGreaterThan(1500);
  return text;
}

const SURFACES = [
  { name: "privacy policy (/privacy)", read: privacyText },
  {
    name: "docs: data retention",
    read: () => surface("content/docs/core-concepts/data-retention.mdx", "## Deleting your data", 800),
  },
  {
    name: "docs: FAQ",
    read: () => surface("content/docs/faq.mdx", "## How do I delete my data?", 800),
  },
] as const;

describe("deletion promise is consistent across every official surface (M-25)", () => {
  it.each(SURFACES)("$name states the append-only ledger exception", ({ read }) => {
    const text = read();
    for (const phrase of LEDGER_EXCEPTION) {
      expect(text, `exception missing: nothing matches ${phrase}`).toMatch(phrase);
    }
  });

  it.each(SURFACES)("$name promises no unconditional removal", ({ read }) => {
    expect(read()).not.toMatch(UNCONDITIONAL);
  });

  it.each(SURFACES)("$name still tells users how to exercise the right", ({ read }) => {
    // The fix for the contradiction is the exception, never a retreat from the promise: each
    // surface must keep pointing at the address that actually actions a deletion request.
    expect(read()).toMatch(/support@seogrep\.com/);
  });

  it("keeps the GDPR and KVKK commitment the exception sits beside", () => {
    const text = privacyText();
    expect(text).toMatch(/GDPR/);
    expect(text).toMatch(/KVKK/);
    expect(text).toMatch(/including access and erasure/i);
  });

  it("names what deletion DOES cover, so the exception cannot read as a blanket carve-out", () => {
    // The CASCADE side of the schema (see (4) above) is a real promise and has to stay legible.
    const text = privacyText();
    expect(text).toMatch(/crawl data/i);
    expect(text).toMatch(/Search Console data/i);
    expect(text).toMatch(/report outputs/i);
  });

  it("says the account record is kept with the ledger entries, because RESTRICT keeps it", () => {
    // Measured (1): the auth.users row cannot go while ledger rows reference it. A policy that
    // said only "the ledger entries survive" would still be describing a deletion that cannot run.
    for (const { read } of [SURFACES[0], SURFACES[1]]) {
      const text = read();
      expect(text).toMatch(/account record/i);
      expect(text).toMatch(/kept alongside/i);
    }
  });

  it("routes the two docs surfaces to the policy and to each other", () => {
    // A reader who lands on the FAQ must be able to reach the full statement, or the surfaces are
    // consistent only for whoever reads all three.
    const retention = SURFACES[1].read();
    const faq = SURFACES[2].read();
    expect(retention).toContain("(/privacy)");
    expect(faq).toContain("(/docs/core-concepts/data-retention)");
  });
});
