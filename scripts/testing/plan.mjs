// The sweep matrix: sites x tools x scenarios, as DATA.
//
// Everything the run does is derived from the four tables below (SITES, ID_TOOLS, SCENARIOS,
// PLAN) plus TOOL_COSTS, which is IMPORTED from the app — never copied. A copied price table
// is the failure this project has already paid for twice (constitution NEVER #6 / #9), and a
// hand-maintained tool list is how "16 tools" survived in four documents while the server
// served 19. Hence assertCoverage(): every tool the LIVE server reports must appear in PLAN
// or in EXCLUDED with a written reason, and every TOOL_COSTS key must appear in the live list.
// An uncovered tool is a startup failure, not a silent gap.
//
// assertIdToolTable() closes the same gap one level down: the S3 (invalid input) and S4
// (foreign tenant) cells are GENERATED from ID_TOOLS, so a newly shipped tool that accepts
// project_id or target cannot be silently skipped — the live schema is checked against the
// table and a mismatch stops the run.
//
// Node floor: this imports the app's costs.ts directly, so it needs Node >= 22.18 (the release
// that turned on type-stripping by default) — the same floor root package.json declares and the
// same trick scripts/reconcile.mjs uses. costs.ts is a pure `as const` object with no runtime
// imports, so the import pulls in nothing else.
import { TOOL_COSTS } from "../../apps/mcp/src/credits/costs.ts";

/**
 * The eight campaign sites (PLAN.md, pre-flighted with curl 2026-08-08: all HTTP 200, zero
 * redirects, robots.txt 200, sitemap declared). `www` is a first-class field because two
 * domains carry it and six do not — normalizeDomain's www behaviour and the GSC property form
 * are the real input of the S6 boundary scenario.
 *
 * `gsc` is the CONSENT state, not a guess: "connected" means the OAuth click has happened.
 * The operator flips a site to "connected" here as consent is granted; K2 selects on this
 * field, so a site whose owner has not clicked is never charged for a Search Console tool.
 */
export const SITES = Object.freeze([
  { key: "adstark", domain: "adstark.com.tr", tld: ".com.tr", www: false, gsc: "connected", active: true, crawl: true, note: "set up; fresh crawl + GSC — the notebook's 34 findings all come from here; property https://adstark.com.tr/ (re-measured 2026-08-10)" },
  // bayder + rkturizm: PR #64 (#50) made matchGscProperty read permissionLevel, and the operator
  // re-approved both. MEASURED 2026-08-10 via connect_gsc, not assumed: each now reports the
  // https:// property, not the sc-domain one it used to claim. The old notes are kept in the
  // campaign document, not here — a stale note in a selector table is how a run measures the
  // wrong thing and reports it confidently.
  { key: "bayder", domain: "bayder.com.tr", tld: ".com.tr", www: false, gsc: "connected", active: true, crawl: true, note: "1 sitemap; property https://bayder.com.tr/ (was sc-domain: before #50)" },
  { key: "rkturizm", domain: "rkturizm.com", tld: ".com", www: false, gsc: "connected", active: true, crawl: true, note: "1 sitemap; the H9 probe — Turkish business on a .com; property https://rkturizm.com/ (was sc-domain: before #50)" },
  { key: "bigcattr", domain: "www.bigcattr.com", tld: ".com", www: true, gsc: "connected", active: true, crawl: true, note: "2 sitemaps; brand carries 'tr', TLD does not; property https://www.bigcattr.com/" },
  // OPERATOR DECISION 2026-08-09: out of the campaign. The project and its crawl still exist and
  // GSC still lists sc-domain:noraninsaat.com as siteOwner — the removal is a preference, not a
  // technical block. `active:false` keeps the row (deleting it would erase why it is absent) and
  // every selector below filters on it, so no cell can be generated for it by accident.
  { key: "noraninsaat", domain: "www.noraninsaat.com", tld: ".com", www: true, gsc: "connected", active: false, crawl: false, note: "REMOVED FROM CAMPAIGN by the operator 2026-08-09; project and crawl untouched" },
  { key: "katrenur", domain: "katrenur.com", tld: ".com", www: false, gsc: "connected", active: true, crawl: true, note: "1 sitemap; property sc-domain:katrenur.com — the only sc-domain property left in the campaign" },
  { key: "dentnotion", domain: "dentnotion.com", tld: ".com", www: false, gsc: "connected", active: true, crawl: true, note: "5 sitemaps; property https://dentnotion.com/; largest GSC dataset in the portfolio" },
  { key: "seogrep", domain: "seogrep.com", tld: ".com", www: false, gsc: "none", active: true, crawl: true, note: "set up; crawl but no GSC — the control group, and the only site where 'GSC cold' is a REAL site" },
  // THE COLD FIXTURE — added 2026-08-10 (operator approved) for Faz B state (2).
  // MEASURED FIRST: whats_next on all seven campaign sites reports a crawl AND (bar seogrep) GSC
  // data, so "no crawl yet" is not observable on any of them. That is precisely the hole that let
  // finding #35 survive the 1st session: generate_report was never called on an empty project
  // because K4 only ran on two full ones, and eight affected tools had to be found by grep.
  // example.net is IANA-reserved, can never be a real customer, and `crawl:false` keeps every
  // charging cell away from it — the project stays empty on purpose, forever.
  { key: "coldfixture", domain: "example.net", tld: ".net", www: false, gsc: "none", active: true, crawl: false, note: "EMPTY ON PURPOSE: no crawl, no GSC, never charged. The only place the cold branch of the audit trio, generate_report and the GSC family can be measured" },
]);

