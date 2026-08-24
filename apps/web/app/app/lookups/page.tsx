import { buildKeywordRunHistory } from "../../../lib/projects/keyword-history";
import { buildDomainLookupHistory } from "../../../lib/projects/lookup-history";
import { buildSubjectRunHistory } from "../../../lib/projects/subject-history";
import { createClient } from "../../../lib/supabase/server";
import { KeywordRunList } from "./keyword-run-list";
import { LookupHistoryList } from "./lookup-history-list";
import { SubjectRunList } from "./subject-run-list";
import { listKeywordResearchRuns } from "./read-keyword-runs";
import { listDomainLookupRuns } from "./read-lookup-runs";
import { listSubjectLookupRuns } from "./read-subject-runs";

/**
 * /app/lookups — every lookup this account has run, newest first, in THREE sections.
 *
 * THE HOLE IT CLOSES. The DataForSEO lookups each write a run row and, until each of those tables
 * existed, printed a table inside the request and vanished. The DOMAIN lookups got migration 0027
 * (ranked_keywords 65, analyze_backlinks 70, compare_competitors 90) and then migration 0031,
 * which widened the same table's `tool` CHECK to cover the four that shipped afterwards with the
 * identical input shape and the identical amnesia — backlink_changes 35, backlink_details 35,
 * disavow_candidates 40, my_pages 40. The project card reads that table filtered on `project_id`
 * (and only for the first three), so this page was built for the bare-target runs that card can
 * never show, and it now shows all SEVEN tools without a new section: they are one shape, keyed by
 * a domain. research_keywords (25) is a DFS tool 0027 deliberately excluded, because a keyword LIST
 * has no domain; migration 0029 gives it its own table and the second section below is its first
 * and only reader.
 *
 * THE THIRD SECTION is migration 0032's `subject_lookup_runs`: discover_keywords (40),
 * ai_visibility (90) and ai_visibility_compare (90 PER COMPARED TARGET), the three DFS tools whose
 * subject is not a domain and not always the same KIND of thing twice. One comparison writes one
 * row per compared target, so a row there is a measured SUBJECT rather than a call.
 *
 * THREE TABLES RATHER THAN ONE, and that is a decision rather than laziness. A keyword-set run has
 * no domain and no project, so the domain table's `Domain` and `Ran for` columns would be blank on
 * every keyword row, and its `Lookup` column would carry a single repeated value; a union row with
 * dead columns is not a shared shape. The third table fails the same test in both directions: its
 * rows have no single domain column to fill, and neither of the first two has anywhere to put the
 * SUBJECT KIND that is half of 0032's identity, nor the platform or mode that say what was asked.
 * What the three sections DO share is the page, because a tenant asking "what have I spent
 * DataForSEO credits on" is asking one question — and a SERIES would not have shared it, which is
 * why the rank tracker got /app/rankings instead.
 *
 * It reads through the CALLER's authenticated client, so RLS is the real tenant scope on both
 * tables, and it reads NOTHING else: no join to `projects`, because a run with no project has no
 * project name and inventing one would be the panel asserting what it did not measure. It is
 * READ-ONLY — this surface starts no lookup and spends no credit; the assistant still runs the
 * tools.
 *
 * The page itself decides nothing. `lib/projects/lookup-history.ts`,
 * `lib/projects/keyword-history.ts` and `lib/projects/subject-history.ts` turn rows into entries
 * (including which runs may honestly be subtracted from which — the third module's answer is NONE
 * of them, for three separate stated reasons) and the three list components render them, because
 * vitest has no RSC boundary and a spec that rendered THIS function would be more permissive than
 * the runtime (signed lesson 12). All three reads live in their own modules so the DB lane can
 * execute the real queries rather than retyped copies of them.
 */
export default async function LookupsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Lookups</h1>
        <p className="text-sm text-neutral-600">Sign in to view your lookups.</p>
      </section>
    );
  }

  // Sequential rather than concurrent, matching every other panel read in this app: three small
  // bounded reads on one connection, and a failure in any must take the page down (see the read
  // modules — an empty list is a claim none of them may make on the database's behalf).
  const domainHistory = buildDomainLookupHistory(await listDomainLookupRuns(supabase, user.id));
  const keywordHistory = buildKeywordRunHistory(await listKeywordResearchRuns(supabase, user.id));
  const subjectHistory = buildSubjectRunHistory(await listSubjectLookupRuns(supabase, user.id));

  return (
    <section>
      <header className="mb-10 animate-[rise_0.5s_ease-out_both]">
        <p className="m-0 mb-2.5 font-mono text-[11px] tracking-[0.14em] text-accent">DASHBOARD</p>
        <h1 className="m-0 mb-2 font-serif text-[34px] font-medium tracking-[-0.01em]">Lookups</h1>
        <p className="m-0 max-w-[68ch] font-serif text-[15px] leading-[1.6] text-muted">
          Every DataForSEO lookup recorded on this account, newest first — the domain ones,
          including those you ran against a bare domain rather than one of your projects, the
          keyword research runs, and the keyword discovery and AI visibility runs. A change is
          shown only where two runs measured the same thing.
        </p>
      </header>

      <div className="animate-[rise_0.5s_ease-out_0.06s_both]">
        <h2 className="m-0 mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
          Domain lookups
        </h2>
        <LookupHistoryList history={domainHistory} />
      </div>

      <div className="mt-14 animate-[rise_0.5s_ease-out_0.09s_both]">
        <h2 className="m-0 mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
          Keyword research
        </h2>
        <KeywordRunList history={keywordHistory} />
      </div>

      <div className="mt-14 animate-[rise_0.5s_ease-out_0.12s_both]">
        <h2 className="m-0 mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
          Discovery and AI visibility
        </h2>
        <SubjectRunList history={subjectHistory} />
      </div>

      <p className="m-0 mt-10 border border-dashed border-hairline-mid px-7 py-6 font-mono text-[12.5px] leading-[1.8] text-faint animate-[rise_0.5s_ease-out_0.15s_both]">
        <span className="text-accent">tip</span> · ask your assistant to{" "}
        <span className="text-body">“look up ranked keywords”</span> for any domain — yours or a
        competitor&apos;s — or to{" "}
        <span className="text-body">“check search volume”</span> for a list of keywords, and the run
        lands here.
      </p>
    </section>
  );
}
