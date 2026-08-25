import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  buildDisavowTxt,
  createMockDisavowCandidatesPort,
  disabledDisavowCandidatesPort,
  DISAVOW_TXT_PROPOSAL_NOTICE,
  MAX_LINK_ROWS,
  MAX_NETWORK_ROWS,
  VENDOR_SPAM_SCORE_MAX,
  type CandidateSet,
  type DisavowCandidate,
  type DisavowCandidates,
  type DisavowCriteria,
  type ReferringNetworkRow,
} from "../dfs/disavow-candidates.ts";
import type { BacklinkDetailRow, VendorWindow } from "../dfs/backlink-details.ts";
import {
  DISAVOW_FILE_CAPTION,
  NO_SUBMISSION_NOTICE,
  VENDOR_JUDGEMENT_NOTE,
  formatDisavowCandidates,
  makeDisavowCandidatesTool,
  renderCandidateCaption,
  renderCandidateRow,
  renderNetworkRow,
} from "./disavow-candidates.ts";
import { projectNotFoundMessage, type LoadProjectFn, type ProjectRef } from "./project-target.ts";
import linksFixture from "../dfs/fixtures/backlinks-filtered-spam.json";
import scoresFixture from "../dfs/fixtures/backlinks-bulk-spam-score.json";
import networksFixture from "../dfs/fixtures/backlinks-referring-networks.json";

/**
 * Fast-lane (DB-less) proofs for disavow_candidates. The credit LEDGER behaviour (mock -> reserve
 * + commit at 40; disabled / DFS-error -> no charge) is proven against the real stack in
 * disavow-candidates.db.test.ts. Here we prove the three things this tool's surface is FOR:
 *
 *   1. THE HARD RULE — nothing is submitted anywhere, said in the output and pinned in the source;
 *   2. NEVER #7 — every score is a named vendor field, a vendor silence is words rather than 0,
 *      and no invented judgement word ("toxic", "risk", "penalty", "you should disavow") reaches
 *      the reader;
 *   3. the price controls — the schema's maxima are asserted AGAINST the port's caps, and the
 *      threshold is REQUIRED rather than defaulted, because a default cut-off would be SeoGrep's
 *      opinion about what counts as spam wearing a recommendation's clothes.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT: ProjectRef = { id: PROJECT_ID, domain: "example.com", archivedAt: null };

const loadProject: LoadProjectFn = async (userId, projectId) =>
  userId === CTX.userId && projectId === PROJECT_ID ? PROJECT : null;

const LINK: BacklinkDetailRow = {
  domain_from: "spamfarm.example",
  url_from: "https://spamfarm.example/links/1",
  url_to: "https://example.com/pricing",
  anchor: "cheap seo services",
  item_type: "anchor",
  dofollow: true,
  rank: 12,
  backlink_spam_score: 71,
  first_seen: "2024-02-11 08:12:04 +00:00",
  last_seen: "2026-08-02 03:55:41 +00:00",
  is_broken: false,
  url_to_status_code: 200,
};

const NETWORK: ReferringNetworkRow = {
  network_address: "185.220.101.0/24",
  backlinks: 1904,
  referring_domains: 212,
  referring_domains_nofollow: 4,
  referring_main_domains: 209,
  backlinks_spam_score: 76,
  first_seen: "2024-02-11 08:12:04 +00:00",
  lost_date: null,
};

const SCORED: DisavowCandidate = {
  domain: "spamfarm.example",
  spam_score: 84,
  window_link_count: 2,
  window_dofollow_link_count: 1,
  window_max_backlink_spam_score: 71,
  window_example_url_from: "https://spamfarm.example/links/1",
  window_example_url_to: "https://example.com/pricing",
};

/** The vendor declined to score this one. Its rendering is the sharpest edge in the whole file. */
const UNSCORED: DisavowCandidate = {
  domain: "quiet.example",
  spam_score: null,
  window_link_count: 1,
  window_dofollow_link_count: 1,
  window_max_backlink_spam_score: null,
  window_example_url_from: "https://quiet.example/a",
  window_example_url_to: "https://example.com/",
};

