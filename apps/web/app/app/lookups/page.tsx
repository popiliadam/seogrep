import { buildDomainLookupHistory } from "../../../lib/projects/lookup-history";
import { createClient } from "../../../lib/supabase/server";
import { LookupHistoryList } from "./lookup-history-list";
import { listDomainLookupRuns } from "./read-lookup-runs";

/**
 * /app/lookups — every domain lookup this account has run, newest first.
 *
 * THE HOLE IT CLOSES. The three DataForSEO domain lookups (ranked_keywords 65, analyze_backlinks
 * 70, compare_competitors 90) each write a `domain_lookup_runs` row (migration 0027), and until
 * now the only reader of that table was the project card — which filters on `project_id` and
 * takes the newest row per tool. 0027's header states that `project_id` is nullable and that the
 * BARE-TARGET call, looking up somebody else's domain, is the commonest paid call these tools
 * serve; every one of those runs was therefore recorded and shown to nobody. This page shows them.
 *
 * It reads through the CALLER's authenticated client, so RLS `domain_lookup_runs_select_own` is
 * the real tenant scope, and it reads NOTHING else: no join to `projects`, because a run with no
 * project has no project name and inventing one would be the panel asserting what it did not
 * measure. It is READ-ONLY — this surface starts no lookup and spends no credit; the assistant
 * still runs the tools.
 *
 * The page itself decides nothing. `lib/projects/lookup-history.ts` turns the rows into entries
 * (including which runs may honestly be subtracted from which) and `lookup-history-list.tsx`
 * renders them, because vitest has no RSC boundary and a spec that rendered THIS function would be
 * more permissive than the runtime (signed lesson 12). The read lives in `read-lookup-runs.ts` so
 * the DB lane can execute the real query rather than a retyped copy of it.
 */
export default async function LookupsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Domain lookups</h1>
        <p className="text-sm text-neutral-600">Sign in to view your lookups.</p>
      </section>
    );
  }

  const history = buildDomainLookupHistory(await listDomainLookupRuns(supabase, user.id));

  return (
    <section>
      <header className="mb-10 animate-[rise_0.5s_ease-out_both]">
        <p className="m-0 mb-2.5 font-mono text-[11px] tracking-[0.14em] text-accent">DASHBOARD</p>
        <h1 className="m-0 mb-2 font-serif text-[34px] font-medium tracking-[-0.01em]">
          Domain lookups
        </h1>
        <p className="m-0 max-w-[68ch] font-serif text-[15px] leading-[1.6] text-muted">
          Every ranked_keywords, analyze_backlinks and compare_competitors run on this account,
          newest first — including the ones you ran against a bare domain rather than one of your
          projects. A change is shown only where two runs measured the same thing.
        </p>
      </header>
      <div className="animate-[rise_0.5s_ease-out_0.06s_both]">
        <LookupHistoryList history={history} />
      </div>
      <p className="m-0 mt-10 border border-dashed border-hairline-mid px-7 py-6 font-mono text-[12.5px] leading-[1.8] text-faint animate-[rise_0.5s_ease-out_0.12s_both]">
        <span className="text-accent">tip</span> · ask your assistant to{" "}
        <span className="text-body">“look up ranked keywords”</span> for any domain — yours or a
        competitor&apos;s — and the run lands here.
      </p>
    </section>
  );
}
