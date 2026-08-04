// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M-05 mint action. The load-bearing property: the id inside the token comes from the VALIDATED
 * session, never from anything the browser said — so a page that lies about who it is cannot get
 * a token for someone else. Supabase is mocked (no network); the real crypto runs.
 */

vi.mock("server-only", () => ({}));
vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));

import { readAttributionToken } from "../../../lib/billing/attribution";
import { createClient } from "../../../lib/supabase/server";
import { mintCheckoutAttribution } from "./attribution-action";

const createClientMock = vi.mocked(createClient);
const SECRET = "test_secret_pdl_ntfset_deadbeef";
const SESSION_USER_ID = "3f1a2b4c-5d6e-4f70-8a90-1b2c3d4e5f60";

/** Minimal stand-in for the SSR client: only auth.getUser is reached. */
function sessionUser(id: string | null): void {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("mintCheckoutAttribution", () => {
  beforeEach(() => {
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("signs the id from the validated session, and the webhook verifies it back", async () => {
    sessionUser(SESSION_USER_ID);
    const token = await mintCheckoutAttribution();
    expect(token).not.toBeNull();
    // Round-trip through the exact reader the webhook route uses.
    expect(
      readAttributionToken({ customData: { attribution_token: token } }, new Date()),
    ).toEqual({ status: "verified", userId: SESSION_USER_ID });
  });

  it("mints nothing when there is no signed-in user", async () => {
    sessionUser(null);
    await expect(mintCheckoutAttribution()).resolves.toBeNull();
  });

  it("mints nothing — rather than throwing — when the key material is absent", async () => {
    // A throw here would surface as a broken Buy button. Null lets checkout open unsigned and
    // the webhook's grace path accept it.
    sessionUser(SESSION_USER_ID);
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "");
    await expect(mintCheckoutAttribution()).resolves.toBeNull();
  });
});
