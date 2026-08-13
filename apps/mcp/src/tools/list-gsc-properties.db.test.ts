import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptToken, toByteaHex } from "@pseo/core";
import type { AuthContext } from "../auth.ts";
import { getServiceClient } from "../db.ts";
import { makeListGscPropertiesTool } from "./list-gsc-properties.ts";

/**
 * DB-integration proof for list_gsc_properties' PRODUCTION path — the one the fast-lane spec
 * cannot reach, because that spec injects all three ports.
 *
 * Here NOTHING is injected: the tool is built with its real defaults, so this drives the whole
 * chain — the tenant-filtered `gsc_accounts` read, `fromByteaHex`, `decryptToken` under the
 * `{ userId, accountId }` AAD, `refreshAccessToken`, `listSites`, and the projects ×
 * gsc_connections join. The DB is REAL; Google is a fake `fetch` that passes everything which is
 * not a Google URL through to the real one (so supabase-js keeps working) — zero network to
 * Google, NEVER #5.
 *
 * WHY THIS FILE EXISTS. Every failure on that chain renders as "could not be read", which is a
 * VALID-LOOKING answer. A column rename, an AAD change, a crypto version bump would turn every
 * account unreadable while all 925 unit tests stayed green — and for a tool whose entire job is
 * telling "unreadable" apart from "absent", silently answering "unreadable" for everything is the
 * worst possible latent state. So the happy path is pinned here, and so is the AAD binding
 * itself: the last spec seals a token to the WRONG account id and requires it to fail.
 */

// 64-hex (32-byte) AES-256 test key, DERIVED at runtime rather than written as a literal: to a
// secret scanner a 64-hex string in the source is indistinguishable from a real key, and the
// three that used to live in these `.db.test.ts` files took the `no-secrets` gate red on
// 2026-08-13. Hashing a fixed, public phrase keeps the key deterministic across runs while
// leaving nothing secret-shaped in the file for a scanner — or a future commit — to trip over.
const KEY = createHash("sha256").update("seogrep db-test token key").digest("hex");
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SITES_ENDPOINT = "https://www.googleapis.com/webmasters/v3/sites";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — export the local stack env (see guardrails/verify-db.sh)`);
  }
  return value;
}

requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = getServiceClient();

/** What the fake Google answers with, per test. */
interface GoogleFixture {
  readonly siteEntry: readonly { siteUrl: string; permissionLevel: string }[];
}

let google: GoogleFixture = { siteEntry: [] };
/** Which Google surfaces were actually reached — proof the real client ran, not a stub. */
let hits: string[] = [];

const realFetch = globalThis.fetch;

/** The URL a fetch argument names, for both string and Request forms. */
function hrefOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return String(input);
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const savedEnv = {
  key: process.env.TOKEN_ENCRYPTION_KEY,
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
};

beforeAll(() => {
  // The default listing path reads all three from the environment, so the spec must supply the
  // REAL production names (signed lesson 5) rather than an injected override.
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  process.env.GOOGLE_CLIENT_ID = "list-gsc-properties.db.test.invalid";
  process.env.GOOGLE_CLIENT_SECRET = "not-a-real-value-db-test";
  vi.stubGlobal("fetch", (input: unknown, init?: RequestInit): Promise<Response> => {
    const href = hrefOf(input);
    if (href.startsWith(TOKEN_ENDPOINT)) {
      hits.push("token");
      return Promise.resolve(json({ access_token: "ya29.db-test-access", expires_in: 3599 }));
    }
    if (href.startsWith(SITES_ENDPOINT)) {
      hits.push("sites.list");
      return Promise.resolve(json({ siteEntry: google.siteEntry }));
    }
    // Everything else — every supabase-js call in this file — reaches the real network.
    return realFetch(input as string, init);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  process.env.TOKEN_ENCRYPTION_KEY = savedEnv.key;
  process.env.GOOGLE_CLIENT_ID = savedEnv.clientId;
  process.env.GOOGLE_CLIENT_SECRET = savedEnv.clientSecret;
});

afterEach(() => {
  hits = [];
  google = { siteEntry: [] };
});

async function makeCtx(): Promise<AuthContext> {
  const { data, error } = await service.auth.admin.createUser({
    email: `props-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

/**
 * A real gsc_accounts row with a sealed refresh token. `sealTo` exists so one spec can seal the
 * blob to a DIFFERENT account id than the row it lives on — the AAD binding's own negative case.
 */
async function seedAccount(
  userId: string,
  email: string,
  sealTo?: string,
): Promise<{ accountId: string; email: string }> {
  const accountId = randomUUID();
  const { error } = await service.from("gsc_accounts").insert({
    id: accountId,
    user_id: userId,
    google_account_sub: `sub-${randomUUID()}`,
    google_account_email: email,
    encrypted_refresh_token: toByteaHex(
      encryptToken(`1//refresh-${randomUUID()}`, KEY, {
        userId,
        accountId: sealTo ?? accountId,
      }),
    ),
  });
  if (error) throw new Error(`gsc_accounts seed failed: ${error.message}`);
  return { accountId, email };
}

