"use server";

import { revalidatePath } from "next/cache";
import { generateApiKey, mcpUrlFor, mcpUrlTemplate } from "@pseo/core";
import { createKey, getKeyOwner, revokeKey } from "@pseo/db/api-keys-repo";
import { createServiceClient } from "@pseo/db/server";
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

/** Generate a key, persist only its hash + prefix, and return the one-time reveal. */
async function issueKey(service: ServiceClient, userId: string): Promise<GeneratedKeyResult> {
  const { key, prefix, hash } = generateApiKey();
  await createKey(service, { userId, keyHash: hash, keyPrefix: prefix });
  return { key, prefix, mcpUrl: mcpUrlFor(key, mcpUrlTemplate()) };
}

export async function createKeyAction(): Promise<GeneratedKeyResult> {
  const userId = await requireUserId();
  const service = createServiceClient();
  const result = await issueKey(service, userId);
  revalidatePath(CONNECTION_PATH);
  return result;
}

export async function rotateKeyAction(oldKeyId: string): Promise<GeneratedKeyResult> {
  const userId = await requireUserId();
  const service = createServiceClient();
  await assertOwnedBy(service, oldKeyId, userId);
  // Chef order: mint + insert the new key FIRST, then revoke the old one, so the user is
  // never left without a copyable key (a brief double-active window is acceptable).
  const result = await issueKey(service, userId);
  await revokeKey(service, oldKeyId);
  revalidatePath(CONNECTION_PATH);
  return result;
}

export async function revokeKeyAction(keyId: string): Promise<void> {
  const userId = await requireUserId();
  const service = createServiceClient();
  await assertOwnedBy(service, keyId, userId);
  await revokeKey(service, keyId);
  revalidatePath(CONNECTION_PATH);
}
