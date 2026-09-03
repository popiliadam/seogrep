import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  createMockBacklinkDetailsPort,
  disabledBacklinkDetailsPort,
  MAX_BACKLINK_DETAIL_ROWS,
  MAX_BACKLINKS_OFFSET,
  MAX_TARGET_PAGE_ROWS,
  type BacklinkDetailRow,
  type BacklinkDetails,
  type TargetPageRow,
  type VendorWindow,
} from "../dfs/backlink-details.ts";
import { REL_ATTRIBUTES_NOTE } from "../format/rel-attributes.ts";
import {
  EMPTY_LINK_WINDOW_NOTE,
  MAX_RENDERED_OUTPUT_CHARS,
  VENDOR_SPAM_SCORE_NOTE,
  formatBacklinkDetails,
  makeBacklinkDetailsTool,
  renderOutputLimitNote,
  renderWindowCaption,
} from "./backlink-details.ts";
import { projectNotFoundMessage, type LoadProjectFn, type ProjectRef } from "./project-target.ts";
import backlinksFixture from "../dfs/fixtures/backlinks-list.json";
import targetPagesFixture from "../dfs/fixtures/backlinks-domain-pages-summary.json";

/**
 * Fast-lane (DB-less) proofs for backlink_details. The credit LEDGER behaviour (mock -> reserve
 * + commit at 35; disabled / DFS-error -> no charge) is proven against the real stack in
 * backlink-details.db.test.ts. Here we prove: the pure formatter — whose ONE hard job is keeping
 * the fetched WINDOW and the vendor's WHOLE-SET total from being read as each other — the tool
 * metadata (including the row caps, which are a price control), and that every free pre-reserve
 * gate returns without touching credits.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT: ProjectRef = { id: PROJECT_ID, domain: "example.com", archivedAt: null };

const loadProject: LoadProjectFn = async (userId, projectId) =>
  userId === CTX.userId && projectId === PROJECT_ID ? PROJECT : null;

const LINK: BacklinkDetailRow = {
  domain_from: "www.opencart.com",
  url_from: "https://www.opencart.com/",
  url_to: "http://www.forbes.com/sites/brentgleeson/2014/09/05/launch/",
  anchor: "Forbes",
  item_type: "anchor",
  dofollow: true,
  attributes: null,
  rank: 862,
  backlink_spam_score: 0,
  first_seen: "2019-01-15 22:56:46 +00:00",
  last_seen: "2022-03-01 10:00:00 +00:00",
  is_broken: false,
  url_to_status_code: 200,
};

const PAGE: TargetPageRow = {
  url: "http://www.forbes.com/",
  backlinks: 1259787,
  referring_domains: 20369,
  referring_domains_nofollow: 4210,
  broken_backlinks: 0,
  rank: 452,
  backlinks_spam_score: 31,
  first_seen: "2019-01-15 22:56:46 +00:00",
  lost_date: null,
};

function window_<Row>(
  rows: readonly Row[],
  total: number | null,
  bounds: { offset: number; limit: number } = { offset: 0, limit: 50 },
): VendorWindow<Row> {
  return {
    window_offset: bounds.offset,
    window_limit: bounds.limit,
    window_row_count: rows.length,
    vendor_total_count: total,
    rows,
  };
}

function details(
  links: VendorWindow<BacklinkDetailRow>,
  pages: VendorWindow<TargetPageRow>,
): BacklinkDetails {
  return { target: "forbes.com", links, target_pages: pages };
}

const ONE_OF_EACH = details(window_([LINK], 42671699), window_([PAGE], 3813583, { offset: 0, limit: 20 }));

describe("renderWindowCaption — the window and the whole set are never the same sentence", () => {
  /**
   * THE CENTRAL CLAIM. The vendor's own published example answers 2 fetched rows against a
   * total_count of 42,671,699 — seven orders of magnitude apart. So the caption must say which
   * set each number counts, and must show the bounds the rows were fetched under, or a reader
   * cannot tell WHICH slice of 42 million they are holding.
   */
  it("names the set each count counts and prints the window's own bounds", () => {
    const caption = renderWindowCaption(
      "Individual backlinks",
      "backlink",
      window_([LINK, LINK], 42671699, { offset: 500, limit: 50 }),
    );
    expect(caption).toContain("2 backlinks in this window (offset 500, limit 50)");
    expect(caption).toContain("DataForSEO counts 42,671,699 backlinks for this target in total");
    expect(caption).toContain("this window is a slice of that set, not a count of it");
  });

  /**
   * THE NEGATIVE PIN, and it names the exact phrasing that would be wrong rather than gesturing
   * at "don't conflate". "N of M" is not a hypothetical: link_gap prints exactly that shape
   * ("2 of 42,671,699 domains") and it is CORRECT there, because that tool sends one request at
   * offset 0 and its rows really are the head of the set. Here they are not — at offset 500 the
   * rows are 501-502 — so the same phrasing would state a falsehood. This is the pin that stops
   * the sibling's wording being copied across by a future editor who assumes it transfers.
   */
  it("never joins the two counts with an 'of', the way a head-of-list caption would", () => {
    const caption = renderWindowCaption(
      "Individual backlinks",
      "backlink",
      window_([LINK, LINK], 42671699, { offset: 500, limit: 50 }),
    );
    expect(caption).not.toMatch(/\b2 of 42,671,699\b/);
    expect(caption).not.toMatch(/\bof 42,671,699 (backlinks|rows|shown|listed)/i);
    // ...and no phrasing that captions the PRINTED rows with the whole-set number either.
    expect(caption).not.toMatch(/42,671,699 backlinks (shown|listed|below|here)/i);
  });

  /**
   * A null total is the vendor DECLINING TO SAY. Rendering it as 0 would publish "this target has
   * no backlinks at all" from a response that said nothing of the kind, and back-filling it from
   * rows.length would publish "this target has exactly 2" from a window (signed lesson 12).
   */
  it("says the vendor did not say, rather than printing 0 or the row count", () => {
    const caption = renderWindowCaption("Individual backlinks", "backlink", window_([LINK, LINK], null));
    expect(caption).toContain("DataForSEO did not say how many backlinks exist for this target in total");
    expect(caption).not.toMatch(/counts 0 backlinks/);
    expect(caption).not.toMatch(/counts 2 backlinks/);
  });

  /**
   * CONTRACT CHANGED 2026-09-04 (finding BD-8, MEASURED on a paid call). The pin that stood here
   * asserted that an EMPTY window carrying `total_count: 0` printed "DataForSEO counts 0 backlinks
   * for this target in total" — and on 2026-09-03 a 35-credit lookup printed exactly that for
   * dentnotion.com at offset 19,000 while the SAME reply listed pages with 175, 18 and 17
   * backlinks and `analyze_backlinks` measured 242 backlinks / 139 referring domains for the same
   * subject. That pairing was measured ONCE (dentnotion, 2026-09-03); the vendor's docs define
   * `total_count` as the whole matching set and say nothing about offset, so the caption states the
   * two vendor facts and declines to reuse the figure as a whole-profile count rather than
   * explaining the 0 (signed lesson 16). The old assertion pinned the defect (signed lesson 11).
   *
   * What survives is the rule it was defending: a vendor zero is an ANSWER, never a silence. It is
   * still printed, still named as the vendor's own `total_count`, and still never rendered as
   * "did not say" — only the claim built on top of it is corrected.
   */
  it("does not turn an out-of-range window's total_count 0 into a whole-set count", () => {
    const caption = renderWindowCaption("Individual backlinks", "backlink", window_([], 0, { offset: 19_000, limit: 5 }));
    expect(caption).toContain("0 backlinks in this window (offset 19,000, limit 5)");
    expect(caption).toContain("reported total_count 0");
    expect(caption).toContain("not used here as the target's whole-profile count");
    expect(caption).not.toMatch(/counts 0 backlinks for this target in total/);
    expect(caption).not.toMatch(/did not say/);
  });

  /**
   * BOTH other sides of the fork, because the correction turns on TWO facts and dropping either
   * one silently widens it (signed lesson 14 — vary the axis, not just the value): a non-zero
   * total over an empty window, and a zero total over a window that DID carry rows.
   */
  it("keeps the whole-set sentence unless the window is empty AND the total is zero", () => {
    const emptyWindow = renderWindowCaption("Individual backlinks", "backlink", window_([], 242, { offset: 19_000, limit: 5 }));
    expect(emptyWindow).toContain("DataForSEO counts 242 backlinks for this target in total");
    expect(emptyWindow).toContain("this window is a slice of that set, not a count of it");
    const zeroTotalWithRows = renderWindowCaption("Individual backlinks", "backlink", window_([LINK], 0));
    expect(zeroTotalWithRows).toContain("DataForSEO counts 0 backlinks for this target in total");
    expect(zeroTotalWithRows).not.toMatch(/reported total_count 0/);
  });

  it("agrees with itself on singular and plural row counts", () => {
    expect(renderWindowCaption("Pages", "page", window_([PAGE], 5))).toContain("1 page in this window");
    expect(renderWindowCaption("Pages", "page", window_([PAGE, PAGE], 5))).toContain(
      "2 pages in this window",
    );
  });
});