/**
 * Tools that take a tenant-scoped id and/or a free-form target, with the ARGUMENT NAMES the
 * live schema uses. This is the generator for every S3 and S4 cell. It is validated against
 * tools/list at startup (assertIdToolTable), so it cannot drift away from the server.
 *
 * `target` is present on exactly the three premium tools PR #56 changed: they take project_id
 * OR target, exactly one, and supplying both is REJECTED rather than silently resolved. That
 * rejection is a deliberate cell (S3d), not an accident.
 */
export const ID_TOOLS = Object.freeze([
  { tool: "connect_gsc", idArg: "project_id", targetArg: null },
  { tool: "crawl_site", idArg: "project_id", targetArg: null },
  { tool: "pull_gsc_data", idArg: "project_id", targetArg: null },
  { tool: "find_quick_wins", idArg: "project_id", targetArg: null },
  { tool: "detect_cannibalization", idArg: "project_id", targetArg: null },
  { tool: "analyze_content_decay", idArg: "project_id", targetArg: null },
  { tool: "audit_onpage", idArg: "project_id", targetArg: null },
  { tool: "audit_tech", idArg: "project_id", targetArg: null },
  { tool: "audit_schema", idArg: "project_id", targetArg: null },
  { tool: "generate_report", idArg: "project_id", targetArg: null },
  { tool: "whats_next", idArg: "project_id", targetArg: null },
  { tool: "ranked_keywords", idArg: "project_id", targetArg: "target" },
  { tool: "analyze_backlinks", idArg: "project_id", targetArg: "target" },
  { tool: "compare_competitors", idArg: "project_id", targetArg: "target" },
]);

/**
 * Tools deliberately absent from PLAN, each with the reason a human can argue with. Empty
 * today — all 19 live tools are planned — but the map stays, because the coverage assertion's
 * whole value is that skipping a tool costs someone a written sentence.
 */
/**
 * Tools deliberately OUTSIDE the sweep, each with the reason written out. assertCoverage treats an
 * entry here as covered, so this object is the only way a live tool can be absent from PLAN without
 * failing the run — which is why every value must be a non-empty reason and why the check enforces
 * that rather than trusting the key alone.
 *
 * WHY IT WAS EMPTY WHILE 19 TOOLS WERE UNCOVERED. It was never filled in. `--self-test` had been
 * exiting 1 on the coverage assertion, and nothing ran it: verify.sh does not execute scripts/, so
 * the sweep's own coverage gate was red on every branch and invisible on all of them (M-01, audit
 * 2026-08-26). verify.sh now runs `--self-test`, so this list cannot go stale in silence again.
 *
 * THIS IS NOT THE GATE BEING LOOSENED. What the assertion measures is "no live tool is
 * UNACCOUNTED FOR", not "every live tool is swept" — a sweep cell spends real credits against real
 * customer sites, and which of those to buy is an operator decision (contract.md: money and the
 * outside world are the human's). Three of the nineteen cost nothing and mutate nothing, so they
 * moved into PLAN rather than here. The other sixteen are listed with what it would take to
 * include them.
 */
