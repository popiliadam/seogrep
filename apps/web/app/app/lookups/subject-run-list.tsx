import { formatDate } from "../../../lib/format";
import {
  SUBJECT_RUN_HISTORY_LIMIT,
  describeSubjectKind,
  type SubjectRunHistory,
  type SubjectRunHistoryEntry,
} from "../../../lib/projects/subject-history";

/**
 * The /app/lookups discovery + AI-visibility table — presentation only, and in its own module so a
 * spec can RENDER it. `page.tsx` is an async Server Component that talks to PostgREST; nothing in
 * the fast lane executes one (signed lesson 12), so the markup would otherwise be tested by
 * nothing at all. Its two neighbours are split from the same page for the same reason.
 *
 * Deliberately NOT a client module: it has no state and no handlers, so it renders on the server
 * like the two tables above it.
 */

/**
 * How many subject values a row prints before it says "+N more".
 *
 * A seed set may hold two hundred keywords and the column would otherwise be the whole page. Six
 * is enough to recognise a set at a glance; the KIND caption beside it carries the count, so the
 * truncation never hides the SIZE of what was measured — only the words.
 */
const SUBJECT_SHOWN = 6;

function Subject({ entry }: { entry: SubjectRunHistoryEntry }) {
  const shown = entry.subject.slice(0, SUBJECT_SHOWN);
  const hidden = entry.subject.length - shown.length;
  return (
    <>
      <span className="block font-serif text-[15px] leading-[1.5]">{shown.join(", ")}</span>
      {/*
        THE KIND IS PRINTED, not inferred. `subject_kind` is half of 0032's identity: the same word
        can be a keyword on one row and a seed on the next, and those are different subjects asked
        different questions. A reader who cannot see the kind cannot tell the two rows apart.
      */}
      <span className="block font-mono text-[11px] text-faint">
        {describeSubjectKind(entry.subjectKind, entry.subject.length)}
        {hidden > 0 ? ` · +${hidden} more` : ""}
      </span>
    </>
  );
}

export function SubjectRunList({ history }: { history: SubjectRunHistory }) {
  if (history.entries.length === 0) {
    return (
      <div className="border border-dashed border-hairline-mid bg-card px-8 py-14 text-center">
        <p aria-hidden="true" className="m-0 mb-3.5 font-mono text-[12px] text-faint">
          $ discover_keywords → no runs recorded
        </p>
        {/*
          WHAT WAS MEASURED. This read covers every discovery and AI-visibility run on the account
          with no scope of any kind, so no qualifier about scope is needed. The word that IS
          load-bearing is RECORDED: the table records a run at the moment it happens, so a run from
          before it existed is not in it, and "you have never done this" is a claim about the
          tenant that this page cannot make.
        */}
        <p className="m-0 mb-2 font-serif text-[22px] font-medium">
          No discovery or AI visibility runs recorded yet.
        </p>
        <p className="mx-auto m-0 max-w-[52ch] font-serif text-[15px] leading-[1.6] text-muted">
          Ask your assistant to discover keywords from a seed or a domain, or to check how a domain
          is mentioned in an AI assistant&apos;s answers, and the run lands here — what was looked
          up, what was asked about it, and what came back.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse border-t border-ink text-left">
          <thead>
            <tr className="border-b border-hairline font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">
              <th scope="col" className="py-2.5 pr-5 font-normal">
                Subject
              </th>
              <th scope="col" className="py-2.5 pr-5 font-normal">
                Lookup
              </th>
              <th scope="col" className="py-2.5 pr-5 font-normal">
                Market
              </th>
              <th scope="col" className="py-2.5 pr-5 font-normal">
                What it found
              </th>
              <th scope="col" className="w-[120px] py-2.5 font-normal">
                Ran
              </th>
            </tr>
          </thead>
          <tbody>
            {history.entries.map((entry: SubjectRunHistoryEntry, index: number) => (
              <tr
                // One ai_visibility_compare call writes up to ten rows sharing a timestamp to the
                // microsecond, and two of them may even share a subject across two calls — so the
                // list POSITION is part of the key. The read's total order is what makes that
                // stable between renders.
                key={`${entry.tool}-${entry.subject.join("\u0000")}-${entry.createdAt}-${index}`}
                className="border-b border-hairline align-baseline transition-colors duration-150 hover:bg-card"
              >
                <td className="py-[15px] pr-5">
                  <Subject entry={entry} />
                </td>
                <td className="py-[15px] pr-5">
                  <span className="block font-mono text-[11.5px] text-body">{entry.tool}</span>
                  {/*
                    WHAT WAS ASKED about the subject — the mode, or the assistant. Not recoverable
                    from the subject or its kind: "suggestions" and "related" produce identical
                    rows otherwise, and an AI answer is scoped to ONE platform.
                  */}
                  {entry.question ? (
                    <span className="block font-mono text-[11px] text-faint">{entry.question}</span>
                  ) : null}
                  {entry.scope === "bare-subject" ? null : (
                    <span className="block font-mono text-[11px] text-faint">for your project</span>
                  )}
                </td>
                <td className="whitespace-nowrap py-[15px] pr-5 font-mono text-[11.5px] text-faint">
                  {entry.market ?? <span className="text-faintest">not recorded</span>}
                </td>
                <td className="py-[15px] pr-5 font-serif text-[14.5px] leading-[1.55]">
                  {/*
                    A run whose report could not be read shows its subject and NO numbers — never a
                    0. The stored counters are the vendor's answer projected once; a missing one
                    means "not readable", which is not the same claim as "nothing was found".

                    There is no change clause on this table at all, and that is a decision with
                    three separate reasons — see lib/projects/subject-history.ts.
                  */}
                  {entry.summary ?? (
                    <span className="font-mono text-[12px] text-faintest">no numbers recorded</span>
                  )}
                </td>
                <td className="whitespace-nowrap py-[15px] font-mono text-[12px] text-faint">
                  <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/*
        THE CEILING, DISCLOSED WHEN IT BITES — both siblings' rule, same mechanism. `windowFull` is
        set from the read's overflow probe, a run older than the last listed one that was actually
        fetched and then dropped, and never from "the read came back full". It bites sooner here
        than next door: one comparison writes a row per compared target, so ten rows can come from
        a single call.
      */}
      {history.windowFull ? (
        <p className="m-0 mt-6 font-mono text-[11.5px] leading-[1.7] text-faint">
          Showing the most recent {SUBJECT_RUN_HISTORY_LIMIT} runs. Older runs exist and are not on
          this page. One comparison records one run per compared target, so this page fills faster
          than the number of calls you made.
        </p>
      ) : null}
    </>
  );
}
