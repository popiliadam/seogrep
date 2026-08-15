/**
 * Pull-result summarizing — PURE: no I/O, no DB client, no runtime dependency.
 *
 * The sibling of `crawl-summary.ts`, and it exists for the same reason the crawl one does: a
 * stored `jobs.result` is jsonb of unknown shape, and `get_job_status` should be able to say
 * WHAT a finished job produced rather than only that it finished. Until now only crawls got a
 * detail line, so a succeeded `pull_gsc_data` job read as a bare "succeeded" — the user had to
 * spend a discovery tool to find out whether the pull had returned 4 rows or 40,000, or whether
 * it had been truncated at the row cap.
 *
 * IN CORE for the crawl summarizer's reason too: both runtimes read the same blob, and a second
 * copy of "how many rows, over which window, was it capped" would be a second place for the MCP
 * tool and apps/web to disagree.
 *
 * THE TWO SUMMARIZERS ARE MUTUALLY EXCLUSIVE BY SHAPE, not by tool name. A crawl result is
 * `{ pages[], skipped[] }`; a pull result is `{ current: {rows[]}, previous: {rows[]} }`. Neither
 * satisfies the other's guard, so `get_job_status` can try both in either order and get at most
 * one answer — no `job.tool` string has to be trusted, and a job whose tool name drifts still
 * gets summarized correctly.
 */

import type { Json } from "./crawl-summary.js";

/** A readable object, or null for anything else (including arrays and null). */
function asObject(value: Json | undefined): { [key: string]: Json | undefined } | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/** One window's facts, or null when the value is not shaped like a window. */
interface WindowFacts {
  readonly rowCount: number;
  readonly range: string | null;
  readonly capped: boolean;
}

/**
 * Read one stored window. Requires a `rows` ARRAY — that is the load-bearing half of the guard
 * that keeps this summarizer off every other result shape — but tolerates missing dates, since
 * a window with no readable range still has a row count worth reporting.
 */
function windowFacts(value: Json | undefined): WindowFacts | null {
  const obj = asObject(value);
  if (!obj || !Array.isArray(obj.rows)) return null;
  const start = typeof obj.start_date === "string" ? obj.start_date : null;
  const end = typeof obj.end_date === "string" ? obj.end_date : null;
  return {
    rowCount: obj.rows.length,
    range: start !== null && end !== null ? `${start} → ${end}` : null,
    capped: obj.capped === true,
  };
}

/**
 * Summarize a `pull_gsc_data` result for the status line: how many (query, page) rows landed in
 * each window, the dates they cover, and whether the fetch was truncated at the row cap.
 *
 * Defensive in the crawl summarizer's exact discipline — anything that is not a
 * `{ current: {rows[]}, previous: {rows[]} }` object yields null and the caller reports success
 * with no detail line.
 *
 * The CAP NOTE is the part that earns its place. A capped window means Google had more rows than
 * were fetched, so every discovery tool downstream is reasoning about a truncated slice of the
 * site — and the number in front of it looks exactly like a complete one. It is appended rather
 * than folded into the count for the same reason the crawl summary appends its skip reason: the
 * count keeps its shape, and the caveat cannot be mistaken for part of it.
 */
export function summarizePullResult(result: Json | null): string | null {
  const obj = asObject(result ?? undefined);
  if (!obj) return null;
  const current = windowFacts(obj.current);
  const previous = windowFacts(obj.previous);
  if (!current || !previous) return null;

  const days = typeof obj.days === "number" && Number.isFinite(obj.days) ? obj.days : null;
  const span = days === null ? "Search Console data" : `${days} day(s) of Search Console data`;
  const where = typeof obj.property === "string" && obj.property.length > 0 ? ` for ${obj.property}` : "";
  const over = current.range === null ? "" : ` (${current.range})`;
  const head =
    `Pulled ${span}${where}: ${current.rowCount} row(s)${over}, ` +
    `${previous.rowCount} in the previous window`;
  return `${head}${cappedNote(current.capped, previous.capped)}`;
}

/**
 * Name a truncated fetch, and say WHICH window was truncated. "Some of your data is missing" is
 * a different instruction depending on the answer: a capped CURRENT window means today's quick
 * wins are drawn from a partial site, while a capped PREVIOUS one means the decay comparison has
 * an unfair baseline and will invent drops that never happened.
 */
function cappedNote(current: boolean, previous: boolean): string {
  if (!current && !previous) return "";
  const which = current && previous ? "both windows" : current ? "the current window" : "the previous window";
  return (
    ` — the row limit was reached in ${which}, so this is a PARTIAL view of the property and the ` +
    "findings drawn from it are incomplete; re-run with a shorter days range to fit under the cap"
  );
}
