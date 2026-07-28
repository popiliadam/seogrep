"use server";

import { revalidatePath } from "next/cache";
import {
  decryptToken,
  fromByteaHex,
  generateApiKey,
  mcpUrlFor,
  mcpUrlTemplate,
  tokenKeyBytes,
} from "@pseo/core";
import { countActiveKeys, createKey, listKeys, revokeKey } from "@pseo/db/api-keys-repo";
import { createServiceClient } from "@pseo/db/server";
import { captureKeyCreated } from "../../../lib/analytics";
import { revokeGoogleToken } from "../../../lib/gsc/revoke";
import { deleteGscConnection, findGscConnection } from "../../../lib/gsc/store";
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
 * Open the sealed refresh token and ask Google to forget the grant.
 *
 * A MISSING or MALFORMED TOKEN_ENCRYPTION_KEY throws (signed lesson #5): that is a broken
 * deploy, and silently dropping the row while the Google-side grant lives on would turn a
 * config fault into a privacy fault. Everything AFTER the key is best-effort: an unopenable
 * ciphertext (rotated key, corrupt bytes) is a per-row fault, and trapping the user with an
 * undeletable connection would be worse than leaving one unusable token un-revoked — so we
 * log that we could not open it (never the ciphertext or the key) and let the deletion proceed.
 */
async function revokeStoredToken(encryptedTokenHex: string): Promise<void> {
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("Search Console is not configured; disconnect is unavailable");
  }
  // Validate the key SHAPE outside the try below. `decryptToken` would raise the very same
  // check from INSIDE it, where a mis-provisioned key (wrong length / non-hex) would be
  // misread as a per-row seal problem and delete the row without ever revoking. Same class
  // of fault as a missing key, so it takes the same fail-closed exit.
  tokenKeyBytes(encryptionKey);
  let refreshToken: string;
  try {
    refreshToken = decryptToken(fromByteaHex(encryptedTokenHex), encryptionKey);
  } catch (caught) {
    console.error("disconnectGscAction: stored token could not be opened, skipping revoke:", caught);
    return;
  }
  await revokeGoogleToken(refreshToken);
}

/**
 * Disconnect one project from Search Console: revoke the grant at Google, then delete the
 * stored connection (which is what removes the sealed refresh token). Both halves matter —
 * without the revoke the user's myaccount.google.com entry would survive a "Disconnect".
 *
 * Ownership: the connection is addressed by (session user, project) and BOTH filters ride on
 * the read AND the delete (NEVER #4), so another user's connection is never found, never
 * deleted, and is reported with the same opaque message as a missing one.
 *
 * Order: revoke first, then delete. The revoke is best-effort — `revokeGoogleToken` never
 * throws (see its unit tests), so a Google outage or an already-dead token can never leave
 * the user stuck with a connection they asked us to drop.
 */
export async function disconnectGscAction(projectId: string): Promise<void> {
  const userId = await requireUserId();
  if (!UUID_RE.test(projectId)) {
    throw new Error("Connection not found");
  }
  const service = createServiceClient();
  const connection = await findGscConnection(service, { userId, projectId });
  if (!connection) {
    throw new Error("Connection not found");
  }
  if (connection.encryptedTokenHex) {
    await revokeStoredToken(connection.encryptedTokenHex);
  }
  await deleteGscConnection(service, { userId, projectId });
  revalidatePath(CONNECTION_PATH);
}