const CRITERIA: DisavowCriteria = {
  min_backlink_spam_score: 40,
  dofollow_only: false,
  candidate_cap: 200,
  link_window_ordered_by_vendor_field: "backlink_spam_score",
  candidates_ordered_by_vendor_field: "spam_score",
};

function window_<Row>(
  rows: readonly Row[],
  total: number | null,
  bounds: { offset: number; limit: number } = { offset: 0, limit: 100 },
): VendorWindow<Row> {
  return {
    window_offset: bounds.offset,
    window_limit: bounds.limit,
    window_row_count: rows.length,
    vendor_total_count: total,
    rows,
  };
}

function candidateSet(rows: readonly DisavowCandidate[], distinct = rows.length): CandidateSet {
  return {
    window_candidate_cap: CRITERIA.candidate_cap,
    window_candidate_count: rows.length,
    window_distinct_domain_count: distinct,
    rows,
  };
}

function result(
  links: VendorWindow<BacklinkDetailRow>,
  candidates: CandidateSet,
  networks: VendorWindow<ReferringNetworkRow>,
  criteria: DisavowCriteria = CRITERIA,
): DisavowCandidates {
  return {
    target: "example.com",
    criteria,
    links,
    candidates,
    referring_networks: networks,
    disavow_txt: buildDisavowTxt("example.com", criteria, candidates, links.window_row_count),
  };
}

const FULL = result(
  window_([LINK], 4291),
  candidateSet([SCORED, UNSCORED]),
  window_([NETWORK], 1877, { offset: 0, limit: 20 }),
);

const mockPort = () =>
  createMockDisavowCandidatesPort({
    backlinks: linksFixture,
    bulkSpamScore: scoresFixture,
    referringNetworks: networksFixture,
  });

/** One lookup through the mock port, formatted — the end-to-end text every honesty pin reads. */
async function formattedFixtureAnswer(overrides: Record<string, unknown> = {}): Promise<string> {
  const answer = await mockPort().fetchDisavowCandidates({
    target: "example.com",
    limit: 100,
    min_backlink_spam_score: 40,
    dofollow_only: false,
    network_limit: 20,
    ...overrides,
  });
  return formatDisavowCandidates(answer);
}