describe("formatBacklinkDetails", () => {
  it("renders a header naming the site and what the two lists are", () => {
    const text = formatBacklinkDetails(ONE_OF_EACH);
    expect(text).toContain('Backlinks for "forbes.com"');
    expect(text).toContain("the individual links, and the pages of this site they point at");
  });

  /** Each window carries its OWN caption — the two are fetched under different bounds. */
  it("captions each list separately, with that list's own bounds", () => {
    const text = formatBacklinkDetails(
      details(
        window_([LINK], 42671699, { offset: 100, limit: 25 }),
        window_([PAGE], 3813583, { offset: 0, limit: 20 }),
      ),
    );
    expect(text).toContain("Individual backlinks — 1 backlink in this window (offset 100, limit 25)");
    expect(text).toContain(
      "Pages of this site that earn the links — 1 page in this window (offset 0, limit 20)",
    );
    expect(text).toContain("DataForSEO counts 42,671,699 backlinks for this target in total");
    expect(text).toContain("DataForSEO counts 3,813,583 pages for this target in total");
  });

  /**
   * The whole-page version of the negative pin above: with 1 link row printed beside a whole-set
   * count of 42,671,699, no sentence anywhere may present the second number as describing the
   * first.
   */
  it("never presents the whole-set total as a description of the printed rows", () => {
    const text = formatBacklinkDetails(ONE_OF_EACH);
    expect(text).not.toMatch(/\b1 of 42,671,699\b/);
    expect(text).not.toMatch(/42,671,699 (backlinks|links) (shown|listed|below|found)/i);
    expect(text).not.toMatch(/showing 1 of/i);
  });

  it("prints who links, from where, to WHICH page, and the anchor", () => {
    const text = formatBacklinkDetails(ONE_OF_EACH);
    expect(text).toContain(
      "• www.opencart.com → http://www.forbes.com/sites/brentgleeson/2014/09/05/launch/",
    );
    expect(text).toContain("from https://www.opencart.com/");
    expect(text).toContain('anchor "Forbes"');
    expect(text).toContain("dofollow");
    expect(text).toContain("rank 862 of 1,000");
  });

  it("prints the target's own page row with its counts", () => {
    const text = formatBacklinkDetails(ONE_OF_EACH);
    expect(text).toContain("• http://www.forbes.com/");
    expect(text).toContain("1,259,787 backlinks · 20,369 referring domains (4,210 nofollow)");
    expect(text).toContain("0 broken backlinks");
    expect(text).toContain("rank 452 of 1,000");
  });

  /**
   * The spam scores are the vendor's, under the vendor's names — including the singular/plural
   * difference between the two endpoints, which is DataForSEO's own inconsistency. Printing a
   * column headed "spam score" beside a list of links without saying whose number it is reads as
   * SeoGrep's verdict on those links, and SeoGrep does not have one (NEVER #7).
   */
  it("attributes both spam scores to the vendor and passes no judgement of its own", () => {
    const text = formatBacklinkDetails(ONE_OF_EACH);
    expect(text).toContain("vendor spam score 0");
    expect(text).toContain("vendor spam score 31");
    expect(text).toContain(VENDOR_SPAM_SCORE_NOTE);
    expect(text).toMatch(/backlink_spam_score/);
    expect(text).toMatch(/backlinks_spam_score/);
    expect(text).not.toMatch(/\btoxic\b/i);
    expect(text).not.toMatch(/\bbad link/i);
    // The ONLY "disavow" allowed on the page is the disclaimer's own refusal to recommend one.
    expect(text).not.toMatch(/(should|recommend|consider) disavow/i);
    expect(text).not.toMatch(/(low|high|poor) quality/i);
  });

  /** An absent vendor figure is n/a, never a zero — on a link report a fabricated 0 is news. */
  it("prints n/a for a metric DataForSEO had no value for, never a zero", () => {
    const text = formatBacklinkDetails(
      details(
        window_(
          [
            {
              ...LINK,
              rank: null,
              backlink_spam_score: null,
              dofollow: null,
              url_to_status_code: null,
              first_seen: null,
              last_seen: null,
            },
          ],
          null,
        ),
        window_(
          [
            {
              ...PAGE,
              backlinks: null,
              referring_domains: null,
              referring_domains_nofollow: null,
              broken_backlinks: null,
              rank: null,
              backlinks_spam_score: null,
              first_seen: null,
            },
          ],
          null,
          { offset: 0, limit: 20 },
        ),
      ),
    );
    expect(text).toContain("rank n/a of 1,000");
    expect(text).toContain("vendor spam score n/a");
    expect(text).toContain("follow status n/a");
    expect(text).toContain("n/a backlinks · n/a referring domains (n/a nofollow)");
    expect(text).toContain("n/a broken backlinks");
    expect(text).not.toMatch(/\b0 broken backlinks\b/);
    expect(text).not.toMatch(/rank 0 of/);
  });

  /** A vendor ZERO is data the vendor sent, and is printed as 0 rather than hidden. */
  it("prints a vendor zero as zero — it is a real answer", () => {
    const text = formatBacklinkDetails(ONE_OF_EACH);
    expect(text).toContain("0 broken backlinks");
    expect(text).toContain("vendor spam score 0");
  });

  /** An image link carries no anchor. The vendor's own item_type says WHY, so it is printed. */
  it("explains an empty anchor instead of printing a bare blank", () => {
    const text = formatBacklinkDetails(
      details(window_([{ ...LINK, anchor: "", item_type: "image" }], 10), window_([], null)),
    );
    expect(text).toContain("no anchor text (image link)");
    expect(text).not.toContain('anchor ""');
  });

  /**
   * R-6.2 (finding BD-3). The vendor sends the `rel` values it saw per link; the row printed only
   * `dofollow` / `nofollow`, so a PAID link declared `sponsored` and a plain nofollowed link were
   * the same word — in the tool whose one job is showing links individually.
   */
  it("prints the vendor's rel attributes beside the follow status, under the vendor's field name", () => {
    const text = formatBacklinkDetails(
      details(
        window_([{ ...LINK, dofollow: false, attributes: ["sponsored", "noopener"] }], 10),
        window_([], null),
      ),
    );
    expect(text).toContain("nofollow · DataForSEO attributes: sponsored, noopener");
    expect(text).toContain(REL_ATTRIBUTES_NOTE);
  });

  it("distinguishes a sponsored link from a ugc link rather than calling both nofollow", () => {
    const text = formatBacklinkDetails(
      details(
        window_(
          [
            { ...LINK, domain_from: "paid.example", dofollow: false, attributes: ["sponsored"] },
            { ...LINK, domain_from: "forum.example", dofollow: false, attributes: ["ugc"] },
          ],
          10,
        ),
        window_([], null),
      ),
    );
    expect(text).toContain("DataForSEO attributes: sponsored");
    expect(text).toContain("DataForSEO attributes: ugc");
  });

  /** A vendor silence renders EXACTLY as it did before the field was parsed — no invented "none". */
  it("adds no attribute clause, and no note, when the vendor reported nothing", () => {
    const text = formatBacklinkDetails(details(window_([LINK], 10), window_([], null)));
    expect(text).not.toContain("DataForSEO attributes");
    expect(text).not.toContain(REL_ATTRIBUTES_NOTE);
    const empty = formatBacklinkDetails(
      details(window_([{ ...LINK, attributes: [] }], 10), window_([], null)),
    );
    expect(empty).not.toContain("DataForSEO attributes");
  });

  it("says out loud when DataForSEO named no URL, instead of leaving a gap", () => {
    const text = formatBacklinkDetails(
      details(window_([{ ...LINK, url_to: null, url_from: null }], 10), window_([], null)),
    );
    expect(text).toContain("(DataForSEO did not name it)");
    expect(text).not.toMatch(/→ null/);
    expect(text).not.toMatch(/from null/);
  });

  it("marks a link the vendor flagged broken, and marks nothing when it did not", () => {
    const broken = formatBacklinkDetails(
      details(window_([{ ...LINK, is_broken: true, url_to_status_code: 404 }], 10), window_([], null)),
    );
    expect(broken).toContain("DataForSEO flags this link as broken");
    expect(broken).toContain("linked page status 404");
    expect(formatBacklinkDetails(ONE_OF_EACH)).not.toContain("flags this link as broken");
  });

  /**
   * CONTRACT CHANGED 2026-09-04 (finding BD-1). The old pin asserted the LINK half went SILENT
   * when its window came back empty, and that silence was the defect: the page window is always
   * fetched from offset 0, so on a real domain it is never empty — which made the honest
   * "nothing came back" answer unreachable in production while its test stayed green on a
   * hand-built double (signed lesson 12). A paid call at offset 19,000 returned 1,164 characters
   * that never contained the word "backlinks" or the offset it was empty for.
   *
   * What is UNCHANGED and still pinned below: the empty PAGE half stays silent, and the caption
   * for a list that did come back is untouched.
   */
  it("still prints only the page list when the LINK list is the one that came back", () => {
    const linksOnly = formatBacklinkDetails(details(window_([LINK], 10), window_([], null)));
    expect(linksOnly).toContain("Individual backlinks —");
    expect(linksOnly).not.toContain("Pages of this site that earn the links");
  });

  it("names the empty LINK window instead of going silent about the half that was paid for", () => {
    const pagesOnly = formatBacklinkDetails(
      details(window_([], 42_671_699, { offset: 19_000, limit: 5 }), window_([PAGE], 10)),
    );
    expect(pagesOnly).toContain("Pages of this site that earn the links");
    // The window's OWN bounds, through the one caption formatter — offset included.
    expect(pagesOnly).toContain("Individual backlinks — 0 backlinks in this window");
    expect(pagesOnly).toContain("(offset 19,000, limit 5)");
    expect(pagesOnly).toContain(EMPTY_LINK_WINDOW_NOTE);
    // It is NOT the "nothing at all" answer: rows came back, so that sentence stays for the case
    // where BOTH windows are empty.
    expect(pagesOnly).not.toContain("No backlinks found for");
  });

  /**
   * THE LIVE SHAPE (finding BD-8): the exact reply a 35-credit call produced on 2026-09-03 —
   * an empty link window at offset 19,000 whose `total_count` came back 0, printed beside a page
   * list showing 1,259,787 backlinks. The old text told the customer the vendor counted ZERO
   * backlinks for the target three lines above rows proving otherwise.
   */
  it("never claims a zero whole-set count beside pages that show backlinks", () => {
    const text = formatBacklinkDetails(
      details(window_([], 0, { offset: 19_000, limit: 5 }), window_([PAGE], 10)),
    );
    expect(text).not.toMatch(/counts 0 backlinks for this target in total/);
    expect(text).toContain("reported total_count 0");
    expect(text).toContain("not used here as the target's whole-profile count");
    expect(text).toContain(EMPTY_LINK_WINDOW_NOTE);
    expect(text).toContain("1,259,787 backlinks");
  });

  it("does not print the empty-window note when link rows came back", () => {
    expect(formatBacklinkDetails(ONE_OF_EACH)).not.toContain(EMPTY_LINK_WINDOW_NOTE);
  });

  /**
   * The empty answer must still name the window it was empty FOR: "no backlinks" at offset 19,000
   * means the page ran out, not that the site has none — and the two readings differ by 42
   * million rows.
   */
  it("says plainly when nothing came back, and names the window it asked for", () => {
    const text = formatBacklinkDetails(
      details(window_([], null, { offset: 19000, limit: 50 }), window_([], null)),
    );
    expect(text).toContain('No backlinks found for "forbes.com"');
    expect(text).toContain("(offset 19,000, limit 50)");
    expect(text).not.toContain("•");
  });

  it("names the resolved PROJECT in the heading when the target came from one", () => {
    expect(formatBacklinkDetails(ONE_OF_EACH, PROJECT)).toContain('Backlinks for your project "example.com"');
  });

  it("does NOT invent a project for a bare-target lookup", () => {
    expect(formatBacklinkDetails(ONE_OF_EACH)).not.toContain("your project");
  });

  /** End to end over the VENDOR's own published examples, through Part A's mock port. */
  it("renders the vendor's own example responses without conflating their two totals", async () => {
    const port = createMockBacklinkDetailsPort({
      backlinks: backlinksFixture,
      targetPages: targetPagesFixture,
    });
    const text = formatBacklinkDetails(
      await port.fetchBacklinkDetails({ target: "forbes.com", limit: 50, offset: 0, page_limit: 20 }),
    );
    expect(text).toContain("DataForSEO counts 42,671,699 backlinks for this target in total");
    expect(text).toContain("DataForSEO counts 3,813,583 pages for this target in total");
    expect(text).toContain("2 backlinks in this window");
    expect(text).toContain("1 page in this window");
    expect(text).not.toMatch(/\b2 of 42,671,699\b/);
  });
});

