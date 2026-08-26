import { TOOL_COSTS } from "../../mcp/src/credits/costs";

/**
 * THE PRICE-CLAIM GUARD: no docs page may call a tool free unless the signed table says it is.
 *
 * WHY IT EXISTS (measured 2026-08-25/26). One documentation slice shipped the SAME false claim by
 * two independent routes, in two different files, both a single adjective:
 *
 *   1. `serp_snapshot`'s DOC_PROSE — "`track_keywords` and `keyword_positions` are free and run on
 *      any account". `keyword_positions` is 10 credits. The page that says so was two screens away.
 *   2. `billing-and-credits.mdx` — "the two free halves of the rank tracker (`track_keywords` and
 *      `keyword_positions`)". Written separately, under a heading about trial credits, where the
 *      word "free" felt harmless because the surrounding claim ("trial credits cover these") was
 *      true. IT IS A DIFFERENT CLAIM, and it was false.
 *
 * Nothing in this repo could have caught either. The docs pipeline has exactly two price defences:
 * `stripCostSentences`, which removes a cost sentence from a tool DESCRIPTION, and the derived
 * `**Cost:**` line, which is generated from TOOL_COSTS and therefore cannot drift. Both operate on
 * NUMBERS. A QUALITATIVE price claim — "free", "costs nothing" — passes every check the pipeline
 * has, and a scan for credit digits reports a clean bill of health while sitting right next to one.
 * That is the gap this file closes, and it is worth stating plainly: a passing scan is not coverage
 * of an axis it never looked at.
 *
 * WHERE TOOL_COSTS COMES FROM, AND WHY NOT `dist`. From `apps/mcp/src/credits/costs` — the same
 * import `tool-docs-gen.test.ts` next door already uses. The `--check` CLI reads `dist` because it
 * loads the whole tool REGISTRY, which only exists built; that is also why a stale `dist` gives it
 * a false green (measured this round with a canary). A vitest spec has no such constraint: it
 * resolves the TypeScript source directly, so it reads the signed table as it is RIGHT NOW and
 * cannot be green against a build from yesterday. Source is the stronger choice here, not the
 * weaker one.
 */

export type PricedTool = keyof typeof TOOL_COSTS;

/** Longest first, so `ai_visibility_compare` is never matched as `ai_visibility` plus noise. */
const TOOL_NAMES: readonly string[] = Object.keys(TOOL_COSTS).sort((a, b) => b.length - a.length);

/** Sentinels around a marked tool reference. `§` cannot occur in these docs. */
const MARK = "§";

/**
 * The vocabulary, and why each entry is in it. Every one of these asserts that something COSTS
 * NOTHING. That is the whole axis; a word that asserts anything else does not belong here, because
 * a guard that fires on true sentences gets deleted by the next person it inconveniences.
 *
 *  • `free`          — the word that produced BOTH defects. Nothing else in this list has a
 *                      measured failure behind it; this one has two.
 *  • `costs nothing` / `charges nothing` / `at no cost` / `no charge`
 *                    — the same assertion in the wordings this corpus actually uses. They are here
 *                      so a future author cannot route around `free` by paraphrase, which is the
 *                      obvious way this guard would otherwise be defeated without anyone meaning to.
 *  • `included`      — "included" means "you do not pay extra for it". Weaker than the rest and
 *                      kept only because the binder below protects its common innocent use
 *                      ("subdomains are **included**" binds no tool, so it cannot fire).
 *
 * DELIBERATELY NOT IN THE VOCABULARY, each for a reason:
 *
 *  • "not charged" / "you were not charged" — asserts a REFUSAL BRANCH cost nothing, never a
 *    tool's price. It appears ~30 times in this corpus, truthfully, on priced tools. Including it
 *    would redden the entire refusal-honesty surface this same slice built.
 *  • "trial credits" / "covered by trial credits" — NOT a price claim. It is an availability
 *    claim, and conflating the two is the exact error defect #2 came from; the corrected sentence
 *    now says so in the docs. A guard repeating the mistake would be worse than none.
 *  • "charges for" / "priced" / "costs N credits" — the OPPOSITE claim. Numbers are already
 *    covered by the derived cost line.
 */
const FREE_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bfree\b/gi,
  /\bcosts?\s+nothing\b/gi,
  /\bcharges?\s+(?:you\s+)?nothing\b/gi,
  /\bat\s+no\s+cost\b/gi,
  /\bno\s+charge\b/gi,
  /\bincluded\b/gi,
];

/**
 * Words that may sit between a tool reference and a claim about it without breaking the binding.
 *
 * THIS LIST IS THE GUARD'S PRECISION, and it is deliberately short. `tool` is NOT on it, and that
 * single omission is what keeps the four audit pages clean: "Run `crawl_site` first — … **the
 * tool** says so and charges nothing" names a 20-credit tool beside a free claim, but the claim's
 * subject is the word "tool" (the page's own), so the backward walk stops there and binds nothing.
 * A blanket allowlist entry for those four sentences would have worked too, and would have rotted
 * the first time a fifth page said it. Pinning the SHAPE costs one omitted word.
 */
