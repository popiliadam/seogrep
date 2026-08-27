/**
 * MCP Apps (SEP-1865) — the ONE place this server knows about interactive views.
 *
 * WHAT THIS IS. An optional, backwards-compatible MCP extension (`io.modelcontextprotocol/ui`,
 * Final in the 2026-07-28 release) that lets a server ship an HTML view a supporting host renders
 * in-conversation, beside the text. Claude on web / desktop / mobile supports it; Cursor,
 * Windsurf and every terminal client do not.
 *
 * THIS FILE IS A PROBE, NOT A FEATURE (2026-08-27). There is an open bug against the extension
 * where hosts fall back to text and render nothing (ext-apps#671), and this server had never
 * served a resource of any kind. So before designing a themed card for 38 tools we ship ONE
 * deliberately unmistakable card on ONE 0-credit tool and find out what actually renders. It is
 * built to distinguish THREE outcomes, because "no card" and "card with no data" have different
 * causes and the same symptom if the view says nothing while it waits:
 *
 *   1. plain text only          -> the host never negotiated / never rendered the view
 *   2. card reading "waiting"   -> the iframe rendered, the DATA channel did not arrive
 *   3. card with the balance    -> the whole path works
 *
 * THE TEXT IS UNTOUCHED, and that is a contract rather than a courtesy. The spec keeps `content`
 * mandatory for two independent reasons: it is what the MODEL reads (a view tells Claude nothing),
 * and it is what non-supporting hosts show. It is also what this project's smoke tour measures —
 * all 38 tools are being walked through their text output — so a view that changed the text would
 * silently invalidate that whole record.
 *
 * NOTHING LOADS FROM THE NETWORK. The host's default CSP for a view is
 * `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
 * img-src 'self' data:; connect-src 'none'`, and a server may only widen it by DECLARING domains.
 * This card declares none: no web font, no CDN, no image host, no fetch. The brand's Newsreader /
 * IBM Plex Mono are therefore named with their real fallbacks (Georgia, Courier New) — which is
 * what seogrep.com itself falls back to before its fonts load.
 */

/** The content type SEP-1865 profiles for HTML views. Not `text/html`: hosts match on the profile. */
export const MCP_APP_MIME = "text/html;profile=mcp-app";

/** The extension id, as clients advertise it under `capabilities.extensions`. */
export const UI_EXTENSION_ID = "io.modelcontextprotocol/ui";

/** The probe view's resource URI. `ui://` is the scheme the extension reserves for views. */
export const BALANCE_CARD_URI = "ui://seogrep/credit-balance";

/** One UI resource, as `resources/list` advertises it and `resources/read` serves it. */
export interface UiResource {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly html: string;
}

/**
 * The brand tokens this card uses, copied from apps/web/app/globals.css.
 *
 * COPIED, and deliberately not imported: apps/mcp must not take a dependency on the web app, and
 * @pseo/core is a runtime-light package that has no business holding a palette. The cost is that
 * a rebrand touches two files, which is the right trade for a probe — if this becomes a real
 * feature the palette moves somewhere both surfaces read, and that decision belongs to the design
 * this probe exists to inform, not to the probe.
 */
const PALETTE = {
  paper: "#faf8f3",
  card: "#fffdf9",
  band: "#f5f2ea",
  ink: "#1c1b18",
  body: "#524f48",
  muted: "#6b6862",
  hairline: "#e2ddd2",
  accent: "#b45309",
  accentBadgeBg: "#f9f0dd",
  accentBadgeBorder: "#ecd9b8",
} as const;

/**
 * The view's script, as the host's default CSP allows it: inline, no fetch, no imports.
 *
 * THE HANDSHAKE IS DEFENSIVE ON PURPOSE. The spec has the view send `ui/initialize`, await the
 * host's result, then send `ui/notifications/initialized`; the host then sends
 * `ui/notifications/tool-input` and `ui/notifications/tool-result`. A probe that BLOCKED on the
 * initialize response would, against a host that answers it differently than we read the spec,
 * render nothing — and report outcome 1 ("never rendered") for what is really outcome 2. So the
 * card paints immediately, announces `initialized` on the response OR after a short timer,
 * whichever comes first, and renders on any `tool-result` it sees. Being wrong about the
 * handshake must not be able to look like being wrong about rendering.
 */
