import { CREDIT_UNITS, TOOL_COSTS } from "../../mcp/src/credits/costs";

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
 * AND THE SAME SENTENCE APPLIES TO THIS FILE'S FIRST VERSION. It guarded the QUALITATIVE claim and
 * left the WRONG-NUMBER claim to `stripCostSentences` and the derived `**Cost:**` line — a handover
 * that was never measured. It was measured on 2026-08-26, by a fresh judge, and it does not hold:
 * two lines apart on the same generated page,
 *
 *     6:**Cost:** 15 credits.                     ← derived from TOOL_COSTS, correct
 *     8:… Each run of `audit_tech` costs 5 credits. ← prose, false, and CUSTOMER-FACING
 *
 * `gen-tool-docs --check` exited 0 and apps/web's whole vitest suite passed. `stripCostSentences`
 * only ever touched a tool DESCRIPTION, the derived line only ever states its own number, and
 * `--check` has no credit-number check at all — so nothing in the pipeline ever compares a number a
 * HUMAN typed against the table. Four more probes on four more tools were green the same way, on the
 * base commit as well, which makes this not a regression but a hole that was always open.
 *
 * "free" is the `cost = 0` special case of that hole. The general case is worse, because a wrong
 * non-zero number is the shape a reader BELIEVES: it looks derived. {@link findCreditAmountViolations}
 * closes it, against the same single source of truth — TOOL_COSTS, plus CREDIT_UNITS for the two
 * per-unit prices, and no second table anywhere.
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

/* ------------------------------------------------------------------------------------------------
 * THE NUMERIC LANE — a number a human typed, checked against the number the operator signed.
 * ---------------------------------------------------------------------------------------------- */

/**
 * EVERY credit figure a truthful sentence about `tool` may name.
 *
 * TOOL_COSTS is the only source, and CREDIT_UNITS is the only thing that turns one entry into more
 * than one legitimate number. No price is written here; every member of the returned set is
 * ARITHMETIC over the signed tables, which is what makes an edited price fail in costs.test.ts
 * before it can ever make a docs page green.
 *
 * A per-call tool has exactly one truthful figure. A PER-UNIT tool has a whole family of them, and
 * refusing to model that would make this guard a false-positive machine on its first sentence:
 * `serp_snapshot` is signed at 5 credits per call PLUS 8 per keyword over 1-10 keywords, so 5, 8,
 * 13, 21 … 85 are all true statements about the same signed price, and its own description says
 * three of them in one sentence. `ai_visibility_compare` is 90 per compared target over 2-10, so 90
 * and 180 … 900 are all true. The set is therefore:
 *
 *   • the TOOL_COSTS figure (the per-call price, or the per-UNIT price for a per-unit tool);
 *   • the rule's `base`, when it has one — the fixed part of a call, which is a signed price of its
 *     own (costs.ts says so in as many words) and is quoted on its own in the wild;
 *   • every call total the rule can produce, `base + unit x n` for n in min_units..max_units.
 *
 * WHAT THIS BUYS AND WHAT IT FORFEITS, named rather than discovered. It catches every figure that is
 * not a number of this price at all — the whole class the judge probed. It does NOT check that a
 * true figure plays the right ROLE in its sentence: "`serp_snapshot` costs 5 credits per keyword"
 * names a real part of the price (the base) in the wrong place, and this guard passes it. Pinning
 * roles would mean parsing "per <unit>" against the rule's unit noun, which is a second, larger
 * guess about English; the two per-unit tools are pinned red on out-of-family numbers and green on
 * every in-family one instead, so the boundary is measured rather than assumed.
 */
export function legitimateCreditAmounts(tool: PricedTool): ReadonlySet<number> {
  const unitOrFlat = TOOL_COSTS[tool];
  const rule: { base?: number; min_units: number; max_units: number } | undefined =
    tool in CREDIT_UNITS ? CREDIT_UNITS[tool as keyof typeof CREDIT_UNITS] : undefined;
  if (rule === undefined) return new Set([unitOrFlat]);
  const base = rule.base ?? 0;
  const amounts = new Set<number>([unitOrFlat]);
  if (base > 0) amounts.add(base);
  for (let units = rule.min_units; units <= rule.max_units; units += 1) {
    amounts.add(base + unitOrFlat * units);
  }
  return amounts;
}

/**
 * Spelled-out counts a price sentence realistically uses. Deliberately stops at ten: past that,
 * prices in this corpus are written in digits, and every word added here is a word that could
 * collide with ordinary prose. "eleven credits" is NOT covered, and that is stated rather than
 * hoped — see the coverage note on {@link findCreditAmountViolations}.
 */