export const EXCLUDED = Object.freeze({
  // ---- Free, but MUTATING. The sweep authenticates as one real tenant and runs against eight
  // real customer sites; a cell here would change tracked state, not observe it. A sweep that
  // rewrites the estate it is measuring cannot be re-run, and its second run measures its first.
  track_gsc_property:
    "free but MUTATING: opens or restores a project and binds a GSC property to it. Needs a " +
    "disposable tenant, not the campaign account. Include when the sweep gets its own throwaway " +
    "workspace.",
  untrack_project:
    "free but MUTATING: archives a project. Running it across the campaign sites would dismantle " +
    "the estate every other layer measures. Same precondition as track_gsc_property.",
  track_keywords:
    "free but MUTATING: writes a project's tracked-keyword registration, and the registration is " +
    "what keyword_positions later bills against. Same precondition.",

  // ---- Paid. Each line carries the signed per-call price, because the reason a cell is not
  // bought is the price times the site count, and that number should not need looking up.
  discover_keywords: "paid, 40 credits/call and a DataForSEO Labs request. Needs an operator budget signature (NEVER #6).",
  my_pages: "paid, 40 credits/call and a DataForSEO Labs request. Needs an operator budget signature.",
  keyword_gap: "paid, 45 credits/call. Also requires a competitor domain per site — a per-site input the matrix does not yet carry.",
  link_gap: "paid, 45 credits/call. Same missing per-site competitor input as keyword_gap.",
  backlink_changes: "paid, 35 credits/call against the DataForSEO backlinks API. Needs a budget signature.",
  backlink_details: "paid, 35 credits/call against the DataForSEO backlinks API. Needs a budget signature.",
  disavow_candidates: "paid, 40 credits/call. Needs a budget signature, and a spam-score threshold chosen per site rather than defaulted.",
  audit_speed: "paid, 15 credits/call plus a Lighthouse run per URL. Needs a budget signature and a per-site URL list.",
  audit_content: "paid, 12 credits/call. Reads a stored pull AND a stored crawl, so it can only run after K1 and K2 both land on the same site.",
  ai_visibility:
    "paid, 90 credits/call — and BLOCKED beyond price: H-01 (audit 2026-08-26) found the vendor " +
    "budget ceiling for this family unproven, so paid AI smoke is refused until the upper bound " +
    "is established and the margin re-signed.",
  ai_visibility_compare: "paid, 90 credits PER TARGET over 2-10 targets. Blocked by H-01 exactly as ai_visibility is.",
  keyword_positions: "paid, 10 credits/call, and it only returns anything for keywords track_keywords registered first — which is itself excluded above.",
  serp_snapshot: "paid, 5 + 8 per keyword over 1-10 keywords. Needs a budget signature and a per-site keyword list.",
});

/**
 * The six campaign scenarios. `charges` is the PRE-REGISTERED expectation of whether the cell
 * reaches a credit reserve, and it is what expected_cost is derived from — so a rejection that
 * silently bills the user shows up as delta_mismatch instead of being averaged away.
 *
 * S2/S3/S4 are charges:false because that was MEASURED in the code on 2026-08-08: the three
 * premium tools resolve their target BEFORE withCredits, and the audit tools THROW on "no
 * crawl" so withCredits releases. Believed-free is not measured-free, which is exactly why the
 * harness reads the balance either side of these cells too.
 *
 * S3 splits into lettered variants so the cell key stays `site|tool|scenario` and stays unique;
 * `--scenario=S3` selects every S3* by prefix.
 */
export const SCENARIOS = Object.freeze({
  S1: { label: "happy path", charges: true },
  S1b: { label: "happy path — account-wide variant, optional argument omitted", charges: true },
  S2: { label: "cold state (no crawl / no GSC / nothing analysed yet)", charges: false },
  S3a: { label: "invalid input — malformed id", charges: false },
  S3b: { label: "invalid input — well-formed id that does not exist", charges: false },
  S3c: { label: "invalid input — malformed domain / target / empty list", charges: false },
  S3d: { label: "invalid input — project_id AND target together (PR #56 must reject)", charges: false },
  S4: { label: "tenant isolation — another tenant's project_id", charges: false },
  S5: { label: "repeat / idempotence — the identical call, a second time", charges: true },
  S6a: { label: "boundary — minimum", charges: true },
  S6b: { label: "boundary — maximum", charges: true },
  S6c: { label: "boundary — non-default locale (H9)", charges: true },
});

/** Malformed id: fails the schema's uuid pattern, so the rejection happens before any handler. */
const MALFORMED_ID = "not-a-uuid";
/** Well-formed v4 uuid that belongs to nobody — passes the schema, fails the tenant lookup. */
const ABSENT_ID = "11111111-2222-4333-8444-555555555555";
/** Not a hostname by any reading — for `domain` and `target` arguments. */
const MALFORMED_TARGET = "not a domain!!";

/** The brand label of a domain: "www.bigcattr.com" -> "bigcattr", "adstark.com.tr" -> "adstark". */
export function brandOf(domain) {
  return String(domain).replace(/^www\./, "").split(".")[0];
}

/**
 * Every selector is `active`-gated at its root, so a site the operator has taken out of the
 * campaign cannot re-enter through any single forgotten predicate. `only()` is gated too: naming
 * a key explicitly must not be a way around the removal.
 */
