import { cardCss } from "./style.ts";
import { VIEW_SCRIPT } from "./runtime.ts";

/** The content type SEP-1865 profiles for HTML views. Hosts match on the profile, not on text/html. */
export const MCP_APP_MIME = "text/html;profile=mcp-app";

/** The extension id, as clients advertise it under `capabilities.extensions`. */
export const UI_EXTENSION_ID = "io.modelcontextprotocol/ui";

/** The one view this server serves. Every carded tool points at it (spec §4). */
export const CARD_URI = "ui://seogrep/card";

/** One UI resource, as `resources/list` advertises it and `resources/read` serves it. */
export interface UiResource {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly html: string;
}

/**
 * The card document: static markup, one stylesheet, one script, nothing fetched.
 *
 * It opens in the WAITING state and says so. That word is an instrument, not decoration: a card
 * that rendered blank would be indistinguishable from a card that never rendered, and the two
 * have different causes.
 */
export function cardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SeoGrep</title>
<style id="sg-host-fonts"></style>
<style>${cardCss()}</style>
</head>
<body>
  <div class="sg-card">
    <div class="sg-head">
      <h1 class="sg-brand">SeoGrep</h1>
      <span class="sg-title" id="sg-title"></span>
      <span class="sg-badge" id="sg-badge">waiting</span>
    </div>
    <p class="sg-figure"><b id="sg-value">—</b><span id="sg-unit"></span></p>
    <table><tbody id="sg-facts"></tbody></table>
    <div class="sg-note" id="sg-note">Waiting for this call's result. The tool's text answer is unchanged and is what the assistant reads.</div>
  </div>
<script>${VIEW_SCRIPT}</script>
</body>
</html>`;
}

/** Every UI resource this server serves. One, by design (spec §4). */
export const UI_RESOURCES: readonly UiResource[] = [
  {
    uri: CARD_URI,
    name: "seogrep_card",
    description: "SeoGrep-styled view of a tool result.",
    html: cardHtml(),
  },
];
