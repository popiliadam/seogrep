/**
 * The banner /app renders after a Google Search Console link attempt. /api/gsc/connect and
 * /api/gsc/callback both bounce the user back to /app with a `?gsc=` status (and, on success,
 * a `?property=`); this maps those to fixed English copy.
 *
 * Purely presentational — no data access, no interactivity — so it stays a server component.
 * Every message is a LITERAL: the raw param is never echoed into the page, and an unknown or
 * absent status renders nothing at all, so a crafted ?gsc= value can produce no output. The
 * lookup is a Map (not a record) so an inherited key like "constructor" cannot resolve.
 */

type BannerTone = "success" | "notice" | "error";

interface BannerMessage {
  readonly tone: BannerTone;
  readonly text: string;
}

/** Manpage callout: 2px left border on the card surface; tone shows in the border + text. */
const TONE_STYLES: Readonly<Record<BannerTone, string>> = {
  success: "border-l-positive text-positive",
  notice: "border-l-accent text-warn",
  error: "border-l-negative text-negative",
};

/** The failure statuses the two GSC routes can redirect with. */
const FAILURES: ReadonlyMap<string, BannerMessage> = new Map([
  [
    "error",
    { tone: "error", text: "Something went wrong connecting Search Console. Please try again." },
  ],
  ["denied", { tone: "error", text: "You declined Google access. You can reconnect any time." }],
  ["unknown_project", { tone: "error", text: "That project was not found in your account." }],
  [
    "no_token",
    { tone: "error", text: "Google did not return a token. Please try connecting again." },
  ],
]);

const CONNECTED_MATCHED: BannerMessage = {
  tone: "success",
  text: "Search Console connected.",
};

/**
 * The honest fallback for every `connected` return that is not an explicit `property=matched`:
 * the token is stored, but no verified property was matched, so the user still has work to do.
 */
const CONNECTED_UNMATCHED: BannerMessage = {
  tone: "notice",
  text: "Search Console connected, but no verified property matches this domain yet. Verify the domain in Search Console, then pull data.",
};

function messageFor(status?: string, property?: string): BannerMessage | null {
  if (status === "connected") {
    return property === "matched" ? CONNECTED_MATCHED : CONNECTED_UNMATCHED;
  }
  return status === undefined ? null : (FAILURES.get(status) ?? null);
}

/** Renders the GSC return status, or nothing when there is no (known) status to report. */
export function GscBanner({ status, property }: { status?: string; property?: string }) {
  const message = messageFor(status, property);
  if (message === null) {
    return null;
  }
  return (
    <p
      role={message.tone === "error" ? "alert" : "status"}
      className={`m-0 border-l-2 bg-card px-4 py-3 font-mono text-[12.5px] leading-[1.6] ${TONE_STYLES[message.tone]}`}
    >
      {message.text}
    </p>
  );
}