const allSites = (site) => site.active;
const campaignSites = (site) => site.active && site.crawl;
const gscConnected = (site) => site.active && site.gsc === "connected";
const gscNotConnected = (site) => site.active && site.gsc !== "connected";
const only = (...keys) => (site) => site.active && keys.includes(site.key);

/**
 * Sites where "cold" is actually measurable — today exactly one, and that is the point.
 *
 * MEASURED 2026-08-10 (whats_next, all seven): every campaign site now reports a crawl, and six
 * of the seven report Search Console data too. The 1st session's version of this predicate
 * (`!["adstark","seogrep"]`) was correct on the day it was written and is now a trap: it would
 * select six sites that all deliver and COMMIT, spending (30+15+5) x 6 = 300 credits to produce
 * `delta_mismatch: true` rows that mean nothing. That flag exists to say "the user paid for an
 * error message"; known-false entries in it hide the one real occurrence.
 *
 * So the cold branch moved to a project that is empty ON PURPOSE and stays that way (`crawl:
 * false` keeps every charging cell off it). "Nothing has run here yet" is a product state a real
 * customer meets on their first minute, and until now it has never been measured on the tools
 * that greet them.
 */
const neverCrawled = (site) => site.active && !site.crawl;

/**
 * The one site every argument-invariant cell runs on. Every call in this sweep authenticates
 * with the SAME api key, so the run has exactly ONE tenant: repeating a call whose arguments do
 * not vary across sites issues the identical request N times and learns nothing N-1 of those
 * times. Repetition is only worth buying where the ARGUMENTS vary.
 */
const INVARIANT_SITE = only("adstark");

/**
 * K3 sites. The 1st session bought the premium tools on two sites only, chosen for shape; Faz B
 * asks the different question — what do the four most expensive tools do across the WHOLE
 * portfolio — so the tour runs on all seven (operator approved 2026-08-10).
 *
 * THE REAL CEILING HERE IS NOT CREDITS, IT IS VENDOR DOLLARS. Seven sites x four tools = 28 live
 * DataForSEO calls, and the pre-call gate reserves at deliberate over-estimates (~$0.95/site)
 * against a $3.00/day cap that is a signed human decision. The gate is fail-closed: at the cap it
 * REFUSES rather than overspends, and that refusal is a recorded outcome like any other. The S6
 * boundary cells are declared AFTER the S1 tour on purpose — if the day runs out, it must run out
 * on the extras, not on the tour the phase exists to buy.
 */
const K3_DEFAULT = campaignSites;

/**
 * The static half of the matrix (S1, S2, S5, S6). The S3/S4 half is generated from ID_TOOLS.
 * Order is execution order: entries run top to bottom, all selected sites per entry. That is
 * why the S2 (cold) audits are declared BEFORE the crawl, and the audits after it.
 *
 * `args(ctx)` returns the arguments object or null for "not applicable on this site".
 * ctx = { site, projectId, foreignProjectId, jobId }.
 */
