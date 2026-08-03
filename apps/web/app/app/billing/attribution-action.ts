"use server";

import { mintAttributionToken } from "../../../lib/billing/attribution";
import { createClient } from "../../../lib/supabase/server";

/**
 * M-05 — mint the checkout attribution token, SERVER-side, at the moment checkout starts.
 *
 * The whole point is that the id inside the token is re-derived here from the validated session
 * (`auth.getUser()`), never taken from the browser: `custom_data.user_id` is settable and
 * updatable from the page while the overlay is open, so it is a claim the webhook must be able to
 * check, not authority. The browser carries this token through customData and the webhook trusts
 * its SIGNED subject.
 *
 * Minted at CLICK time rather than page render so the short TTL measures "clicked Buy -> finished
 * paying" instead of "opened the billing page -> finished paying".
 *
 * Returns null instead of throwing — no signed-in session, or no key material. A null must never
 * block a sale: the caller opens checkout anyway and the webhook's grace path accepts the missing
 * token (and reports it). Enforcement is what turns that into a refusal, and it is opt-in.
 */
export async function mintCheckoutAttribution(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }
  return mintAttributionToken(user.id);
}
