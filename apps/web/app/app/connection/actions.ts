"use server";

import { revalidatePath } from "next/cache";
import { generateApiKey, mcpUrlFor, mcpUrlTemplate, tokenKeyBytes } from "@pseo/core";
import { countActiveKeys, createKey, listKeys, revokeKey } from "@pseo/db/api-keys-repo";
import { createServiceClient } from "@pseo/db/server";
import { captureKeyCreated } from "../../../lib/analytics";
import { accessTokenFor } from "../../../lib/gsc/accounts";
import { revokeGoogleToken } from "../../../lib/gsc/revoke";
import { createClient } from "../../../lib/supabase/server";

/**
 * Server actions for /app/connection. Each action re-derives the user from the
 * validated session (getUser) — NEVER from a client-supplied value — and touches only
 * that user's rows. The plaintext key exists solely in the return value of a
 * create/rotate call (shown once); it is never persisted, logged, or re-derivable.
 * Writes use the service-role client (authenticated has SELECT only); reads that need
 * RLS scoping happen in the RSC with the caller's own client.
 */

const CONNECTION_PATH = "/app/connection";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cap on simultaneously-active keys per user, enforced on BOTH mint paths (M-22).
//
// Rotate used to be EXEMPT on the argument that it is net-neutral (mint one, revoke one). That
// argument only holds while the OLD key is actually active — which the ownership check did not
// require, so rotating an already-revoked id minted a key and revoked nothing: net +1, repeatable,
// no ceiling. Liveness is now part of the ownership check and rotate consults the count before it
// mints, so neither path can grow the active set past the cap.
//
// The check is best-effort (a count read, not an atomic constraint) — it bounds accidental/abusive
// growth, not a money or security invariant.
const MAX_ACTIVE_KEYS = 5;

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface GeneratedKeyResult {
  /** Plaintext key — returned once for display, never stored. */
  readonly key: string;
  readonly prefix: string;
  /** Full personal MCP URL embedding the plaintext key — shown once. */
  readonly mcpUrl: string;
}

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
 * Authorize a key mutation: the target must exist, belong to `userId`, and still be ACTIVE.
 * Returns the same opaque "Key not found" for a malformed id, a missing key, another user's
 * key, and a revoked one, so nothing about other users' keys leaks.
 *
 * LIVENESS is part of the authorization, not a nicety (M-22): a revoked key is not a
 * credential anyone can still be holding, so rotating or re-revoking one is never a real
 * request — and treating it as one is what let rotate mint without revoking anything.
 *
 * The lookup runs `listKeys` on the SERVICE client rather than the caller's RLS-scoped one:
 * the explicit `user_id` filter it carries IS the tenant guard here (constitution NEVER #4),
 * the same posture as the other service-role reads on this table (countActiveKeys). It also
 * answers ownership and liveness in ONE round trip. The RSC render path keeps using the
 * caller's own client, where RLS remains the scope.
 */
async function assertActiveKeyOwnedBy(
  service: ServiceClient,
  keyId: string,
  userId: string,
): Promise<void> {
  if (!UUID_RE.test(keyId)) {
    throw new Error("Key not found");
  }
  const key = (await listKeys(service, userId)).find((candidate) => candidate.id === keyId);
  if (!key || key.revokedAt !== null) {
    throw new Error("Key not found");
  }
}

interface IssuedKey {
  /** Row id of the newly inserted key — rotate needs it for failure compensation. */
  readonly keyId: string;
  readonly result: GeneratedKeyResult;
}

/** Generate a key, persist only its hash + prefix, and return the one-time reveal. */
async function issueKey(service: ServiceClient, userId: string): Promise<IssuedKey> {
  const { key, prefix, hash } = generateApiKey();
  const created = await createKey(service, { userId, keyHash: hash, keyPrefix: prefix });
  return { keyId: created.id, result: { key, prefix, mcpUrl: mcpUrlFor(key, mcpUrlTemplate()) } };
}

export async function createKeyAction(): Promise<GeneratedKeyResult> {
  const userId = await requireUserId();
  const service = createServiceClient();
  const activeKeys = await countActiveKeys(service, userId);
  if (activeKeys >= MAX_ACTIVE_KEYS) {
    throw new Error(
      `You already have ${MAX_ACTIVE_KEYS} active API keys, the maximum. ` +
        "Revoke one before generating another.",
    );
  }
  const { result } = await issueKey(service, userId);
  revalidatePath(CONNECTION_PATH);
  await captureKeyCreated(userId, false);
  return result;
}

export async function rotateKeyAction(oldKeyId: string): Promise<GeneratedKeyResult> {
  const userId = await requireUserId();
  const service = createServiceClient();
  await assertActiveKeyOwnedBy(service, oldKeyId, userId);
  // Cap BEFORE the mint (M-22). The old key is required to be active above, so it is inside
  // `activeKeys` and leaves the set when we revoke it: the post-rotation count is `activeKeys`
  // itself. Refuse only when even that net-neutral mint would land above the cap — a user
  // already over it — so a legitimate rotation AT the limit still goes through, and a refused
  // one never creates a row it would then have to clean up.
  const activeKeys = await countActiveKeys(service, userId);
  if (activeKeys - 1 >= MAX_ACTIVE_KEYS) {
    throw new Error(
      `You have more than ${MAX_ACTIVE_KEYS} active API keys, the maximum. ` +
        "Revoke one before rotating.",
    );
  }
  // Chef order: mint + insert the new key FIRST, then revoke the old one, so the user is
  // never left without a copyable key (a brief double-active window is acceptable).
  const issued = await issueKey(service, userId);
  try {
    await revokeKey(service, oldKeyId);
  } catch (caught) {
    console.error("rotateKeyAction: revoking the old key failed:", caught);
    // Compensate: the throw below discards the new plaintext, so an active row for it
    // would be an unusable orphan while the OLD credential stays live. Best-effort
    // back-revoke restores the pre-rotation state (old key stays the single active one).
    try {
      await revokeKey(service, issued.keyId);
    } catch (compensation) {
      console.error("rotateKeyAction: back-revoking the new key also failed:", compensation);
      throw new Error("Rotation failed partway; contact support or retry");
    }
    throw new Error("Rotation failed; your existing key is unchanged");
  }
  revalidatePath(CONNECTION_PATH);
  // Only reached on full success (old key revoked) — a mid-rotation failure above throws
  // and never fires the funnel event, since the user did not end up with a usable new key.
  await captureKeyCreated(userId, true);
  return issued.result;
}

export async function revokeKeyAction(keyId: string): Promise<void> {
  const userId = await requireUserId();
  const service = createServiceClient();
  await assertActiveKeyOwnedBy(service, keyId, userId);
  await revokeKey(service, keyId);
  revalidatePath(CONNECTION_PATH);
}


/**
 * TWO LEVELS, because migration 0021 gave the credential two levels (finding #63).
 *
 * The refresh token used to hang off `gsc_connections` — one per (user, project) — so a
 * per-project "Disconnect" could revoke it at Google without touching anyone else. Migration
 * 0021 moved it to `gsc_accounts`: ONE grant per Google account, SHARED by every project
 * mapped to it. The old single action kept revoking from a per-project button, which now
 * kills every OTHER project on that account — silently, and documented nowhere.
 *
 * So the action splits along the axis the data already split along:
 *
 *   unmapProject      — the PROJECT level. Local only: the row loses its `account_id` and
 *                       `gsc_property`. It never contacts Google, because the grant it would
 *                       revoke does not belong to this project (see the ruling in its doc).
 *   disconnectAccount — the CREDENTIAL level. Revokes at Google, then deletes the account
 *                       row; `on delete set null` keeps every mapping alive.
 *   describeDisconnect — the confirmation text for the above, which must NAME the radius.
 */

/**
 * What a disconnect could establish about SeoGrep's grant at GOOGLE — the local deletion is a
 * separate, always-performed half.
 *
 *   revoked       — Google acknowledged the revoke. The only CONFIRMED outcome.
 *   unconfirmed   — we asked and Google did not acknowledge (refusal, outage, dead token).
 *   not_attempted — we never asked: a seal that would not open (T5), or a credential Google
 *                   already refuses to refresh.
 *
 * The last two are the honest names for "we do not know", and no caller may turn either of
 * them into a promise that access is gone (signed lesson 9 — the same disposition-follows-
 * verified-state posture as the credit guard's commit classification).
 */
export type GscRevocationOutcome = "revoked" | "unconfirmed" | "not_attempted";

/**
 * Unlink ONE project from Search Console. The row survives with `account_id` and
 * `gsc_property` cleared: the page derives its link state from those, and keeping the row
 * costs nothing while deleting it would take the project's identity with it.
 *
 * IT NEVER CALLS GOOGLE, and that is the fix rather than an omission. The grant lives on
 * `gsc_accounts` and is shared by every project mapped to it, so revoking it from here —
 * which is exactly what the old `disconnectGscAction` did — logs the user out of projects
 * they never touched (finding #63). Dropping SeoGrep's access to the Google account is a
 * deliberate, separately-confirmed act: {@link disconnectAccount}.
 *
 * Ownership: the row is addressed by (session user, project) and BOTH filters ride on the
 * UPDATE (constitution NEVER #4 — the service-role client bypasses RLS, so this filter is
 * the only tenant boundary). A forged project id therefore reaches nothing rather than
 * being found and refused, and no error distinguishes "not yours" from "not linked".
 */
export async function unmapProject(projectId: string): Promise<void> {
  const userId = await requireUserId();
  if (!UUID_RE.test(projectId)) {
    throw new Error("Connection not found");
  }
  const service = createServiceClient();
  const { error } = await service
    .from("gsc_connections")
    .update({ account_id: null, gsc_property: null })
    .eq("user_id", userId)
    .eq("project_id", projectId);
  if (error) {
    throw new Error(`gsc_connections unmap failed: ${error.message}`);
  }
  revalidatePath(CONNECTION_PATH);
}

/**
 * Ask Google to forget one account's grant, reporting which of the three outcomes above
 * actually happened.
 *
 * A MISSING or MALFORMED TOKEN_ENCRYPTION_KEY throws (signed lesson #5): that is a broken
 * deploy, and silently dropping the row while the Google-side grant lives on would turn a
 * config fault into a privacy fault. Everything AFTER the key is best-effort: a ciphertext
 * that will not open (retired key, corrupt bytes) and a credential Google itself refuses are
 * both per-row faults, and trapping the user with an undeletable account would be worse than
 * leaving one unusable grant un-revoked — so we log that we could not get a token (never the
 * ciphertext, the key, or any token) and let the deletion proceed, with `not_attempted`
 * telling the caller no revoke was ever tried.
 *
 * The token handed to Google is the ACCESS token `accessTokenFor` mints, not the refresh
 * token: Google's revoke endpoint accepts either and revokes the whole grant, and routing
 * through `accessTokenFor` keeps every unseal of a `gsc_accounts` credential in the one
 * module that owns that table (and its tenant filter).
 *
 * An already-dead grant is deliberately NOT special-cased into a success. Google answers a
 * dead token with 400 invalid_token, which `revokeGoogleToken` collapses into the same
 * `false` as an outage — and even a distinguishable 400 would only prove THIS token string
 * is unusable, not that the grant is gone. Reporting `revoked` from it would be precisely
 * the unverified promise these outcomes exist to prevent; a needless trip to Google's
 * permissions page costs far less than a false all-clear.
 */
async function revokeAccountGrant(
  service: ServiceClient,
  accountId: string,
  userId: string,
): Promise<GscRevocationOutcome> {
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("Search Console is not configured; disconnect is unavailable");
  }
  // Validate the key SHAPE before the try below. `accessTokenFor` would raise the very same
  // check from INSIDE it, where a mis-provisioned key (wrong length / non-hex) would be
  // misread as a per-row seal problem and delete the row without ever revoking. Same class
  // of fault as a missing key, so it takes the same fail-closed exit.
  tokenKeyBytes(encryptionKey);
  let accessToken: string;
  try {
    accessToken = await accessTokenFor(service, accountId, userId, encryptionKey);
  } catch (caught) {
    // T5: the revoke is SKIPPED here, and the row still goes. Name the skip and key it to the
    // account so an operator can find the grants a key retirement (or a dead credential) left
    // live at Google — this used to be indistinguishable from a completed disconnect. No
    // secret can ride along: neither `decryptToken` nor the token-endpoint error carries one.
    console.error(
      `disconnectAccount: account ${accountId} — no usable token could be obtained, ` +
        "Google-side revoke SKIPPED (the grant may still be live at Google):",
      caught,
    );
    return "not_attempted";
  }
  if (await revokeGoogleToken(accessToken)) {
    return "revoked";
  }
  // warn, not error: `revokeGoogleToken` is expected to answer false for grants Google
  // already dropped, so this is a routine unknown rather than a fault — but an unknown the
  // operator (and, in different words, the user) must be able to see.
  console.warn(
    `disconnectAccount: account ${accountId} — Google did not acknowledge the revoke; ` +
      "reporting the grant as unconfirmed",
  );
  return "unconfirmed";
}

