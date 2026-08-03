import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CREDIT_PACKAGES } from "@pseo/core";

/**
 * H-06 CROSS-PATH proof: the trial has TWO grant paths, and a dimension wired into only one of
 * them is not wired at all.
 *
 *   path 1  /auth/callback   — email confirmation / magic link / OAuth.
 *   path 2  /app layout      — the M-21 recovery point, reached on EVERY authenticated page and
 *                              the ONLY path a password login touches (it never sees path 1).
 *
 * A farmer need not use path 1: if path 2 still issued the unguarded two-argument claim they
 * would confirm nothing, log in, and collect the trial from the dashboard. So this file does
 * NOT mock `lib/billing/trial` the way `layout.test.tsx` and `callback/route.test.ts` do — it
 * runs the REAL route handler and the REAL layout against ONE shared stand-in for the
 * migration-0020 RPC and counts the ledger rows that come out the far end.
 */

const getUser = vi.fn();
const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();
const sendWelcomeIfFirst = vi.fn();
const captureSignup = vi.fn();
const rpc = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser, exchangeCodeForSession, verifyOtp } }),
}));
vi.mock("@pseo/db/server", () => ({ createServiceClient: () => ({ rpc }) }));
vi.mock("../lib/analytics", () => ({ captureSignup: (userId: string) => captureSignup(userId) }));
vi.mock("../lib/billing/welcome", () => ({
  sendWelcomeIfFirst: (userId: string, email: string) => sendWelcomeIfFirst(userId, email),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/link", () => ({ default: (props: { children?: unknown }) => props.children }));

import AppLayout from "./app/layout";
import { GET } from "./auth/callback/route";

const TRIAL = CREDIT_PACKAGES.trial.credits;
const BASE = "http://localhost:3457/auth/callback";

interface ClaimTrialArgs {
  readonly p_user_id: string;
  readonly p_amount: number;
  readonly p_email_fingerprint?: string;
}

interface Grant {
  readonly user_id: string;
  readonly amount: number;
}
/**
 * Shared stand-in for `claim_trial` after migration 0020, in the order the SQL runs it
 * (0020:119-167): the mailbox claim is taken FIRST and a taken fingerprint returns false
 * without touching the per-uid lock or the ledger; an absent/empty fingerprint skips that
 * branch and takes the plain 0009 path. ONE instance backs BOTH paths in every test below —
 * which is the point: two paths sharing a database is where a per-path bypass hides.
 */
function installSharedDb() {
  const grants: Grant[] = [];
  const mailboxes = new Map<string, string>();
  const locked = new Set<string>();

  rpc.mockImplementation(async (_name: string, args: ClaimTrialArgs) => {
    const fingerprint = args.p_email_fingerprint;
    if (fingerprint) {
      if (mailboxes.has(fingerprint)) return { data: false, error: null };
      mailboxes.set(fingerprint, args.p_user_id);
    }
    if (locked.has(args.p_user_id)) return { data: false, error: null };
    locked.add(args.p_user_id);
    grants.push({ user_id: args.p_user_id, amount: args.p_amount });
    return { data: true, error: null };
  });

  return { grants, credits: () => grants.reduce((sum, grant) => sum + grant.amount, 0) };
}

/** Path 1: confirm an email link. Drives the REAL callback route. */
async function signUpViaCallback(id: string, email: string): Promise<void> {
  exchangeCodeForSession.mockResolvedValue({ data: { user: { id, email } }, error: null });
  await GET(new Request(`${BASE}?code=code-${id}`));
}

/** Path 2: land on /app (what a password login does). Drives the REAL app layout. */
async function enterViaAppLayout(id: string, email: string | null): Promise<void> {
  getUser.mockResolvedValue({ data: { user: { id, email } } });
  await AppLayout({ children: null });
}

describe("H-06 across BOTH grant paths (real route + real layout, one shared DB)", () => {
  beforeEach(() => vi.stubEnv("WEB_BASE_URL", "http://localhost:3457"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("PATH 2 IS NOT A BYPASS: two uids entering ONLY via /app share one mailbox, one trial", async () => {
    // The bypass shape in its purest form — the callback is never touched. Before this slice
    // the layout issued the two-argument claim and handed out 200 credits per alias.
    const db = installSharedDb();

    await enterViaAppLayout("uid-a", "farm.h06@gmail.com");
    await enterViaAppLayout("uid-b", "farm.h06+second@gmail.com");

    expect(db.grants).toEqual([{ user_id: "uid-a", amount: TRIAL }]);
    expect(db.credits()).toBe(TRIAL); // 200 — not 400.
  });

  it("callback first, /app second: the second account is refused", async () => {
    const db = installSharedDb();

    await signUpViaCallback("uid-a", "farm.h06@gmail.com");
    await enterViaAppLayout("uid-b", "farm.h06+second@gmail.com");

    expect(db.grants).toEqual([{ user_id: "uid-a", amount: TRIAL }]);
    expect(db.credits()).toBe(TRIAL);
  });

  it("/app first, callback second: the mirror ordering is guarded too", async () => {
    // Neither path may be merely "the one that happens to run second".
    const db = installSharedDb();

    await enterViaAppLayout("uid-a", "farm.h06@gmail.com");
    await signUpViaCallback("uid-b", "farm.h06+second@gmail.com");

    expect(db.grants).toEqual([{ user_id: "uid-a", amount: TRIAL }]);
    expect(db.credits()).toBe(TRIAL);
  });

  it("BOTH paths send the identical fingerprint for the same mailbox", async () => {
    // Structural version of the same claim: the call sites are wired identically, so each sends
    // a byte-identical value. A path computing something else would land in a different mailbox
    // row and silently grant twice.
    installSharedDb();

    await signUpViaCallback("uid-a", "someone@example.com");
    const fromCallback = (rpc.mock.calls[0]?.[1] as ClaimTrialArgs).p_email_fingerprint;

    rpc.mockClear();
    await enterViaAppLayout("uid-b", "someone@example.com");
    const fromLayout = (rpc.mock.calls[0]?.[1] as ClaimTrialArgs).p_email_fingerprint;

    expect(fromCallback).toMatch(/^[0-9a-f]{64}$/);
    expect(fromLayout).toBe(fromCallback);
  });

  it("the repeat callback + every later /app render still append exactly ONE row", async () => {
    // Idempotency (M-21) survives the new dimension: the holder re-claiming its OWN mailbox is
    // not a collision, it is the ordinary already-granted no-op.
    const db = installSharedDb();

    await signUpViaCallback("uid-a", "solo.h06@gmail.com");
    await signUpViaCallback("uid-a", "solo.h06@gmail.com"); // repeat link click
    for (let i = 0; i < 3; i += 1) await enterViaAppLayout("uid-a", "solo.h06@gmail.com");

    expect(rpc).toHaveBeenCalledTimes(5); // really re-asked the DB every time...
    expect(db.grants).toHaveLength(1); // ...and the ledger took exactly one row.
    expect(captureSignup).toHaveBeenCalledExactlyOnceWith("uid-a");
  });

  it("FAIL OPEN on both paths: no address from the provider still grants the advertised trial", async () => {
    // A user the identity provider gives us no address for must not lose their 200 credits.
    const db = installSharedDb();

    await enterViaAppLayout("uid-a", null);
    await signUpViaCallback("uid-b", ""); // provider returned an empty address

    expect(db.grants).toEqual([
      { user_id: "uid-a", amount: TRIAL },
      { user_id: "uid-b", amount: TRIAL },
    ]);
    // ...and neither call asserted a mailbox identity it did not have.
    for (const call of rpc.mock.calls) {
      expect(call[1]).not.toHaveProperty("p_email_fingerprint");
    }
  });

  it("two DIFFERENT people are never merged across paths", async () => {
    const db = installSharedDb();

    await signUpViaCallback("uid-a", "alice@example.com");
    await enterViaAppLayout("uid-b", "bob@example.com");

    expect(db.credits()).toBe(TRIAL * 2);
  });

  it("a refused /app visitor is left claimable, and the dashboard still renders", async () => {
    // The refusal must not lock the user, and must not 500 the page that triggered it — the
    // layout swallows failures precisely so a bonus-credit decision cannot break the app.
    const db = installSharedDb();
    await signUpViaCallback("uid-a", "shared.h06@gmail.com");

    await expect(enterViaAppLayout("uid-b", "shared.h06+x@gmail.com")).resolves.not.toThrow();
    expect(db.grants.some((grant) => grant.user_id === "uid-b")).toBe(false);

    // Still claimable on a mailbox of their own — refused, not locked out.
    await enterViaAppLayout("uid-b", "uid-b-own@example.com");
    expect(db.grants.map((grant) => grant.user_id)).toEqual(["uid-a", "uid-b"]);
  });
});
