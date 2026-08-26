import { foldBrandWord } from "./brand.ts";

/**
 * FUNCTION WORDS — the words a page cannot be repaired by adding.
 *
 * Measured on dentnotion.com 2026-08-25: of 50 rows in a paid `audit_content` report, THIRTEEN
 * said nothing but `missing "daha", "iyi"` ("more", "good"). Others said `missing "mı"` (the
 * Turkish question particle), `missing "yoksa"`, `missing "hangi"`. "Put the word 'mı' in your
 * title" is not an action anybody takes, and thirteen rows of it are thirteen rows of a report
 * the customer paid twelve credits for.
 *
 * THIS FILTERS FINDINGS, NOT WORDS — the distinction is the whole design and the trap it avoids
 * is real. Removing these words from EVERY row would delete meaning from rows that have it:
 * `iyi` carries nothing in `daha iyi` ("better") but everything in `en iyi diş hekimi` ("best
 * dentist"), which is a commercial query whose page really should say so. So a word is never
 * struck from a row: a ROW is dropped when its missing words are ALL function words, and kept
 * INTACT — every word still printed — the moment one of them carries content. The two rules
 * disagree on exactly the case that matters, and only one of them can be wrong quietly.
 *
 * SHORT AND DEFENDED BY CATEGORY, deliberately. A long vocabulary is a liability here for the
 * same reason `CONTENT_STOPWORDS` states: every entry is a finding somebody stops receiving. The
 * four categories below are closed word classes plus one evaluative class, and nothing in them
 * can be the SUBJECT of a query — which is the only test that matters, because the finding this
 * gate suppresses is always of the form "your page never says X".
 *
 * OVERLAP WITH `CONTENT_STOPWORDS` IS DELIBERATE. That list decides which words are worth
 * MATCHING and runs inside the engine; this one decides which FINDINGS are worth printing. They
 * answer different questions on different sides of the analysis, and a list that quietly depended
 * on the engine's staying as it is would break silently the day the engine's shrank.
 */

/**
 * Interrogatives and question particles. A question word is the SHAPE of the query, never its
 * subject: nothing is repaired by putting "hangi" or "how" in a title.
 */
const INTERROGATIVES: readonly string[] = [
  "how", "what", "which", "who", "whom", "when", "where", "why",
  "nasıl", "ne", "hangi", "kim", "neden", "niçin", "nerede", "nereden", "kaç",
  // The Turkish question particle in all four vowel-harmony forms. They fold to two.
  "mı", "mi", "mu", "mü",
];

/**
 * Degree and evaluation. These modify a subject rather than being one — and this is the category
 * the FINDINGS-not-WORDS rule protects, because `iyi` and `best` are meaningful the moment they
 * sit beside a noun the page must actually carry.
 */
const DEGREE_WORDS: readonly string[] = [
  "best", "better", "good", "bad", "top", "more", "most", "very",
  "en", "daha", "çok", "iyi", "kötü",
];

/** Conjunctions, prepositions, postpositions, articles and the comparison marker. Closed class. */
const CONNECTIVES: readonly string[] = [
  "the", "a", "an", "and", "or", "of", "in", "on", "for", "to", "with", "at", "by", "from", "vs",
  "ve", "veya", "ile", "için", "gibi", "ya", "yoksa", "ama", "bir",
];

/**
 * Copulas, demonstratives, possessives and the implicit-location marker. "near me" is a signal
 * Google resolves from the searcher's location; it is not page copy, and a row that asks for it
 * is asking the customer to write a sentence no page has.
 */
const DEICTICS: readonly string[] = [
  "is", "are", "was", "were", "be", "do", "does", "did",
  "this", "that", "my", "your", "you", "me", "near",
  "bu", "şu", "her", "var", "yok",
];

/** The whole list, in one place so a test can pin it — it is a product decision, not a detail. */
export const FUNCTION_WORDS: readonly string[] = [
  ...INTERROGATIVES,
  ...DEGREE_WORDS,
  ...CONNECTIVES,
  ...DEICTICS,
];

/**
 * The set, folded through `foldBrandWord` — the SAME fold every other surface uses.
 *
 * Folding the list at load rather than typing folded spellings is what keeps this readable and
 * correct at once: "mı" and "mü" are written as Turkish writes them and collapse to "mi"/"mu"
 * here, while the words arriving from the engine (already half-folded: `ş`→`s` but `ı` intact)
 * go through the same function and land on the same key. One fold, both sides — brand.ts's rule,
 * and two folds that disagree would show up only as a filter that silently stops filtering.
 */
const FUNCTION_WORD_SET: ReadonlySet<string> = new Set(FUNCTION_WORDS.map(foldBrandWord));

/** Is this one word a function word, whatever spelling or fold state it arrives in? */
export function isFunctionWord(word: string): boolean {
  return FUNCTION_WORD_SET.has(foldBrandWord(word));
}

/**
 * Has this finding nothing left to say — every one of its missing words a function word?
 *
 * An EMPTY list is not "all function words": there is no such finding (a mismatch carries at
 * least one missing word), and answering true for it would make this gate delete rows on the
 * strength of a shape it never sees.
 */
export function isAllFunctionWords(words: readonly string[]): boolean {
  return words.length > 0 && words.every(isFunctionWord);
}