const SPELLED_AMOUNTS: ReadonlyMap<string, number> = new Map([
  ["zero", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
]);

/**
 * A credit figure, in the forms this corpus writes one: `15 credits`, `1 credit`, `one credit`,
 * `15-credit`, `1,000 credits`, and the same inside bold or backticks (stripped before this runs).
 *
 * THE THOUSANDS GROUP IS THE FIRST ALTERNATIVE, AND THE LOOKBEHIND GUARDS IT. A naive digit run on
 * "1,000 credits" matches `000 credits` — a claim of ZERO credits, invented by the regex itself,
 * out of a sentence that said nothing of the kind. Refusing to match it at all was the first fix,
 * and it was worse than it looked: "`audit_tech` costs 1,000 credits" is a wrong figure on a
 * 15-credit tool, and a guard that declines to read the number cannot say so. So four-figure
 * prices are READ (1,000 → 1000) rather than skipped, and the lookbehind keeps the naive
 * mid-number match from ever happening. Both halves are pinned in the spec by asserting the
 * AMOUNT is 1000 — the only assertion that fails both ways this can break.
 */
const CREDIT_AMOUNT_PATTERN =
  /(?<![\d.,$])\b(\d{1,3}(?:,\d{3})+|\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b[ \t -]+credits?\b/gi;

function readAmount(token: string): number | undefined {
  const spelled = SPELLED_AMOUNTS.get(token.toLowerCase());
  if (spelled !== undefined) return spelled;
  const digits = Number.parseInt(token.replace(/,/g, ""), 10);
  return Number.isInteger(digits) ? digits : undefined;
}

/**
 * Emphasis and code marks, removed AFTER tool marking so the sentinels are untouched.
 *
 * A number's markup is not part of its claim: "costs **15** credits", "costs `15 credits`" and
 * "costs 15 credits" are the same sentence to a reader and must be the same sentence here. Only
 * `*` and backticks are stripped — NOT `_`, which is inside every tool name this file works with.
 */
function stripEmphasis(text: string): string {
  return text.replace(/[*`]/g, "");
}

/**
 * A MARKDOWN TABLE CELL IS NOT A CLAUSE BOUNDARY HERE, and that was a deliberate reversal.
 *
 * The first version of this lane split every clause on `|` so a figure could not borrow a tool from
 * the cell next door. Two things were then measured. First, the split bought NOTHING: the whole
 * corpus — 38 DOC_PROSE blocks, every hand-written page, every generated page, 38 descriptions — is
 * byte-for-byte as green without it, because the cell before a figure is always a short noun
 * ("integer", "No", "string") and the backward walk stops at a noun anyway. Second, it COST
 * something real: a price table row — "| `crawl_site` | each run | 5 credits |" — is exactly where
 * a wrong figure would live, and the split made that row unbindable. A precision measure that
 * catches no false positive and drops a true one is a weakening with a good story attached, so the
 * numeric lane uses {@link toClauses} unchanged and the row above is pinned RED in the spec.
 */

/**
 * The filler of {@link BINDING_FILLER}, plus the verbs that state a price.
 *
 * "`find_quick_wins` costs 5 credits" and "Each run of `audit_tech` costs 5 credits" both put a
 * pricing verb between the tool and the figure, so without these words the backward walk stops
 * before it reaches the tool and the judge's probes stay green. Everything here ASSERTS A PRICE;
 * nothing here is a noun. That distinction is what keeps "this call costs 40 credits" — the
 * sentence three live pages use about a limit parameter — bound to nothing: the walk stops dead at
 * "call", because "call" is a noun the page supplied, not a tool it named. Adding one convenient
 * noun would redden three shipped pages, which is exactly how a guard gets deleted.
 */
const PRICE_BINDING_FILLER: ReadonlySet<string> = new Set([
  ...BINDING_FILLER,
  "costs", "cost", "charges", "charge", "charged", "bills", "bill", "billed",
  "price", "prices", "priced", "free",
  // The two articles, and they are the only nouns' company allowed through: a figure is routinely
  // written as "is a 5-credit run" or "Free (0 credits)", and an article carries no subject of its
  // own for the claim to attach to. Every noun stays out — that is the line "call" is on.
  "a", "an",
]);

/** Tools a figure is attributed to, and whether the walk ran out of clause before it stopped. */
interface AmountBinding {
  readonly tools: readonly string[];
  readonly reachedClauseStart: boolean;
}

/** Walks back from a figure over pricing verbs and connectives, collecting the tools it names. */
function bindAmountBackward(clause: string, claimStart: number): AmountBinding {
  const tools: string[] = [];
  for (const token of tokensBefore(clause.slice(0, claimStart))) {
    if (token.startsWith(MARK)) {
      tools.push(token.slice(MARK.length, -MARK.length));
      continue;
    }
    if (PRICE_BINDING_FILLER.has(token.toLowerCase())) continue;
    return { tools, reachedClauseStart: false };
  }
  return { tools, reachedClauseStart: true };
}

/** One text's claim that a named tool costs a number of credits the signed table does not say. */
export interface CreditAmountViolation {
  /** The tool the figure was attributed to. */
  readonly tool: string;
  /** The figure the text named. */
  readonly claimed: number;
  /** Every figure a truthful sentence about this tool could have named. */
  readonly allowed: readonly number[];
  /** The words that made the claim ("5 credits"). */
  readonly claim: string;
  /** Whether the tool was named in the clause, or supplied as the text's subject. */
  readonly boundBy: "named" | "subject";
  /** The clause it was made in, for the failure message. */
  readonly clause: string;
}

/**
 * Every credit figure in `text` that is attributed to a tool the signed table prices differently.
 *
 * TWO WAYS A FIGURE GETS A SUBJECT, and they are not equally permissive on purpose.
 *
 *  1. NAMED — the clause names the tool and the walk back from the figure crosses only pricing
 *     verbs and connectives. This is the only route for prose (DOC_PROSE, hand-written pages), and
 *     it is as conservative as the free-claim lane above it for the same reason: a figure that
 *     binds to nothing is not reported, because reddening a true sentence is how a guard dies.
 *
 *  2. SUBJECT — `subject` is given, and the clause names NO tool at all. Then the figure is the
 *     subject's own. This route exists for TOOL DESCRIPTIONS, where it is not a guess: a
 *     description is about exactly one tool, and its cost sentence — "Costs 15 credits." — never
 *     names it. That sentence is the judge's own example of what nothing measures: `audit_tech`'s
 *     `"Costs 15 credits."` exists only in source, and a typo in it reached the customer through
 *     `renderToolPage`'s frontmatter with every gate green. Without this route the whole
 *     description surface stays exactly as unguarded as it was.
 *
 *     It is STRICTER than route 1 — inside a description, an unbound figure is a violation rather
 *     than silence — and that strictness is scoped to descriptions alone, never to prose. The cost:
 *     a description that names a credit figure for some reason other than its own price will redden.
 *     That is the intended trade, not an oversight: a description is where the price claim lives,
 *     and the fix is one word — name the tool the figure belongs to, and route 1 takes over.
 *
 * FORMS COVERED: digits and words to ten; `credit` and `credits`; `15-credit`; bold, italic and
 * backticked figures (markup is stripped first); a figure inside a markdown table cell, including a
 * price-table row whose tool sits in an earlier cell (see the note on table cells above).
 *
 * FORMS NOT COVERED, named so the boundary is measured rather than assumed: a spelled count above
 * ten; a decimal figure ("2.5 credits" — no signed price has ever had one); a figure that PRECEDES
 * its tool ("5 credits for `audit_tech`" — there is no forward binder in this lane, only the
 * backward walk); a figure separated from its tool by ANY word the page supplied that is neither a
 * pricing verb nor a connective — a noun ("this call costs 40 credits") or an adverb ("Run
 * `crawl_site` first — it costs 20 credits", measured while writing the spec next door); a currency
 * figure, which is a vendor cost and not a price this table signs; and the ROLE a true figure plays
 * in a per-unit sentence (see {@link legitimateCreditAmounts}).
 */
export function findCreditAmountViolations(
  text: string,
  subject?: PricedTool,
): CreditAmountViolation[] {
  const violations: CreditAmountViolation[] = [];
  for (const clause of toClauses(stripEmphasis(markToolReferences(text)))) {
    for (const match of clause.matchAll(CREDIT_AMOUNT_PATTERN)) {
      const claimed = readAmount(match[1] ?? "");
      if (claimed === undefined) continue;
      const { tools } = bindAmountBackward(clause, match.index ?? 0);
      const named = [...new Set(tools)].filter((tool) => tool in TOOL_COSTS);
      const clauseNamesATool = new RegExp(`${MARK}[a-z_]+${MARK}`).test(clause);
      const bound: { tool: string; boundBy: "named" | "subject" }[] =
        named.length > 0
          ? named.map((tool) => ({ tool, boundBy: "named" as const }))
          : subject !== undefined && !clauseNamesATool
            ? [{ tool: subject, boundBy: "subject" as const }]
            : [];
      for (const { tool, boundBy } of bound) {
        const allowed = legitimateCreditAmounts(tool as PricedTool);
        if (allowed.has(claimed)) continue;
        violations.push({
          tool,
          claimed,
          allowed: [...allowed].sort((a, b) => a - b),
          claim: match[0],
          boundBy,
          clause: clause.replace(new RegExp(MARK, "g"), "`"),
        });
      }
    }
  }
  return violations;
}

/** A one-line failure message naming the tool, the wrong figure, the signed one, and the sentence. */
export function describeCreditAmountViolation(
  source: string,
  violation: CreditAmountViolation,
): string {
  const allowed =
    violation.allowed.length === 1
      ? `${violation.allowed[0]}`
      : `${violation.allowed[0]}, ${violation.allowed[1]} … ${violation.allowed[violation.allowed.length - 1]}`;
  const how =
    violation.boundBy === "subject" ? " (this text's own tool)" : "";
  return (
    `${source}: says \`${violation.tool}\`${how} costs "${violation.claim}", but the signed price ` +
    `table charges ${allowed} credits. A price is not a number you may type twice.\n    ${violation.clause}`
  );
}