const BINDING_FILLER: ReadonlySet<string> = new Set([
  "is", "are", "was", "were", "be", "being", "been",
  "and", "or", "both", "all", "two", "three", "each", "either", "neither",
  "which", "that", "they", "it", "one", "also", "still", "genuinely", "simply",
  "run", "runs", "remain", "remains", "stay", "stays",
]);

/** Markdown link `[text](href)` → `text`, so a link and a bare mention normalize alike. */
function stripLinks(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

/** Replace every tool mention (backticked, linked or bare) with a `§name§` sentinel. */
export function markToolReferences(text: string): string {
  let out = stripLinks(text);
  for (const name of TOOL_NAMES) {
    out = out.replace(new RegExp(`\`?\\b${name}\\b\`?`, "g"), `${MARK}${name}${MARK}`);
  }
  return out;
}

/**
 * Split prose into CLAUSES — the unit a claim is attributed within.
 *
 * Three things happen here, and each is load-bearing:
 *   • Markdown soft wraps are joined. "the two free\nhalves … (`a` and `b`)" is ONE clause; the
 *     original defect #2 was hard-wrapped exactly across its own binding, so a splitter that
 *     treated `\n` as a boundary would have missed it. Measured against the real sentence.
 *   • A list marker starts a new clause, so a claim cannot bind to a tool in the bullet above it.
 *   • Sentences split on punctuation FOLLOWED BY SPACE, never on a bare dot: `example.com` and
 *     `sc-domain:example.com` appear throughout and must not fragment.
 */
export function toClauses(text: string): string[] {
  const BREAK = "\u0001";
  return text
    .split(/\n\s*\n/)
    .flatMap((paragraph) =>
      paragraph
        // A bullet opens a new clause; every other newline is a markdown soft wrap and is joined.
        .replace(/\n(?=\s*[-*]\s)/g, BREAK)
        .replace(/\n/g, " ")
        .split(BREAK)
        .flatMap((line) => line.split(/(?<=[.;:!?])\s+/)),
    )
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

/** Tokens of the text preceding a claim, most recent first, with sentinels kept whole. */
function tokensBefore(before: string): string[] {
  return (before.match(new RegExp(`${MARK}[a-z_]+${MARK}|[A-Za-z']+`, "g")) ?? []).reverse();
}

/**
 * PREDICATIVE binding: "`a` and `b` are free" — the tools sit immediately before the claim, with
 * only connectives between. Walks backwards, collecting tool sentinels and skipping filler, and
 * stops dead at the first word that is neither. Returns [] when nothing binds.
 */
function bindBackward(clause: string, claimStart: number): string[] {
  const bound: string[] = [];
  for (const token of tokensBefore(clause.slice(0, claimStart))) {
    if (token.startsWith(MARK)) {
      bound.push(token.slice(MARK.length, -MARK.length));
      continue;
    }
    if (BINDING_FILLER.has(token.toLowerCase())) continue;
    break;
  }
  return bound;
}

/**
 * ATTRIBUTIVE binding: "the two **free** halves of the rank tracker (`a` and `b`)" — the claim is
 * an adjective on a noun phrase that a delimited list then identifies. Requires a short noun
 * phrase (at most six words) and then a `(`/`—` opening a run containing ONLY tool references and
 * connectives.
 *
 * THE DELIMITER AND THE PURITY TEST ARE BOTH REQUIRED, and together they are why the CORRECTED
 * sentence stays green: "…which is free, and `keyword_positions`, which charges for the analysis"
 * has a tool a few words after the claim, but no opening delimiter and a run that continues into
 * ordinary prose. Contrast is normal, good writing about two tools with different prices, and a
 * guard that punished it would be a guard nobody keeps.
 *
 * WHAT THE DELIMITER OPENS: A LIST, OR A REMARK? The first version of this binder never asked. It
 * required the delimited run to START with tool references and let the sentence continue however it
 * liked afterwards, which made two opposite sentences indistinguishable:
 *
 *     "The refusal is free — `research_keywords` charges only when it delivers."   ← TRUE, a remark
 *     "…the two free halves of the rank tracker (`a` and `b`, which both run…)."   ← FALSE, a list
 *
 * The first was reported at 25 credits (measured 2026-08-26). Nothing in today's corpus is written
 * that way, so it never fired — it was one contrast sentence away from being the false positive
 * that gets a guard deleted. A FIRST FIX required the run to reach its closer, and a judge measured
 * what that cost: five shapes stopped binding, and the first of them is measured defect #2 with one
 * relative clause added. A guard that catches a shipped defect but not the same defect plus ", which
 * both run on any account" is not a guard, so closure alone is not the test. Two are:
 *
 *  1. THE RUN REACHES ITS CLOSER (`listIsClosed`) — "…the rank tracker (`a` and `b`)." The
 *     parenthetical holds the list and nothing else, so it identifies whatever the claim modified,
 *     however many tools it names.
 *  2. THE RUN ENUMERATES, AND THE CLAIM IS ATTRIBUTIVE — two or more DISTINCT tools joined by
 *     connectives, after a claim that has a head noun in front of the delimiter. "the two free
 *     halves of the rank tracker — `a` and `b`, which both run on any account" is an enumeration
 *     under an adjective; "The refusal is free — `research_keywords` charges…" is one tool being
 *     predicated about, after a claim that is already the sentence's own predicate.
 *
 * Both discriminators are structural, and each is pinned red AND green in the spec next door. The
 * shape deliberately left unbound is a SINGLE tool after an unclosed delimiter — "the free tier —
 * `research_keywords` is excluded" — which reads as a remark far more often than as a one-item list,
 * and which the conservative direction of this file (see `findPriceClaimViolations`) forfeits on
 * purpose. That, too, is pinned, so the forfeit is visible rather than discovered.
 */
function bindForward(clause: string, claimEnd: number): string[] {
  const after = clause.slice(claimEnd);
  const match = after.match(
    new RegExp(`^((?:\\s+[A-Za-z']+){0,6})\\s*([(—–])\\s*((?:${MARK}[a-z_]+${MARK}|and|or|,|\\s)+)`),
  );
  if (match === null) return [];
  const [whole, headNoun, opener, list] = match;
  if (headNoun === undefined || opener === undefined || list === undefined) return [];
  const tools = (list.match(new RegExp(`${MARK}[a-z_]+${MARK}`, "g")) ?? []).map((token) =>
    token.slice(MARK.length, -MARK.length),
  );
  const closed = listIsClosed(opener, after.slice(whole.length));
  const enumerated = new Set(tools).size >= 2 && headNoun.trim() !== "";
  return closed || enumerated ? tools : [];
}

/**
 * Did the delimited run END, or did the sentence carry on past it?
 *
 * `rest` is what follows the run, which has already eaten every space, comma, "and" and "or" it
 * could — so anything left is either the enumeration's closer or a word, and a word means prose.
 * A `(` closes with its `)`. A dash has no partner, so it closes at the end of the clause, at the
 * clause's own punctuation, or at a second dash bracketing the aside.
 *
 * This is only the FIRST of the binder's two tests. A list whose closer is separated from it by a
 * relative clause — "the two free halves — `a` and `b`, which both run on any account" — fails here
 * and is caught by the enumeration test instead; `bindForward`'s header has both.
 */
function listIsClosed(opener: string, rest: string): boolean {
  if (opener === "(") return rest.startsWith(")");
  return rest === "" || /^[.;:!?—–]/.test(rest);
}

/** One page's claim that a named, non-free tool costs nothing. */
export interface PriceClaimViolation {
  /** The tool the claim was bound to. */
  readonly tool: string;
  /** What the signed table charges for it. */
  readonly cost: number;
  /** The words that made the claim ("free", "costs nothing", …). */
  readonly claim: string;
  /** The clause it was made in, for the failure message. */
  readonly clause: string;
}

/**
 * Every free-claim in `text` that is bound to a tool the price table charges for.
 *
 * CONSERVATIVE BY CONSTRUCTION. A claim that binds to no tool is not reported. That is a choice
 * about which way to fail: this guard is meant to survive, and the way a guard dies is by
 * reddening a sentence that was true, once, in front of someone in a hurry. It will therefore miss
 * a claim phrased far from its subject — and it still catches both measured defects, which is the
 * bar it was built to.
 */
export function findPriceClaimViolations(text: string): PriceClaimViolation[] {
  const violations: PriceClaimViolation[] = [];
  for (const clause of toClauses(markToolReferences(text))) {
    for (const pattern of FREE_CLAIM_PATTERNS) {
      for (const match of clause.matchAll(pattern)) {
        const start = match.index ?? 0;
        const bound = [
          ...bindBackward(clause, start),
          ...bindForward(clause, start + match[0].length),
        ];
        for (const tool of new Set(bound)) {
          const cost = TOOL_COSTS[tool as PricedTool];
          if (cost !== 0) {
            violations.push({
              tool,
              cost,
              claim: match[0],
              clause: clause.replace(new RegExp(MARK, "g"), "`"),
            });
          }
        }
      }
    }
  }
  return violations;
}

/** A one-line failure message naming the tool, its real price, and the sentence to fix. */
export function describeViolation(source: string, violation: PriceClaimViolation): string {
  return (
    `${source}: calls \`${violation.tool}\` "${violation.claim}", but it costs ` +
    `${violation.cost} credits. Being ungated is not the same as being free.\n    ${violation.clause}`
  );
}