describe("THE HARD RULE — this tool proposes, and says so; it never submits", () => {
  /**
   * The refusal must appear TWICE and be asserted as two whole LINES, not with `toContain`.
   * Measured, not assumed: with `toContain` this spec stayed GREEN when the answer's own notice
   * was deleted, because the copy inside the file body satisfied the substring — the answer would
   * have lost its refusal and nothing would have said so (signed lesson 12). Whole lines, in both
   * places, is the assertion that actually bites.
   */
  it("prints the refusal as its own line, AND again inside the file it hands over", async () => {
    const lines = (await formattedFixtureAnswer()).split("\n");
    expect(NO_SUBMISSION_NOTICE).toBe(DISAVOW_TXT_PROPOSAL_NOTICE);
    // In the answer, on its own — not buried in a paragraph and not only in the file.
    expect(lines).toContain(NO_SUBMISSION_NOTICE);
    // ...and in the file the reader copies out, so the two cannot be separated.
    expect(lines).toContain(`# ${DISAVOW_TXT_PROPOSAL_NOTICE}`);
    expect(lines.filter((line) => line.includes(NO_SUBMISSION_NOTICE))).toHaveLength(2);
  });

  it("says whose job the upload is, and names Search Console as the place the HUMAN goes", async () => {
    const text = await formattedFixtureAnswer();
    expect(text).toContain(DISAVOW_FILE_CAPTION);
    expect(text).toMatch(/you upload it yourself in Google Search Console/i);
    expect(text).toMatch(/SeoGrep does not submit disavow files/i);
  });

  /**
   * THE NEGATIVE PIN, on the axis that matters: not "does the disclaimer appear" (it could appear
   * beside a sentence that contradicts it) but "does any sentence CLAIM an outward action".
   * Every phrasing below would be a lie about something the product must never do.
   */
  it("makes no claim that anything was sent, submitted, uploaded or applied", async () => {
    const text = await formattedFixtureAnswer();
    expect(text).not.toMatch(/\b(we|seogrep|this tool) (have |has )?(sent|submitted|uploaded|applied)\b/i);
    expect(text).not.toMatch(/\b(submitting|uploading) (it|this|the file)\b/i);
    expect(text).not.toMatch(/\bhas been (sent|submitted|uploaded)\b/i);
    expect(text).not.toMatch(/\bdisavowed\b/i);
    expect(text).not.toMatch(/\bapply (this|these|the) (file|candidates|disavow)/i);
  });

  /**
   * The SOURCE-level half. The rule is not a wording rule — it is that no submission path exists
   * on this surface at all, including a disabled or commented one. The port pins its own three
   * ways (transport URL prefix, endpoint-constant set, the file text); this scans the module that
   * sits above it, which is where an "apply" convenience would be added first.
   */
  it("this module's own source contains no submission path — no Google endpoint, no fetch", () => {
    const source = readFileSync(new URL("./disavow-candidates.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/googleapis\.com/i);
    expect(source).not.toMatch(/searchconsole|search-console/i);
    expect(source).not.toMatch(/webmasters/i);
    // No transport of any kind: this file formats text and calls a port, and nothing else.
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bXMLHttpRequest\b/);
    expect(source).not.toMatch(/\bhttps?:\/\/(?!api\.dataforseo\.com)/i);
    // ...and no TODO promising one later. A commented submission path is still a plan to submit.
    expect(source).not.toMatch(/TODO[^\n]*(submit|upload|apply)/i);
  });
});

describe("NEVER #7 — the vendor's three scores, under the vendor's three names", () => {
  it("names each field on the object it measures, and never merges them into one label", async () => {
    const text = await formattedFixtureAnswer();
    // per LINK, per DOMAIN, per NETWORK — three spellings, three measurements.
    expect(text).toContain("backlink_spam_score 71");
    expect(text).toContain("spam_score 84");
    expect(text).toContain("backlinks_spam_score 76");
    expect(text).toContain(VENDOR_JUDGEMENT_NOTE);
    expect(text).toMatch(/three different measurements on three different objects/i);
  });

  /**
   * A composite score is the one thing this tool must not produce: "candidate for disavow" is a
   * judgement about someone else's site, and SeoGrep does not make one. Nothing here may read as
   * SeoGrep's own verdict, as a prediction about Google, or as an instruction.
   */
  it("invents no verdict word, no risk level, and no recommendation", async () => {
    const text = await formattedFixtureAnswer();
    expect(text).not.toMatch(/\btoxic/i);
    expect(text).not.toMatch(/\brisk (score|level)\b/i);
    expect(text).not.toMatch(/\bpenalt(y|ies|ise|ize)/i);
    expect(text).not.toMatch(/\bharmful\b/i);
    expect(text).not.toMatch(/\bbad link/i);
    expect(text).not.toMatch(/(low|high|poor) quality/i);
    expect(text).not.toMatch(/(should|recommend|we suggest|consider) disavow/i);
    expect(text).not.toMatch(/\bseogrep (score|rating|verdict)\b/i);
    expect(text).not.toMatch(/\bhurting your (site|rankings)\b/i);
    // ...and it says out loud what "candidate" is limited to.
    expect(text).toMatch(/met the threshold you set/i);
    expect(text).toMatch(/not a finding that these links hurt your site/i);
  });

  /**
   * THE VENDOR SILENCE, in the place it costs most. A domain DataForSEO returned no score for is
   * rendered in WORDS. Printed as 0 it would read "the vendor scored this domain clean" — from a
   * response that said nothing — and 0 sorts like a good number while null sorts last (signed
   * lesson 12; the port's compareCandidates pins the ordering half).
   */
  it("prints an unscored domain as unreported, never as 0", () => {
    const row = renderCandidateRow(UNSCORED);
    expect(row).toContain("spam_score not reported by DataForSEO");
    expect(row).not.toMatch(/spam_score 0\b/);
    expect(row).toContain("backlink_spam_score not reported by DataForSEO in this window");
  });

  /** A vendor ZERO is the vendor's own answer and prints as 0 — the other half of the same rule. */
  it("prints a vendor zero as zero — that is an answer, not a silence", () => {
    const row = renderCandidateRow({ ...UNSCORED, spam_score: 0, window_max_backlink_spam_score: 0 });
    expect(row).toContain("spam_score 0");
    expect(row).not.toMatch(/spam_score not reported/);
  });

  /**
   * THE DEFECT THIS ROW WAS ALREADY IMMUNE TO, pinned so it stays that way. A domain the vendor
   * scored 0 whose worst LINK the vendor scored 60 must show BOTH, each under its own vendor field
   * name — the 0 alone reads as "clean" beside a domain the tool is proposing you disavow
   * (measured 2026-08-25, tool review card 27; the FILE half is pinned in the port's spec).
   */
  it("shows the per-domain 0 and the per-link 60 together, and blends them into nothing", () => {
    const row = renderCandidateRow({
      ...SCORED,
      spam_score: 0,
      window_max_backlink_spam_score: 60,
    });
    expect(row).toMatch(/(?<!backlink_)\bspam_score 0\b/);
    expect(row).toMatch(/worst backlink_spam_score 60 in this window/);
    // No composite: the mean of the two would be 30, and no third number is invented.
    expect(row).not.toMatch(/\b30\b/);
  });

  /** Same rule on the network axis, whose fixture row carries nothing but an address. */
  it("prints a network the vendor said nothing about without inventing zeros", () => {
    const row = renderNetworkRow({
      network_address: "203.0.113.0/24",
      backlinks: null,
      referring_domains: null,
      referring_domains_nofollow: null,
      referring_main_domains: null,
      backlinks_spam_score: null,
      first_seen: null,
      lost_date: null,
    });
    expect(row).toContain("n/a backlinks · n/a referring domains (n/a nofollow)");
    expect(row).toContain("backlinks_spam_score not reported by DataForSEO");
    expect(row).not.toMatch(/\b0 backlinks\b/);
    expect(row).not.toMatch(/backlinks_spam_score 0\b/);
  });
});

describe("the output makes clear it is a PROPOSAL over a WINDOW", () => {
  it("echoes the caller's threshold and says it is theirs, not a recommendation", async () => {
    const text = await formattedFixtureAnswer();
    expect(text).toContain("backlink_spam_score >= 40");
    expect(text).toMatch(/a threshold you chose, not one DataForSEO or SeoGrep recommends/i);
  });

  it("echoes a threshold of 0 as the caller's own choice, not as an absence", async () => {
    const text = await formattedFixtureAnswer({ min_backlink_spam_score: 0 });
    expect(text).toContain("backlink_spam_score >= 0");
  });

  it("says whether the dofollow filter was on, in both directions", async () => {
    expect(await formattedFixtureAnswer()).toMatch(/followed and nofollowed links were both kept/i);
    expect(await formattedFixtureAnswer({ dofollow_only: true })).toMatch(
      /only links DataForSEO marks dofollow were kept/i,
    );
  });

  /**
   * The link window and the network window are VENDOR windows and carry the shared caption (the
   * "slice of that set, not a count of it" sentence imported from backlink_details). How many rows
   * were examined, under which bounds, is exactly what a reader needs to judge a proposal.
   */
  it("captions both vendor windows with their own bounds and the vendor's whole-set count", async () => {
    const text = await formattedFixtureAnswer();
    expect(text).toContain("Filtered backlinks — 4 backlinks in this window (offset 0, limit 100)");
    expect(text).toContain("DataForSEO counts 4,291 backlinks for this target in total");
    expect(text).toContain("Referring networks (IP subnets) — 3 networks in this window (offset 0, limit 20)");
    expect(text).toContain("DataForSEO counts 1,877 networks for this target in total");
    expect(text).toContain("this window is a slice of that set, not a count of it");
    expect(text).not.toMatch(/\b4 of 4,291\b/);
  });

  /**
   * The candidate set is DERIVED, not fetched, so it must carry NO vendor-total-sounding number.
   * A "DataForSEO counts N referring domains in total" line beside it would attribute a whole-set
   * measurement to the vendor that no request in this lookup ever made.
   */
  it("captions the derived candidate list as a count of the window, with the cap named", () => {
    const caption = renderCandidateCaption(candidateSet([SCORED, UNSCORED]), 4);
    expect(caption).toContain("Candidate referring domains — 2 domains, derived from the 4 link rows");
    expect(caption).toContain("cap 200");
    expect(caption).toContain("not of every domain linking to this site");
    expect(caption).not.toMatch(/DataForSEO counts/);
    expect(caption).not.toMatch(/in total/);
  });

  /** When the cap trimmed the list, the caption says so rather than presenting 200 as "all". */
  it("says when the cap trimmed the list, and by which vendor field it kept them", () => {
    const caption = renderCandidateCaption(candidateSet([SCORED, UNSCORED], 57), 100);
    expect(caption).toContain("The window named 57 distinct domains and the cap kept the 2 with the highest spam_score");
  });

  it("does not claim a trim when nothing was trimmed", () => {
    expect(renderCandidateCaption(candidateSet([SCORED, UNSCORED]), 4)).not.toMatch(/the cap kept/);
  });

  /**
   * The candidate list and the link window are ordered by DIFFERENT vendor fields on DIFFERENT
   * endpoints, and the port echoes both under different names. Flattening that into one sentence
   * would tell the reader a single number ranked everything.
   */
  it("names BOTH ordering fields separately, on their own endpoints", async () => {
    const text = await formattedFixtureAnswer();
    expect(text).toMatch(/filtered this site's LIVE backlinks on its own backlink_spam_score/);
    expect(text).toMatch(/scored by DataForSEO's bulk_spam_score endpoint/);
    expect(text).toMatch(/ordered by that separate field, spam_score, highest first/);
  });

  /** The whole point of the lookup, end to end over the port's three fixtures. */
  it("renders the vendor's own fixtures into a file whose lines are domain: entries", async () => {
    const text = await formattedFixtureAnswer();
    expect(text).toContain("domain:SpamFarm.example");
    expect(text).toContain("domain:linkring.example");
    expect(text).toContain("domain:quiet.example");
    // The unscored domain's line is a comment in WORDS, not a fabricated 0 — at BOTH levels,
    // because quiet.example carries neither a per-domain score nor a per-link one.
    expect(text).toMatch(/# per-domain spam_score: not reported by the vendor/);
    expect(text).toMatch(
      /worst per-link backlink_spam_score in this window: not reported by the vendor\ndomain:quiet\.example/,
    );
    expect(text).not.toMatch(/# per-domain spam_score: 0\b/);
    // No bare URL entries: this tool answers at the domain level and claims nothing about a page.
    expect(text).not.toMatch(/^https?:\/\/\S+$/m);
  });

  it("names the resolved PROJECT in the heading when the target came from one", () => {
    expect(formatDisavowCandidates(FULL, PROJECT)).toContain(
      'Disavow candidates for your project "example.com"',
    );
    expect(formatDisavowCandidates(FULL)).not.toContain("your project");
  });

  /**
   * The empty answer is a DELIVERED result (and is charged), so it must still say what was asked
   * and refuse the reading "this site has no such links" — which is what a bare "none found" over
   * a 100-row window at a threshold of 90 would mean to a reader.
   */
  it("says plainly when nothing matched, and names the window AND the threshold it asked for", () => {
    const empty = result(window_([], 4291), candidateSet([]), window_([], null, { offset: 0, limit: 20 }), {
      ...CRITERIA,
      min_backlink_spam_score: 90,
    });
    const text = formatDisavowCandidates(empty);
    expect(text).toContain('No disavow candidates for "example.com"');
    expect(text).toContain("backlink_spam_score >= 90");
    expect(text).toContain("(offset 0, limit 100)");
    expect(text).toMatch(/not a statement that the site has no such links/i);
    // Even the empty answer carries the refusal, on its own line — the claim that is never dropped.
    expect(text.split("\n")).toContain(NO_SUBMISSION_NOTICE);
    expect(text).not.toContain("domain:");
  });
});

describe("disavow_candidates tool metadata", () => {
  const tool = makeDisavowCandidatesTool();

  it("advertises its name, the 40-credit cost, and a snake_case input schema", () => {
    expect(tool.name).toBe("disavow_candidates");
    expect(tool.description).toContain("Costs 40 credits.");
    const schema = tool.inputJsonSchema as {
      required?: string[];
      properties: Record<string, { format?: string }>;
    };
    expect(Object.keys(schema.properties).sort()).toEqual([
      "dofollow_only",
      "limit",
      "min_backlink_spam_score",
      "network_limit",
      "project_id",
      "target",
    ]);
    expect(schema.properties.project_id?.format).toBe("uuid");
  });

  /**
   * THE THRESHOLD DECISION, pinned in the only way that can hold: `min_backlink_spam_score` is
   * REQUIRED and carries NO default. Part A shipped no default in the port on purpose — choosing
   * what counts as spam is an opinion, and the port refused to hide one — and this surface makes
   * the same refusal visible: DataForSEO publishes the 0-100 score and no cut-off, so a default
   * here would be a number SeoGrep invented arriving with a product default's authority
   * (NEVER #7 and #9). The caller states their own cut-off, and the output repeats it.
   */
  it("REQUIRES the spam-score threshold and supplies no default of its own", () => {
    const schema = tool.inputJsonSchema as {
      required?: string[];
      properties: Record<string, { default?: unknown; minimum?: number; maximum?: number; description?: string }>;
    };
    expect(schema.required ?? []).toEqual(["min_backlink_spam_score"]);
    expect(schema.properties.min_backlink_spam_score).not.toHaveProperty("default");
    expect(schema.properties.min_backlink_spam_score?.minimum).toBe(0);
    expect(schema.properties.min_backlink_spam_score?.maximum).toBe(VENDOR_SPAM_SCORE_MAX);
    // ...and the field says whose judgement it is, so a caller does not read the range as advice.
    expect(schema.properties.min_backlink_spam_score?.description).toMatch(/YOUR judgement/);
    expect(schema.properties.min_backlink_spam_score?.description).toMatch(/no threshold/i);
  });

  it("rejects a call that omits the threshold, before any handler work", async () => {
    const result_ = await tool.run(CTX, { target: "example.com" });
    expect(result_.isError).toBe(true);
    expect(result_.content[0]?.text).toMatch(/invalid input/i);
    expect(result_.content[0]?.text).toMatch(/min_backlink_spam_score/);
  });

  it("rejects a threshold outside the vendor's own 0-100 scale", async () => {
    for (const value of [-1, 101, 40.5]) {
      const rejected = await tool.run(CTX, { target: "example.com", min_backlink_spam_score: value });
      expect(rejected.isError, `${value} should be rejected`).toBe(true);
      expect(rejected.content[0]?.text).toMatch(/invalid input/i);
    }
  });

  /**
   * THE ROW CAPS ARE THE PRICE — and on this tool the signature says so out loud. The 2026-08-17
   * package signed 40 credits with the worst-case margin at 2.8x, BELOW the band, and wrote its
   * own remedy: "Çözüm fiyat değil kapak … `limit`'in 1000'e çıkmasına izin verilmez." So the
   * schema's maxima are asserted AGAINST the port's constants rather than restated: a surface that
   * accepted more than the port clamps to would advertise a window the price was never signed for
   * (NEVER #6), and 1,000 is the exact number the signature forbids.
   */
  it("caps both row counts at exactly the port's caps, and never at the vendor's 1,000", () => {
    const schema = tool.inputJsonSchema as {
      properties: Record<string, { default?: number; maximum?: number; minimum?: number }>;
    };
    expect(schema.properties.limit?.minimum).toBe(1);
    expect(schema.properties.limit?.maximum).toBe(MAX_LINK_ROWS);
    expect(schema.properties.limit?.default).toBe(100);
    expect(schema.properties.network_limit?.minimum).toBe(1);
    expect(schema.properties.network_limit?.maximum).toBe(MAX_NETWORK_ROWS);
    expect(schema.properties.network_limit?.default).toBe(20);
    expect(schema.properties.limit?.maximum).toBeLessThan(1000);
    expect(schema.properties.network_limit?.maximum).toBeLessThan(1000);
    // The pair the margin arithmetic rests on, asserted as a SUM so widening either alone is red.
    expect((schema.properties.limit?.maximum ?? 0) + (schema.properties.network_limit?.maximum ?? 0)).toBe(
      350,
    );
  });

  it("rejects a row count past either cap before any handler work", async () => {
    const links = await tool.run(CTX, { target: "example.com", min_backlink_spam_score: 40, limit: 1000 });
    expect(links.isError).toBe(true);
    expect(links.content[0]?.text).toMatch(/invalid input/i);

    const networks = await tool.run(CTX, {
      target: "example.com",
      min_backlink_spam_score: 40,
      network_limit: 200,
    });
    expect(networks.isError).toBe(true);
    expect(networks.content[0]?.text).toMatch(/invalid input/i);
  });

  it("says it needs a paid balance, promises the free refusal, and calls itself a proposal", () => {
    expect(tool.description).toMatch(/paid credit balance/i);
    expect(tool.description).toMatch(/charges nothing/i);
    expect(tool.description).toMatch(/does not submit disavow files/i);
  });
});

describe("disavow_candidates free pre-reserve gates (no credit machinery)", () => {
  const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"] as const;
  let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const serving = () => makeDisavowCandidatesTool({ port: mockPort(), loadProject });
  const ASKED = { target: "example.com", min_backlink_spam_score: 40 } as const;

  it("rejects a non-public target without reaching the ledger", async () => {
    const rejected = await serving().run(CTX, { ...ASKED, target: "not a domain" });
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0]?.text).toMatch(/not a valid domain/i);
  });

  it("rejects a reserved/internal target exactly as every other domain tool does", async () => {
    const rejected = await serving().run(CTX, { ...ASKED, target: "intranet.local" });
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0]?.text).toMatch(/not a public domain/i);
  });

  it("rejects a call naming NEITHER project_id nor target, without reaching the ledger", async () => {
    const rejected = await serving().run(CTX, { min_backlink_spam_score: 40 });
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0]?.text).toMatch(/Nothing to look up/i);
  });

  it("rejects a call naming BOTH, without reaching the ledger", async () => {
    const rejected = await serving().run(CTX, { ...ASKED, project_id: PROJECT_ID });
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0]?.text).toMatch(/not both/i);
  });

  it("answers another tenant's project id exactly as it answers an unknown uuid — free", async () => {
    const theirs = await serving().run(CTX, {
      project_id: OTHER_PROJECT_ID,
      min_backlink_spam_score: 40,
    });
    expect(theirs.isError).toBe(true);
    expect(theirs.content[0]?.text).toBe(projectNotFoundMessage(OTHER_PROJECT_ID));
  });

  it("returns a clear English 'not enabled' error and never reaches the ledger", async () => {
    const tool = makeDisavowCandidatesTool({ port: disabledDisavowCandidatesPort(), loadProject });
    const refused = await tool.run(CTX, ASKED);
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toMatch(/not yet enabled/i);
    expect(refused.content[0]?.text).toMatch(/not charged/i);
    // ...and it never leaks the fixture rows it could have served instead (NEVER #7).
    expect(refused.content[0]?.text).not.toMatch(/spamfarm/i);
    expect(refused.content[0]?.text).not.toContain("domain:");
  });

  it("the ENABLED path DOES enter the credit guard (reaches the DB, which is absent here)", async () => {
    await expect(serving().run(CTX, ASKED)).rejects.toThrow(/SUPABASE/i);
  });

  it("a RESOLVED project_id also reaches the credit guard — the gates are not a dead end", async () => {
    await expect(
      serving().run(CTX, { project_id: PROJECT_ID, min_backlink_spam_score: 40 }),
    ).rejects.toThrow(/SUPABASE/i);
  });
});