const VIEW_SCRIPT = `
(function () {
  var host = window.parent;
  var announced = false;
  function send(message) { try { host.postMessage(message, "*"); } catch (e) {} }
  function announce() {
    if (announced) return;
    announced = true;
    send({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
  }
  function text(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }
  function render(params) {
    var data = (params && params.structuredContent) || {};
    var blocks = (params && params.content) || [];
    // The sentence, from whichever channel this host populated. "summary" comes first because a
    // host that drops the content blocks is exactly the case that made it exist.
    // (No backticks in here: this script lives inside a TS template literal.)
    var fallback = data.summary || (blocks.length && blocks[0] && blocks[0].text ? blocks[0].text : "");
    text("state", "live");
    text("balance", data.balance === undefined ? "?" : String(data.balance));
    text("unit", data.balance === 1 ? "credit" : "credits");
    text("gate", data.paid === undefined ? "unknown" : (data.paid ? "Unlocked" : "Trial only"));
    text("gate-why", data.paid
      ? "This account has paid, so the tools that read live third-party SEO data are available."
      : "Vendor-backed tools need a PAID balance; trial credits alone do not unlock them.");
    text("raw", fallback);
  }
  window.addEventListener("message", function (event) {
    var message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.method === "ui/notifications/tool-result") { announce(); render(message.params); }
    if (message.id === 1) announce();
  });
  send({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} });
  setTimeout(announce, 400);
})();
`;

/**
 * The probe card's HTML — self-contained, one file, no external reference of any kind.
 *
 * It opens in the "waiting" state and SAYS SO. That word is the entire difference between the two
 * failure outcomes above: a card that rendered blank would be indistinguishable from a card that
 * never rendered, and the probe would answer the wrong question.
 */
export function balanceCardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SeoGrep — credit balance</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0; padding: 16px;
    background: ${PALETTE.paper};
    color: ${PALETTE.ink};
    font-family: Newsreader, Georgia, serif;
  }
  .card {
    background: ${PALETTE.card};
    border: 1px solid ${PALETTE.hairline};
    border-radius: 10px;
    padding: 18px 20px;
    max-width: 460px;
  }
  .brand {
    display: flex; align-items: baseline; justify-content: space-between;
    border-bottom: 1px solid ${PALETTE.hairline}; padding-bottom: 10px; margin-bottom: 14px;
  }
  .brand h1 { margin: 0; font-size: 15px; letter-spacing: .02em; color: ${PALETTE.accent}; }
  .badge {
    font-family: "IBM Plex Mono", "Courier New", monospace; font-size: 10px;
    text-transform: uppercase; letter-spacing: .08em;
    background: ${PALETTE.accentBadgeBg}; border: 1px solid ${PALETTE.accentBadgeBorder};
    border-radius: 999px; padding: 2px 8px; color: ${PALETTE.accent};
  }
  .figure { display: flex; align-items: baseline; gap: 8px; margin: 0 0 14px; }
  .figure b {
    font-family: "IBM Plex Mono", "Courier New", monospace;
    font-size: 34px; font-weight: 600; line-height: 1; color: ${PALETTE.ink};
  }
  .figure span { font-size: 14px; color: ${PALETTE.muted}; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 7px 0; border-top: 1px solid ${PALETTE.hairline}; }
  th { width: 34%; font-weight: 400; color: ${PALETTE.muted}; }
  td { color: ${PALETTE.body}; }
  tr:first-child th, tr:first-child td { border-top: 0; }
  .band {
    margin-top: 14px; padding: 8px 10px; background: ${PALETTE.band};
    border-radius: 6px; font-size: 11px; color: ${PALETTE.muted};
    font-family: "IBM Plex Mono", "Courier New", monospace; word-break: break-word;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <h1>SeoGrep</h1>
      <span class="badge" id="state">waiting</span>
    </div>
    <p class="figure"><b id="balance">—</b><span id="unit">credits</span></p>
    <table>
      <tr><th>Vendor tools</th><td id="gate">—</td></tr>
      <tr><th>Why</th><td id="gate-why">Waiting for the host to send this call's result.</td></tr>
    </table>
    <div class="band" id="raw">This card is a rendering probe. The tool's text answer is unchanged and is what the assistant reads.</div>
  </div>
<script>${VIEW_SCRIPT}</script>
</body>
</html>`;
}

/** Every UI resource this server serves. One, for now, and on purpose. */
export const UI_RESOURCES: readonly UiResource[] = [
  {
    uri: BALANCE_CARD_URI,
    name: "credit_balance_card",
    description: "SeoGrep-styled view of a credit balance answer.",
    html: balanceCardHtml(),
  },
];