export const PLAN = Object.freeze([
  // ---- K0 — free surface. Runs on every site; discovers the site classes the rest depends on.
  { layer: "K0", scenario: "S1", tool: "setup_project", sites: allSites, needs: [], args: (c) => ({ domain: c.site.domain }) },
  { layer: "K0", scenario: "S5", tool: "setup_project", sites: allSites, needs: [], note: "idempotence: the second call must report created:false and charge nothing", args: (c) => ({ domain: c.site.domain }) },
  { layer: "K0", scenario: "S1", tool: "list_projects", sites: only("adstark"), needs: [], note: "account-wide, not per-site — one call is the whole measurement", args: () => ({}) },
  { layer: "K0", scenario: "S1", tool: "get_credit_balance", sites: only("adstark"), needs: [], note: "account-wide; also the instrument every other cell is measured with", args: () => ({}) },
  // The three free, READ-ONLY account surfaces. Added 2026-08-27 (M-01): they were among the 19
  // tools in neither PLAN nor EXCLUDED, and unlike the other sixteen they cost nothing and change
  // nothing, so there was never a reason to leave them unmeasured. Account-wide like the two above,
  // so one site each — eight calls would be the same call eight times.
  { layer: "K0", scenario: "S1", tool: "list_credit_activity", sites: only("adstark"), needs: [], note: "account-wide. The ledger read the sweep's own charges land in — measuring it here means a later cell's delta can be cross-read against what this tool reports", args: () => ({}) },
  { layer: "K0", scenario: "S1", tool: "list_jobs", sites: only("adstark"), needs: [], note: "account-wide. Runs BEFORE K1 enqueues anything, so it also records the empty-list branch a new customer meets", args: () => ({}) },
  { layer: "K0", scenario: "S1", tool: "list_gsc_properties", sites: only("adstark"), needs: [], note: "account-wide, read-only: lists the properties on connected Google accounts. Its mutating sibling track_gsc_property is EXCLUDED — see the reason there", args: () => ({}) },
  { layer: "K0", scenario: "S1", tool: "whats_next", sites: allSites, needs: ["projectId"], note: "H7: does the GSC branch swallow the audit branch at n=8", args: (c) => ({ project_id: c.projectId }) },
  { layer: "K0", scenario: "S1b", tool: "whats_next", sites: INVARIANT_SITE, needs: [], note: "project_id OMITTED — the multi-project summary branch. tool-analiz item 6(4) records it as never tested; after K0 the account holds eight projects, which is the first real input it has ever had. Lettered S1b, not S1, only because the cell key is site|tool|scenario and the per-project cell above already owns adstark|whats_next|S1", args: () => ({}) },
  { layer: "K0", scenario: "S1", tool: "connect_gsc", sites: allSites, needs: ["projectId"], note: "returns an OAuth link; the human clicks it, the harness does not", args: (c) => ({ project_id: c.projectId }) },
  { layer: "K0", scenario: "S3a", tool: "setup_project", sites: only("adstark"), needs: [], args: () => ({ domain: MALFORMED_TARGET }) },
  { layer: "K0", scenario: "S3a", tool: "get_job_status", sites: only("adstark"), needs: [], args: () => ({ job_id: MALFORMED_ID }) },
  { layer: "K0", scenario: "S3b", tool: "get_job_status", sites: only("adstark"), needs: [], args: () => ({ job_id: ABSENT_ID }) },
  { layer: "K0", scenario: "S3c", tool: "research_keywords", sites: only("adstark"), needs: [], note: "empty list violates minItems:1 — schema rejection, must never reach the vendor", args: () => ({ keywords: [] }) },

  // ---- K1 — on-page core. 20 + 30 + 15 + 5 per site. Feeds H1 H2 H4 H5.
  { layer: "K1", scenario: "S2", tool: "audit_onpage", sites: neverCrawled, needs: ["projectId"], note: "cold: no crawl to audit. Must THROW so withCredits releases (audit-shared.ts) — expected delta 0", args: (c) => ({ project_id: c.projectId }) },
  { layer: "K1", scenario: "S2", tool: "audit_tech", sites: neverCrawled, needs: ["projectId"], args: (c) => ({ project_id: c.projectId }) },
  { layer: "K1", scenario: "S2", tool: "audit_schema", sites: neverCrawled, needs: ["projectId"], args: (c) => ({ project_id: c.projectId }) },
  { layer: "K1", scenario: "S1", tool: "crawl_site", sites: campaignSites, needs: ["projectId"], note: "async: the 20 credits are reserved by the WORKER after enqueue, so the delta only lands once the job is terminal — the runner polls before reading the balance", args: (c) => ({ project_id: c.projectId }) },
  { layer: "K1", scenario: "S1", tool: "get_job_status", sites: campaignSites, needs: ["jobId"], note: "the terminal read of the crawl this run just enqueued", args: (c) => ({ job_id: c.jobId }) },
  { layer: "K1", scenario: "S1", tool: "audit_onpage", sites: campaignSites, needs: ["projectId"], note: "H1 multiple-h1 rate · H2 shared title suffix", args: (c) => ({ project_id: c.projectId }) },
  { layer: "K1", scenario: "S1", tool: "audit_tech", sites: campaignSites, needs: ["projectId"], note: "H5: compare 'Redirects surfaced' against curl-counted 3xx", args: (c) => ({ project_id: c.projectId }) },
  { layer: "K1", scenario: "S1", tool: "audit_schema", sites: campaignSites, needs: ["projectId"], args: (c) => ({ project_id: c.projectId }) },
  { layer: "K1", scenario: "S6a", tool: "crawl_site", sites: only("bigcattr"), needs: ["projectId"], note: "max_urls minimum, on a www site — the two S6 inputs at once. The MAXIMUM (100) is the default and every S1 crawl already exercises it, so it is not re-bought here", args: (c) => ({ project_id: c.projectId, max_urls: 1 }) },
  { layer: "K1", scenario: "S5", tool: "crawl_site", sites: only("adstark"), needs: ["projectId"], note: "does a second identical crawl charge again", args: (c) => ({ project_id: c.projectId }) },
  { layer: "K1", scenario: "S5", tool: "audit_onpage", sites: only("adstark", "seogrep"), needs: ["projectId"], note: "a re-audit of an unchanged crawl: same output, second charge?", args: (c) => ({ project_id: c.projectId }) },

  // ---- K2 — Search Console family. Only where consent was actually given. Feeds H3.
  { layer: "K2", scenario: "S2", tool: "pull_gsc_data", sites: gscNotConnected, needs: ["projectId"], note: "cold: no GSC connection at all", args: (c) => ({ project_id: c.projectId }) },
  { layer: "K2", scenario: "S2", tool: "find_quick_wins", sites: gscNotConnected, needs: ["projectId"], args: (c) => ({ project_id: c.projectId }) },
  { layer: "K2", scenario: "S2", tool: "detect_cannibalization", sites: gscNotConnected, needs: ["projectId"], args: (c) => ({ project_id: c.projectId }) },
  { layer: "K2", scenario: "S2", tool: "analyze_content_decay", sites: gscNotConnected, needs: ["projectId"], args: (c) => ({ project_id: c.projectId }) },
  { layer: "K2", scenario: "S1", tool: "pull_gsc_data", sites: gscConnected, needs: ["projectId"], args: (c) => ({ project_id: c.projectId }) },
  { layer: "K2", scenario: "S1", tool: "find_quick_wins", sites: gscConnected, needs: ["projectId"], args: (c) => ({ project_id: c.projectId }) },
  { layer: "K2", scenario: "S1", tool: "detect_cannibalization", sites: gscConnected, needs: ["projectId"], note: "H3: one brand/navigational false positive is enough to call the PR #45 filter insufficient", args: (c) => ({ project_id: c.projectId }) },
  { layer: "K2", scenario: "S1", tool: "analyze_content_decay", sites: gscConnected, needs: ["projectId"], args: (c) => ({ project_id: c.projectId }) },
  { layer: "K2", scenario: "S6a", tool: "pull_gsc_data", sites: gscConnected, needs: ["projectId"], note: "days minimum", args: (c) => ({ project_id: c.projectId, days: 7 }) },
  { layer: "K2", scenario: "S6b", tool: "pull_gsc_data", sites: gscConnected, needs: ["projectId"], note: "days maximum (= the default, bought once to pin the boundary)", args: (c) => ({ project_id: c.projectId, days: 90 }) },

  // ---- K3 — premium / vendor shape. Spread over DAYS: the DataForSEO ceiling is $3/day and
  // adding credits does not raise it. Feeds H6 H8 H9.
  { layer: "K3", scenario: "S1", tool: "research_keywords", sites: K3_DEFAULT, needs: [], note: "H6: keep the raw vendor shape and diff it against the seven fixtures", args: (c) => ({ keywords: [brandOf(c.site.domain)] }) },
  { layer: "K3", scenario: "S1", tool: "ranked_keywords", sites: K3_DEFAULT, needs: ["projectId"], note: "H8a/H8d: does project_id really use the project's domain, and does the ccTLD warning fire on .com.tr but not .com", args: (c) => ({ project_id: c.projectId }) },
  { layer: "K3", scenario: "S1", tool: "analyze_backlinks", sites: K3_DEFAULT, needs: ["projectId"], args: (c) => ({ project_id: c.projectId }) },
  { layer: "K3", scenario: "S1", tool: "compare_competitors", sites: K3_DEFAULT, needs: ["projectId"], args: (c) => ({ project_id: c.projectId }) },
  { layer: "K3", scenario: "S6a", tool: "ranked_keywords", sites: only("adstark"), needs: ["projectId"], note: "limit minimum — does a 1-row request change the vendor's response shape (H6)", args: (c) => ({ project_id: c.projectId, limit: 1 }) },
  { layer: "K3", scenario: "S6a", tool: "analyze_backlinks", sites: only("adstark"), needs: ["projectId"], note: "limit minimum: 1 referring domain and 1 anchor — the null-anchor variant of finding #15 lives here", args: (c) => ({ project_id: c.projectId, limit: 1 }) },
  { layer: "K3", scenario: "S6c", tool: "ranked_keywords", sites: only("rkturizm"), needs: ["projectId"], note: "H9: the same .com Turkish site at tr/2792 instead of the en/2840 default. This single pair decides whether migration 0021 is required or can be deferred", args: (c) => ({ project_id: c.projectId, language_code: "tr", location_code: 2792 }) },

  // ---- K4 — the report. Two sites, to see whether findings #8/#9/#10 breed again.
  // The cold cell runs FIRST and is the one this layer exists to buy. Finding #35's eight-tool
  // blast radius was found by grep, not by measurement, precisely because the 1st session only
  // ever called generate_report on two FULL projects — the empty-project branch, which is what a
  // new customer meets, had never been executed once. It must throw so withCredits releases:
  // expected delta 0, and a nonzero delta here is the finding.
  { layer: "K4", scenario: "S2", tool: "generate_report", sites: neverCrawled, needs: ["projectId"], note: "cold: nothing to report on. The branch #35 was never measured against", args: (c) => ({ project_id: c.projectId }) },
  { layer: "K4", scenario: "S1", tool: "generate_report", sites: campaignSites, needs: ["projectId"], note: "the customer-facing artefact, on all seven — #9 (wrong audience) and #10 (bare 'N pages skipped') are counted from these", args: (c) => ({ project_id: c.projectId }) },
]);