/** A project mapped to one account + property, so the "read by" join has something to find. */
async function seedMappedProject(
  userId: string,
  domain: string,
  accountId: string,
  property: string,
): Promise<void> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  const conn = await service.from("gsc_connections").insert({
    user_id: userId,
    project_id: data.id,
    account_id: accountId,
    gsc_property: property,
  });
  if (conn.error) throw new Error(`gsc_connections seed failed: ${conn.error.message}`);
}

/** The tool with NO ports injected — the production wiring is the subject of this file. */
async function run(ctx: AuthContext): Promise<string> {
  const result = await makeListGscPropertiesTool().run(ctx, {});
  expect(result.isError).toBeUndefined();
  return result.content.map((part) => part.text).join("\n");
}

async function ledgerRowCount(userId: string): Promise<number> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("id")
    .eq("user_id", userId);
  if (error) throw new Error(`ledger read failed: ${error.message}`);
  return (data ?? []).length;
}

describe("list_gsc_properties over the real database + the real Google client", () => {
  it("opens the sealed token, lists the account's properties, and names the project reading each", async () => {
    const ctx = await makeCtx();
    const account = await seedAccount(ctx.userId, `owner-${randomUUID()}@example.test`);
    await seedMappedProject(
      ctx.userId,
      `mapped-${randomUUID()}.example.com`,
      account.accountId,
      "sc-domain:mapped-property.example.com",
    );
    google = {
      siteEntry: [
        { siteUrl: "sc-domain:mapped-property.example.com", permissionLevel: "siteFullUser" },
        { siteUrl: "https://unverified-property.example.com/", permissionLevel: "siteUnverifiedUser" },
      ],
    };

    const text = await run(ctx);

    // The REAL client ran: both Google surfaces were reached in order.
    expect(hits).toEqual(["token", "sites.list"]);
    expect(text).toContain(account.email);
    expect(text).toContain(account.accountId);
    expect(text).toContain("sc-domain:mapped-property.example.com");
    expect(text).toMatch(/siteFullUser/);
    expect(text).toMatch(/read by mapped-/);
    // The unusable one is present WITH its reason — not dropped.
    expect(text).toContain("https://unverified-property.example.com/");
    expect(text).toMatch(/NOT QUERYABLE/);
    // …and this is a READ: the account was reachable, so nothing may claim otherwise.
    expect(text).not.toMatch(/could not be read/i);

    // 0 credits means 0 ledger rows — no reserve, no commit, nothing (NEVER #2).
    expect(await ledgerRowCount(ctx.userId)).toBe(0);
  });

  it("never reaches another tenant's account, even though the client bypasses RLS", async () => {
    const owner = await makeCtx();
    const intruder = await makeCtx();
    const ownerAccount = await seedAccount(owner.userId, `secret-owner-${randomUUID()}@example.test`);
    await seedMappedProject(
      owner.userId,
      `owner-${randomUUID()}.example.com`,
      ownerAccount.accountId,
      "sc-domain:owner-only.example.com",
    );
    const intruderAccount = await seedAccount(
      intruder.userId,
      `intruder-${randomUUID()}@example.test`,
    );
    google = {
      siteEntry: [{ siteUrl: "sc-domain:intruder-own.example.com", permissionLevel: "siteOwner" }],
    };

    const text = await run(intruder);

    // Non-empty on purpose: the intruder sees their OWN account, so this measures scoping
    // rather than an empty answer any broken read would also produce (NEVER #4).
    expect(text).toContain(intruderAccount.accountId);
    expect(text).toContain("sc-domain:intruder-own.example.com");
    expect(text).not.toContain(ownerAccount.accountId);
    expect(text).not.toContain(ownerAccount.email);
    expect(text).not.toContain("sc-domain:owner-only.example.com");
  });

  it("reports an account whose sealed token will not open as UNREADABLE, not as empty", async () => {
    // The AAD binding, measured rather than assumed: the blob is sealed to a DIFFERENT account
    // id than the row it sits on, exactly what a moved/planted ciphertext looks like. If the AAD
    // ever stops binding the account (crypto bump, refactor), this decrypts fine and the spec
    // goes red — which is the drift alarm the happy path above cannot raise on its own.
    const ctx = await makeCtx();
    const account = await seedAccount(ctx.userId, `mis-sealed-${randomUUID()}@example.test`, randomUUID());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const text = await run(ctx);
      expect(text).toMatch(/could not be read/i);
      expect(text).not.toMatch(/no search console properties/i);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(account.accountId),
        expect.any(Error),
      );
      // It never got as far as Google: the seal failed first.
      expect(hits).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
