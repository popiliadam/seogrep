/**
 * Minimal robots.txt parser for SeoGrepBot (first-audit crawler, not spec-complete).
 * Models only what the crawler acts on: group selection (a "seogrepbot" group beats
 * "*"), Allow/Disallow with longest-match-wins (`*` wildcard, `$` end-anchor), and
 * Crawl-delay. Unknown directives are ignored; a missing file allows all. User-agent
 * tokens match only "*" or an exact (case-insensitive) "seogrepbot" — enough for us.
 */

const BOT_TOKEN = "seogrepbot";

interface RuleGroup {
  readonly allow: string[];
  readonly disallow: string[];
  crawlDelayMs: number;
}

export interface RobotsRules {
  /** Crawl-delay for the selected group, in ms (raw — the crawler applies its own cap). */
  readonly crawlDelayMs: number;
  /** True if the selected group permits fetching `pathAndQuery` (e.g. "/blog?x=1"). */
  isAllowed(pathAndQuery: string): boolean;
}

/** Turn a robots path pattern (`/a/*.pdf$`) into an anchored RegExp. */
function patternToRegExp(pattern: string): RegExp {
  let src = "^";
  for (const ch of pattern) {
    if (ch === "*") {
      src += ".*";
    } else if (ch === "$") {
      src += "$";
    } else {
      src += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(src);
}

/** Length of the longest pattern in `patterns` that matches `path`, or -1 if none. */
function longestMatch(patterns: string[], path: string): number {
  let best = -1;
  for (const pattern of patterns) {
    if (pattern.length <= best) continue;
    if (patternToRegExp(pattern).test(path)) best = pattern.length;
  }
  return best;
}

/** Strip a trailing `# comment` and surrounding whitespace from a directive value. */
function cleanValue(value: string): string {
  const hash = value.indexOf("#");
  return (hash === -1 ? value : value.slice(0, hash)).trim();
}

/**
 * Parse robots.txt into rules for SeoGrepBot. Lines are grouped by consecutive
 * `User-agent:` declarations; each group collects its Allow/Disallow/Crawl-delay.
 */
export function parseRobots(text: string): RobotsRules {
  const groups = new Map<string, RuleGroup>();
  let activeAgents: string[] = []; // agents named by the current contiguous User-agent block
  let expectingAgents = false; // a directive seen -> the next User-agent starts a new block

  const groupFor = (agent: string): RuleGroup => {
    let group = groups.get(agent);
    if (!group) {
      group = { allow: [], disallow: [], crawlDelayMs: 0 };
      groups.set(agent, group);
    }
    return group;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const colon = rawLine.indexOf(":");
    if (colon === -1) continue;
    const field = rawLine.slice(0, colon).trim().toLowerCase();
    const value = cleanValue(rawLine.slice(colon + 1));

    if (field === "user-agent") {
      if (expectingAgents) {
        activeAgents = [];
        expectingAgents = false;
      }
      if (value) activeAgents.push(value.toLowerCase());
      continue;
    }

    if (activeAgents.length === 0) continue; // directive before any User-agent
    expectingAgents = true;

    for (const agent of activeAgents) {
      const group = groupFor(agent);
      if (field === "disallow") {
        if (value) group.disallow.push(value);
      } else if (field === "allow") {
        if (value) group.allow.push(value);
      } else if (field === "crawl-delay") {
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds > 0) group.crawlDelayMs = Math.round(seconds * 1000);
      }
    }
  }

  const selected = groups.get(BOT_TOKEN) ?? groups.get("*");

  return {
    crawlDelayMs: selected?.crawlDelayMs ?? 0,
    isAllowed(pathAndQuery: string): boolean {
      if (!selected) return true;
      const disallow = longestMatch(selected.disallow, pathAndQuery);
      if (disallow === -1) return true;
      const allow = longestMatch(selected.allow, pathAndQuery);
      // Longest match wins; a tie resolves in favour of Allow.
      return allow >= disallow;
    },
  };
}