/**
 * S3 + S4, generated over ID_TOOLS so a tool shipped tomorrow cannot be skipped by omission.
 *
 * SITE COUNT IS DECIDED BY ARGUMENT VARIANCE, NOT BY SITE COUNT. The whole sweep authenticates
 * with one api key, so there is exactly ONE tenant in the run; issuing the same call from eight
 * "sites" is the same call eight times. So:
 *   S3a / S3b / S3c — the arguments are literal constants, identical on every site -> one site.
 *   S4             — the argument is a single run-level value (--foreign-project-id) -> one site.
 *   S3d            — the arguments DO vary (the site's own project_id and its own domain), and
 *                    the ccTLD question makes the domain shape load-bearing -> one .com.tr and
 *                    one .com. Eight would still be redundant.
 */
export function generatedIdCells() {
  return ID_TOOLS.flatMap((entry) => {
    const base = { layer: "K0", tool: entry.tool, sites: INVARIANT_SITE };
    const cells = [
      { ...base, scenario: "S3a", needs: [], args: () => ({ [entry.idArg]: MALFORMED_ID }) },
      { ...base, scenario: "S3b", needs: [], args: () => ({ [entry.idArg]: ABSENT_ID }) },
      {
        ...base,
        scenario: "S4",
        needs: ["foreignProjectId"],
        note: "another tenant's project: measure BOTH whether the message leaks existence and whether the balance moved",
        args: (c) => ({ [entry.idArg]: c.foreignProjectId }),
      },
    ];
    if (!entry.targetArg) return cells;
    return [
      ...cells,
      { ...base, scenario: "S3c", needs: [], args: () => ({ [entry.targetArg]: MALFORMED_TARGET }) },
      {
        ...base,
        scenario: "S3d",
        // Explicitly two sites, NOT K3_DEFAULT. K3_DEFAULT widened to all seven for Faz B because
        // the premium tools' OUTPUT varies per site; a rejection's output does not. The reasoning
        // above still holds, so it is pinned rather than left to follow a constant it only ever
        // shared by coincidence.
        sites: only("adstark", "rkturizm"),
        needs: ["projectId"],
        note: "PR #56: both supplied must be REJECTED, not silently resolved — and must burn 0 credits. Run on one .com.tr and one .com so the rejection is shown not to be domain-shaped",
        args: (c) => ({ [entry.idArg]: c.projectId, [entry.targetArg]: c.site.domain }),
      },
    ];
  });
}