/**
 * Disconnect one GOOGLE ACCOUNT: revoke the grant at Google, then delete the `gsc_accounts`
 * row (which is what removes the sealed refresh token). Both halves matter — without the
 * revoke the user's myaccount.google.com entry would survive a "Disconnect".
 *
 * The project MAPPINGS survive. `gsc_connections.account_id` is `on delete set null`, never
 * cascade (migration 0021), so every row keeps its `gsc_property` and merely loses its
 * account — the exact state the migration itself produced. One reconnect brings them all
 * back and nobody re-picks a property. Callers must therefore warn about the radius BEFORE
 * asking, which is what {@link describeDisconnect} is for.
 *
 * Ownership: the account is addressed by (session user, account) and BOTH filters ride on
 * the read AND the delete (NEVER #4), so another user's account is never found, never
 * deleted, and is reported with the same opaque message as a missing one.
 *
 * Order: revoke first, then delete. The revoke is best-effort — `revokeGoogleToken` never
 * throws (see its unit tests) and an unusable credential resolves to `not_attempted` — so a
 * Google outage or a dead grant can never leave the user stuck with an account they asked us
 * to drop.
 *
 * M-15: the RETURN VALUE is the point. The local half succeeded whenever this resolves, but
 * only `revoked` means Google confirmed anything, and the caller owes the user wording that
 * matches. Refusing the disconnect on a failed revoke would be the worse failure — it would
 * leave the user unable to disconnect at all — so the honest shape is "delete, then say
 * exactly what we know".
 */
