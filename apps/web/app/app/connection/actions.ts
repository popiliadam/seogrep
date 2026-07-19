"use server";

import { revalidatePath } from "next/cache";
import { generateApiKey, mcpUrlFor, mcpUrlTemplate } from "@pseo/core";
import { countActiveKeys, createKey, getKeyOwner, revokeKey } from "@pseo/db/api-keys-repo";
import { createServiceClient } from "@pseo/db/server";
import { captureKeyCreated } from "../../../lib/analytics";
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

// Cap on simultaneously-active keys per user, enforced when GENERATING a fresh key. Rotate is
// deliberately EXEMPT: it is net-neutral on the active count (it mints one and revokes one,
// create-first), so applying the cap there would wedge a user who is legitimately at the limit
// and wants to roll their credential. The check is best-effort (a count read, not an atomic
// constraint) — it bounds accidental/abusive growth, not a money or security invariant.
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
 * Authorize a key mutation: the target must exist and belong to `userId`. Returns the
 * same opaque "Key not found" for a malformed id, a missing key, and another user's
 * key, so nothing about other users' keys leaks.
 */
async function assertOwnedBy(service: ServiceClient, keyId: string, userId: string): Promise<void> {
  if (!UUID_RE.test(keyId)) {
    throw new Error("Key not found");
  }
  const owner = await getKeyOwner(service, keyId);
  if (owner !== userId) {
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
  await assertOwnedBy(service, oldKeyId, userId);
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
  await assertOwnedBy(service, keyId, userId);
  await revokeKey(service, keyId);
  revalidatePath(CONNECTION_PATH);
}