/** Every plan entry, static and generated, in execution order. */
export function allEntries() {
  return [...PLAN, ...generatedIdCells()];
}

const matchesPrefix = (value, selectors) => selectors.some((s) => value === s || value.startsWith(s));

/**
 * Expand the matrix into cells. Pure: takes selectors, returns a fresh array, mutates nothing.
 * `--scenario=S3` matches S3a..S3d by prefix; `--layer=K0` matches exactly.
 */
export function buildCells({ layers = null, scenarios = null, siteKeys = null } = {}) {
  const sites = SITES.filter((s) => siteKeys === null || siteKeys.includes(s.key));
  return allEntries()
    .filter((e) => layers === null || layers.includes(e.layer))
    .filter((e) => scenarios === null || matchesPrefix(e.scenario, scenarios))
    .flatMap((entry) =>
      sites.filter(entry.sites).map((site) => ({
        key: `${site.key}|${entry.tool}|${entry.scenario}`,
        site: site.key,
        siteRef: site,
        tool: entry.tool,
        scenario: entry.scenario,
        layer: entry.layer,
        note: entry.note ?? SCENARIOS[entry.scenario].label,
        needs: entry.needs ?? [],
        argsOf: entry.args,
        unitCost: TOOL_COSTS[entry.tool],
        expectedCost: SCENARIOS[entry.scenario].charges ? TOOL_COSTS[entry.tool] : 0,
      })),
    );
}

/**
 * Projected spend, with the arithmetic a human can check. Sums expected_cost — so the
 * rejection scenarios contribute 0, which is the pre-registered claim, while `guardedCells`
 * reports how many of those sit on a tool that COULD charge if the claim is wrong.
 */