export async function disconnectAccount(accountId: string): Promise<GscRevocationOutcome> {
  const userId = await requireUserId();
  if (!UUID_RE.test(accountId)) {
    throw new Error("Account not found");
  }
  const service = createServiceClient();
  const account = await service
    .from("gsc_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (account.error) {
    throw new Error(`gsc_accounts lookup failed: ${account.error.message}`);
  }
  if (!account.data) {
    throw new Error("Account not found");
  }

  const revocation = await revokeAccountGrant(service, accountId, userId);

  const { error } = await service
    .from("gsc_accounts")
    .delete()
    .eq("id", accountId)
    .eq("user_id", userId);
  if (error) {
    throw new Error(`gsc_accounts delete failed: ${error.message}`);
  }
  revalidatePath(CONNECTION_PATH);
  return revocation;
}

/**
 * The confirmation text for {@link disconnectAccount}, which must NAME how many projects the
 * disconnect reaches. That number is the entire lesson of finding #63: the old per-project
 * button revoked a SHARED grant and told the user nothing, so a click meant to unlink one
 * site quietly broke the rest. A radius the user cannot see is a radius they cannot consent
 * to.
 *
 * Deliberately future tense and free of any revocation claim: nothing has been asked of
 * Google yet, and only {@link disconnectAccount}'s return value may speak to what Google
 * actually confirmed (M-15).
 *
 * The count is a query like any other, so it carries the tenant filter (NEVER #4). A foreign
 * account id therefore counts zero rather than reporting another user's project count.
 */
export async function describeDisconnect(accountId: string): Promise<string> {
  const userId = await requireUserId();
  if (!UUID_RE.test(accountId)) {
    throw new Error("Account not found");
  }
  const service = createServiceClient();
  const { count, error } = await service
    .from("gsc_connections")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("account_id", accountId);
  if (error) {
    throw new Error(`gsc_connections count failed: ${error.message}`);
  }
  const projects = count ?? 0;
  const noun = projects === 1 ? "project" : "projects";
  return (
    `Disconnect this Google account? SeoGrep will ask Google to drop its access, and ` +
    `${projects} ${noun} will stop reading Search Console data until you connect the ` +
    "account again. Their property mappings are kept, so you will not have to pick them anew."
  );
}