describe("backlink_details tool metadata", () => {
  const tool = makeBacklinkDetailsTool();

  it("advertises its name, the 35-credit cost, and a snake_case input schema", () => {
    expect(tool.name).toBe("backlink_details");
    expect(tool.description).toContain("Costs 35 credits.");
    const schema = tool.inputJsonSchema as {
      required?: string[];
      properties: Record<string, { maximum?: number; minimum?: number; default?: unknown; format?: string }>;
    };
    expect(schema.required ?? []).toEqual([]);
    expect(Object.keys(schema.properties).sort()).toEqual([
      "limit",
      "offset",
      "page_limit",
      "project_id",
      "target",
    ]);
    expect(schema.properties.project_id?.format).toBe("uuid");
  });

  /**
   * THE ROW CAPS ARE THE PRICE. DataForSEO bills per returned row, and Part A derived 700 + 200 =
   * 900 billed rows from the SIGNED 35 credits: that pair clears the signed 5.2x worst-case floor
   * at 5.40x, while the vendor's own 1,000-per-request ceiling would fall to 3.6x and break it.
   * So the surface's maxima are asserted AGAINST the port's constants rather than restated: a
   * schema that let a caller ask for more than the port clamps to would be advertising a window
   * the price was never signed for (NEVER #6).
   */
  it("caps both row counts at exactly the port's caps, and defaults well below them", () => {
    const schema = tool.inputJsonSchema as {
      properties: Record<string, { default?: number; maximum?: number; minimum?: number }>;
    };
    expect(schema.properties.limit?.minimum).toBe(1);
    expect(schema.properties.limit?.maximum).toBe(MAX_BACKLINK_DETAIL_ROWS);
    expect(schema.properties.limit?.default).toBe(50);
    expect(schema.properties.page_limit?.minimum).toBe(1);
    expect(schema.properties.page_limit?.maximum).toBe(MAX_TARGET_PAGE_ROWS);
    expect(schema.properties.page_limit?.default).toBe(20);
    // The pair the margin arithmetic rests on — asserted as a SUM so widening either one alone
    // still turns this red.
    expect(
      (schema.properties.limit?.maximum ?? 0) + (schema.properties.page_limit?.maximum ?? 0),
    ).toBe(900);
    expect(schema.properties.limit?.default).toBeLessThan(schema.properties.limit?.maximum ?? 0);
    expect(schema.properties.page_limit?.default).toBeLessThan(
      schema.properties.page_limit?.maximum ?? 0,
    );
  });

  /** The vendor documents offset <= 20000; deeper paging needs a token this port does not send. */
  it("caps offset at the vendor's documented ceiling, and starts at 0", () => {
    const schema = tool.inputJsonSchema as {
      properties: Record<string, { default?: number; maximum?: number; minimum?: number }>;
    };
    expect(schema.properties.offset?.minimum).toBe(0);
    expect(schema.properties.offset?.maximum).toBe(MAX_BACKLINKS_OFFSET);
    expect(schema.properties.offset?.default).toBe(0);
  });

  it("says it needs a paid balance and promises the free refusal", () => {
    expect(tool.description).toMatch(/paid credit balance/i);
    expect(tool.description).toMatch(/charges nothing/i);
  });

  it("rejects a row count past the cap before any handler work", async () => {
    const result = await tool.run(CTX, { target: "example.com", limit: 5000 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input/i);
  });

  it("rejects a page count past the cap before any handler work", async () => {
    const result = await tool.run(CTX, { target: "example.com", page_limit: 900 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input/i);
  });

  it("rejects an offset past the vendor's documented ceiling", async () => {
    const result = await tool.run(CTX, { target: "example.com", offset: 20001 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input/i);
  });
});

describe("backlink_details free pre-reserve gates (no credit machinery)", () => {
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

  const serving = () =>
    makeBacklinkDetailsTool({
      port: createMockBacklinkDetailsPort({
        backlinks: backlinksFixture,
        targetPages: targetPagesFixture,
      }),
      loadProject,
    });

  it("rejects a non-public target without reaching the ledger", async () => {
    const result = await serving().run(CTX, { target: "not a domain" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not a valid domain/i);
  });

  it("rejects a reserved/internal target exactly as every other domain tool does", async () => {
    const result = await serving().run(CTX, { target: "intranet.local" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not a public domain/i);
  });

  it("rejects a call naming NEITHER project_id nor target, without reaching the ledger", async () => {
    const result = await serving().run(CTX, {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Nothing to look up/i);
  });

  it("rejects a call naming BOTH, without reaching the ledger", async () => {
    const result = await serving().run(CTX, { target: "example.com", project_id: PROJECT_ID });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not both/i);
  });

  it("answers another tenant's project id exactly as it answers an unknown uuid — free", async () => {
    const theirs = await serving().run(CTX, { project_id: OTHER_PROJECT_ID });
    expect(theirs.isError).toBe(true);
    expect(theirs.content[0]?.text).toBe(projectNotFoundMessage(OTHER_PROJECT_ID));
  });

  it("returns a clear English 'not enabled' error and never reaches the ledger", async () => {
    const tool = makeBacklinkDetailsTool({ port: disabledBacklinkDetailsPort(), loadProject });
    const result = await tool.run(CTX, { target: "example.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);
    expect(result.content[0]?.text).toMatch(/not charged/i);
    // ...and it never leaks the fixture rows it could have served instead (NEVER #7).
    expect(result.content[0]?.text).not.toContain("opencart");
    expect(result.content[0]?.text).not.toContain("42,671,699");
  });

  it("the ENABLED path DOES enter the credit guard (reaches the DB, which is absent here)", async () => {
    await expect(serving().run(CTX, { target: "example.com" })).rejects.toThrow(/SUPABASE/i);
  });

  it("a RESOLVED project_id also reaches the credit guard — the gates are not a dead end", async () => {
    await expect(serving().run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(/SUPABASE/i);
  });
});

// =============================================================================================
// S14 item 1 — THE PRICE SENTENCE, PINNED BY MEANING.
//
// The schema used to say "DataForSEO bills per returned row, so this is the price control, not a
// display preference". MEASURED 2026-08-25 on one profile: `limit 10` cost the vendor $0.04854
// and `limit 200` (187 rows back) cost $0.05506 — NINETEEN times the rows for THIRTEEN percent
// more money, because the Backlinks tariff is a flat per-request fee plus $0.000036 a row. The
// credit price was 35 both times. So a customer who narrows the window to save money pays the
// same and receives less, on the strength of a sentence this product wrote.
//
// These specs read the description off the PUBLISHED JSON schema (what the customer's client is
// handed), and assert on the CLAIM with regexes rather than on a copy of the source string —
// signed lesson 11: a literal-for-literal grep proves the file, not the promise.
// =============================================================================================

describe("S14 — the limit description states measured billing behaviour", () => {
  const schema = makeBacklinkDetailsTool().inputJsonSchema as {
    properties: Record<string, { description?: string }>;
  };
  const limit = schema.properties.limit?.description ?? "";
  const pageLimit = schema.properties.page_limit?.description ?? "";

  it("no longer calls the row count a price control", () => {
    expect(limit).not.toMatch(/\bthe price control\b/i);
    expect(limit).not.toMatch(/bills? per returned row,? so this is/i);
    expect(pageLimit).not.toMatch(/billed per row/i);
  });

  it("says a narrower window is not a cheaper one, on BOTH row arguments", () => {
    expect(limit).toMatch(/\bnot a price control\b/i);
    expect(limit).toMatch(/fewer rows costs? the same/i);
    expect(pageLimit).toMatch(/fewer rows costs? the same/i);
  });

  it("names the flat credit price the caller actually pays, whatever they ask for", () => {
    expect(limit).toMatch(/35 credits/);
    expect(limit).toMatch(/whatever you ask for/i);
  });

  it("attributes the near-flat vendor cost to the vendor, as a measurement", () => {
    expect(limit).toMatch(/flat per-request fee/i);
    expect(limit).toMatch(/measured/i);
  });
});

// =============================================================================================
// S14 item 2 — THE REPLY THE CLIENT COULD NOT DISPLAY.
//
// MEASURED 2026-08-25: `limit 200, page_limit 9` returned 187 link rows and produced a reply of
// 62,729 characters across 404 lines, refused by the client as "exceeds maximum allowed tokens".
// 35 credits and $0.055 of vendor money were taken and the customer saw NOTHING. The schema
// still permits limit 700 / page_limit 200, i.e. four times worse again.
//
// The fix bounds the RENDERED TEXT rather than narrowing the schema, because 700 + 200 is derived
// from the signed 35-credit price (NEVER #6) and because a narrower window does not cost less
// (item 1). These specs drive the REAL renderer over the previously-failing shape and over the
// schema's own worst case.
// =============================================================================================

/** A link row of realistic length — the measured live rows ran ~320 characters over two lines. */
function linkRow(index: number): BacklinkDetailRow {
  return {
    ...LINK,
    domain_from: `referrer-${index}.example.com`,
    url_from: `https://referrer-${index}.example.com/blog/2026/03/a-fairly-long-article-slug-${index}/`,
    url_to: `https://forbes.com/sites/brentgleeson/2014/09/05/launch-${index}/`,
    anchor: `some anchor text number ${index}`,
  };
}

function pageRow(index: number): TargetPageRow {
  return { ...PAGE, url: `https://www.forbes.com/sites/section-${index}/a-long-page-slug-${index}/` };
}

const measuredLinks = Array.from({ length: 187 }, (_, i) => linkRow(i));
const measuredPages = Array.from({ length: 9 }, (_, i) => pageRow(i));

describe("S14 — the reply is bounded so the client can display it", () => {
  /** The exact call that was charged for and never seen. */
  it("keeps the measured limit-200 / page_limit-9 shape inside the output ceiling", () => {
    const text = formatBacklinkDetails(
      details(
        window_(measuredLinks, 187, { offset: 0, limit: 200 }),
        window_(measuredPages, 9, { offset: 0, limit: 9 }),
      ),
    );
    // The unbounded renderer produced 62,729 characters for this shape.
    expect(text.length).toBeLessThanOrEqual(MAX_RENDERED_OUTPUT_CHARS);
    expect(text.length).toBeLessThan(62_729);
  });

  /** The schema's own worst case — 700 links and 200 pages — is bounded by the SAME ceiling. */
  it("holds the ceiling at the widest window the schema permits", () => {
    const text = formatBacklinkDetails(
      details(
        window_(
          Array.from({ length: MAX_BACKLINK_DETAIL_ROWS }, (_, i) => linkRow(i)),
          9_000_000,
          { offset: 0, limit: MAX_BACKLINK_DETAIL_ROWS },
        ),
        window_(
          Array.from({ length: MAX_TARGET_PAGE_ROWS }, (_, i) => pageRow(i)),
          9_000_000,
          { offset: 0, limit: MAX_TARGET_PAGE_ROWS },
        ),
      ),
    );
    expect(text.length).toBeLessThanOrEqual(MAX_RENDERED_OUTPUT_CHARS);
  });

  /**
   * A truncated reply must say so. The rows that were dropped were FETCHED and CHARGED FOR, and a
   * list that simply stops is a list the reader believes is complete.
   */
  it("says how many rows were fetched and not printed, and that they were paid for", () => {
    const text = formatBacklinkDetails(
      details(
        window_(measuredLinks, 187, { offset: 0, limit: 200 }),
        window_(measuredPages, 9, { offset: 0, limit: 9 }),
      ),
    );
    expect(text).toMatch(/output limit reached/i);
    expect(text).toMatch(/more fetched in this same window but not printed/i);
    expect(text).toMatch(/charged for either way/i);
    // The printed + omitted counts must add up to the window the caption already announced.
    const [, printed, omitted] = /— ([\d,]+) backlinks printed above, ([\d,]+) more/.exec(text) ?? [];
    expect(Number(printed?.replace(/,/g, ""))+ Number(omitted?.replace(/,/g, ""))).toBe(187);
    expect(Number(printed?.replace(/,/g, ""))).toBeGreaterThan(0);
  });

  /**
   * The advice has to be the advice that WORKS. `offset` moves the window; asking for a smaller
   * `limit` does not buy more rows and does not cost less (item 1), so the note may not say it.
   */
  it("points at offset, not at a narrower window, and repeats that narrowing saves nothing", () => {
    const note = renderOutputLimitNote("backlink", 62, 125, "Move the window with offset to read the rest.");
    expect(note).toMatch(/62 backlinks printed above, 125 more/);
    const text = formatBacklinkDetails(
      details(window_(measuredLinks, 187, { offset: 0, limit: 200 }), window_([], null)),
    );
    expect(text).toMatch(/move the window with offset/i);
    expect(text).toMatch(/asking for fewer rows does not cost less/i);
  });

  /** THE DEFAULT CALL MUST NOT REGRESS: 50 links + 20 pages is not truncated at all. */
  it("does not truncate the default window", () => {
    const text = formatBacklinkDetails(
      details(
        window_(Array.from({ length: 50 }, (_, i) => linkRow(i)), 187, { offset: 0, limit: 50 }),
        window_(Array.from({ length: 20 }, (_, i) => pageRow(i)), 9, { offset: 0, limit: 20 }),
      ),
    );
    expect(text).not.toMatch(/output limit reached/i);
    expect(text).toContain("• referrer-49.example.com");
    expect(text).toContain("a-long-page-slug-19");
  });

  /** No note when nothing was dropped — an honest report does not warn about a thing that did not happen. */
  it("prints no truncation note when the whole window fits", () => {
    expect(formatBacklinkDetails(ONE_OF_EACH)).not.toMatch(/output limit reached/i);
  });
});