export function projectCost(cells) {
  const byTool = new Map();
  for (const cell of cells) {
    const row = byTool.get(cell.tool) ?? { tool: cell.tool, unit: cell.unitCost, cells: 0, charged: 0, guarded: 0 };
    byTool.set(cell.tool, {
      ...row,
      cells: row.cells + 1,
      charged: row.charged + (cell.expectedCost > 0 ? 1 : 0),
      guarded: row.guarded + (cell.expectedCost === 0 && cell.unitCost > 0 ? 1 : 0),
    });
  }
  const rows = [...byTool.values()].sort((a, b) => a.tool.localeCompare(b.tool));
  return {
    rows: rows.map((r) => ({ ...r, subtotal: r.charged * r.unit })),
    total: cells.reduce((sum, cell) => sum + cell.expectedCost, 0),
    guardedCells: cells.filter((c) => c.expectedCost === 0 && c.unitCost > 0).length,
  };
}

/** Cells that could reach a reserve at all — what --max-credits is required for. */
export const paidCells = (cells) => cells.filter((cell) => cell.unitCost > 0);

/**
 * The anti-"16 vs 19" guard, run BOTH ways. `liveToolNames` is null on the offline paths
 * (--dry-run, --self-test), where TOOL_COSTS is the authority instead.
 */
export function assertCoverage(liveToolNames, coveredToolNames, excluded = EXCLUDED) {
  // EXCLUDED is the only way a live tool may be absent from PLAN, so the REASON is what makes it a
  // decision rather than an escape hatch — and until 2026-08-27 nothing read it. Object.keys() alone
  // meant `{ ai_visibility: undefined }` silenced the gate exactly as well as a written argument
  // would, i.e. the mechanism the header calls "with a written reason" did not require one. A blank
  // exclusion is now a startup failure, before any coverage arithmetic runs.
  const unexplained = Object.entries(excluded)
    .filter(([, reason]) => typeof reason !== "string" || reason.trim().length === 0)
    .map(([name]) => name);
  if (unexplained.length > 0) {
    throw new Error(
      `coverage: ${unexplained.length} EXCLUDED tool(s) carry no written reason: ${unexplained.join(", ")}`,
    );
  }
  const covered = new Set([...coveredToolNames, ...Object.keys(excluded)]);
  const known = Object.keys(TOOL_COSTS);
  const uncovered = (liveToolNames ?? known).filter((name) => !covered.has(name));
  if (uncovered.length > 0) {
    throw new Error(
      `coverage: ${uncovered.length} tool(s) in neither PLAN nor EXCLUDED: ${uncovered.join(", ")}`,
    );
  }
  if (liveToolNames === null) return;
  const missingLocally = liveToolNames.filter((name) => !known.includes(name));
  const missingLive = known.filter((name) => !liveToolNames.includes(name));
  if (missingLocally.length > 0 || missingLive.length > 0) {
    throw new Error(
      `coverage: TOOL_COSTS and the live server disagree — only live: ${missingLocally.join(", ") || "-"}; only in TOOL_COSTS: ${missingLive.join(", ") || "-"}`,
    );
  }
}

/**
 * ID_TOOLS vs the live schemas. Catches three drifts: a tool that grew a project_id/target and
 * is missing from the table, a table row whose tool no longer takes that argument, and a table
 * row for a tool that no longer exists. Any of them would silently shrink the S3/S4 sweep.
 */
export function assertIdToolTable(liveTools) {
  const problems = [];
  const byName = new Map(liveTools.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
  for (const tool of liveTools) {
    const props = Object.keys(tool.inputSchema?.properties ?? {});
    const takesId = props.includes("project_id") || props.includes("target");
    const listed = ID_TOOLS.some((e) => e.tool === tool.name);
    if (takesId && !listed) problems.push(`${tool.name} accepts project_id/target but is not in ID_TOOLS`);
  }
  for (const entry of ID_TOOLS) {
    const props = byName.get(entry.tool);
    if (props === undefined) {
      problems.push(`${entry.tool} is in ID_TOOLS but the server does not serve it`);
      continue;
    }
    if (!(entry.idArg in props)) problems.push(`${entry.tool} no longer takes "${entry.idArg}"`);
    if (entry.targetArg !== null && !(entry.targetArg in props)) {
      problems.push(`${entry.tool} no longer takes "${entry.targetArg}"`);
    }
    if (entry.targetArg === null && "target" in props) {
      problems.push(`${entry.tool} grew a "target" argument — S3c/S3d are not being generated for it`);
    }
  }
  if (problems.length > 0) throw new Error(`ID_TOOLS drift:\n  - ${problems.join("\n  - ")}`);
}

export { TOOL_COSTS };
