import type { ReactNode } from "react";
import Link from "next/link";
import type { AuditLine } from "../../../lib/projects/audits";
import type { ProjectCard } from "../../../lib/projects/card";
import type { InsightLine } from "../../../lib/projects/insights";
import { formatStamp, type CrawlHistoryEntry } from "../../../lib/projects/history";
import { formatDate } from "../../../lib/format";

/**
 * The read-only presentation of /app/projects. Pure, stateless Server Components: no data
 * access, no client interactivity, no directive — every decision was already made by
 * `lib/projects/card.ts`, so these functions only choose words.
 *
 * They live in their own module so the RENDER can be tested without rendering the page: vitest
 * has no RSC boundary, so a spec that mounted an async page component would be more permissive
 * than the runtime (signed lesson 12). These are synchronous and take plain data.
 */

/** One labelled fact inside a card. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-7 py-5">
      <span className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">{label}</span>
      <span className="font-serif text-[16px] leading-[1.5] text-body">{children}</span>
    </div>
  );
}

/**
 * The Search Console line. Three states, and the middle one exists because the row and the
 * mapping are separate things since migration 0021: an account can be linked while no property
 * has been matched to the project yet, and saying "Not connected" there would send the user to
 * re-do an OAuth flow that already succeeded.
 */
function GscLine({ card }: { card: ProjectCard }) {
  if (card.gsc.kind === "not_connected") {
    return <Fact label="Search Console">Not connected</Fact>;
  }
  if (card.gsc.property === null) {
    return <Fact label="Search Console">Connected — no property matched yet</Fact>;
  }
  return (
    <Fact label="Search Console">
      <span className="break-all font-mono text-[13px]">{card.gsc.property}</span>
    </Fact>
  );
}

/** The last successful crawl: when it ran, and core's summary of it when the result is readable. */
function CrawlLine({ card }: { card: ProjectCard }) {
  if (card.crawl === null) {
    return <Fact label="Last crawl">No crawl yet</Fact>;
  }
  return (
    <Fact label="Last crawl">
      <time dateTime={card.crawl.createdAt}>{formatDate(card.crawl.createdAt)}</time>
      {card.crawl.summary ? (
        <span className="mt-1 block font-mono text-[11px] leading-[1.6] text-faint">{card.crawl.summary}</span>
      ) : null}
    </Fact>
  );
}

/**
 * One run's lifecycle stamps, in the order they happen and only the ones that exist. A queued run
 * has neither a start nor a finish, and a running one has no finish — printing an empty slot for
 * each would suggest a missing value rather than a job that has not got there yet.
 */
function RunStamps({ entry }: { entry: CrawlHistoryEntry }) {
  const stamps: readonly { label: string; iso: string }[] = [
    { label: "created", iso: entry.createdAt },
    ...(entry.startedAt === null ? [] : [{ label: "started", iso: entry.startedAt }]),
    ...(entry.finishedAt === null ? [] : [{ label: "finished", iso: entry.finishedAt }]),
  ];
  return (
    <span className="font-mono text-[11px] text-faint">
      {stamps.map((stamp, index) => (
        <span key={stamp.label}>
          {index === 0 ? null : " · "}
          {stamp.label} <time dateTime={stamp.iso}>{formatStamp(stamp.iso)}</time>
        </span>
      ))}
    </span>
  );
}

/**
 * The crawl trail: the last few `crawl_site` runs whatever they did, newest first.
 *
 * It exists because the fact line above shows the newest SUCCEEDED crawl, which is the honest
 * thing to summarize and hides the two states a user most needs to see: a run still QUEUED (the
 * card looks unchanged and the user re-runs the tool), and a run that FAILED (the card silently
 * keeps showing a three-week-old success). The failure's own message is printed — "it failed" a
 * user cannot act on is barely better than not saying it.
 *
 * `<details>` because it is native: this file is a Server Component with no directive, so there
 * is no client bundle to open a panel with, and none is needed. Nothing renders when the project
 * has never been crawled — the "No crawl yet" fact line already says that, once.
 */
function CrawlHistory({ entries }: { entries: readonly CrawlHistoryEntry[] }) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <details className="border-t border-hairline px-7 py-3.5">
      <summary className="cursor-pointer font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint transition-colors duration-150 hover:text-accent">
        Recent crawls
      </summary>
      <ol className="m-0 mt-3 flex list-none flex-col gap-2.5 p-0">
        {entries.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-0.5">
            {/* The database's own status word, never a panel-invented synonym: the user has to
                be able to match this against what get_job_status told the assistant. */}
            <span className="font-mono text-[11.5px] text-body">{entry.status}</span>
            <RunStamps entry={entry} />
            {entry.error === null ? null : (
              <span className="break-all font-mono text-[11px] text-negative">{entry.error}</span>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * The three audits, each with the date of its last run and that run's numbers — or, when it has
 * never run, the tool to ask for.
 *
 * ALL THREE ALWAYS, including the ones that never ran: the absence is the more useful half, and a
 * list that quietly omitted them would leave a user who has never run audit_schema with nothing
 * to notice. The empty line names the MCP tool rather than offering a button, because this panel
 * starts nothing — audits run through the assistant and land here.
 */
function AuditLines({ lines }: { lines: readonly AuditLine[] }) {
  return (
    <div className="border-t border-hairline px-7 py-4">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">Audits</span>
      <ol className="m-0 mt-2.5 flex list-none flex-col gap-2 p-0">
        {lines.map((line) => (
          <li key={line.tool} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="font-mono text-[12.5px] text-body">{line.tool}</span>
            {line.run === null ? (
              <span className="font-serif text-[13.5px] text-muted">
                Not run yet — ask your assistant to run {line.tool}
              </span>
            ) : (
              <>
                <time className="font-mono text-[11px] text-faint" dateTime={line.run.createdAt}>
                  {formatDate(line.run.createdAt)}
                </time>
                {/* No numbers when the stored report could not be read: the date still says the
                    audit ran, and inventing a 0 would say it found nothing. */}
                {line.run.summary === null ? null : (
                  <span className="font-mono text-[11px] text-faint">{line.run.summary}</span>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The three Search Console analyses, each with the date of its last run and that run's numbers —
 * or, when it has never run, the tool to ask for. The twin of `AuditLines`, and deliberately the
 * same shape: they are the same kind of fact about a project (a paid analysis that either ran or
 * did not), and giving them two different layouts would suggest a difference that is not there.
 */
function InsightLines({ lines }: { lines: readonly InsightLine[] }) {
  return (
    <div className="border-t border-hairline px-7 py-4">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">
        Search Console insights
      </span>
      <ol className="m-0 mt-2.5 flex list-none flex-col gap-2 p-0">
        {lines.map((line) => (
          <li key={line.tool} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="font-mono text-[12.5px] text-body">{line.tool}</span>
            {line.run === null ? (
              <span className="font-serif text-[13.5px] text-muted">
                Not run yet — ask your assistant to run {line.tool}
              </span>
            ) : (
              <>
                <time className="font-mono text-[11px] text-faint" dateTime={line.run.createdAt}>
                  {formatDate(line.run.createdAt)}
                </time>
                {/* No numbers when the stored report could not be read: the date still says the
                    analysis ran, and inventing a 0 would say it found nothing. */}
                {line.run.summary === null ? null : (
                  <span className="font-mono text-[11px] text-faint">{line.run.summary}</span>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The last Search Console pull: when it ran, what window it covered, and whether that window was
 * truncated.
 *
 * The date alone used to be the whole line, and it is the weaker half — the same pull date can sit
 * over a 7-day or a 90-day window, and every number the discovery tools print off it means
 * something different. The cap warning is separate and louder because it is a statement about
 * COMPLETENESS: an analysis run over a truncated pull reports ghost decay and computes
 * cannibalization shares against a short denominator, which is exactly what the MCP tools warn
 * about in their own footer.
 */
function PullLine({ card }: { card: ProjectCard }) {
  if (card.pullAt === null) {
    return <Fact label="Last Search Console pull">No pull yet</Fact>;
  }
  return (
    <Fact label="Last Search Console pull">
      <time dateTime={card.pullAt}>{formatDate(card.pullAt)}</time>
      {card.pullWindow === null ? null : (
        <>
          <span className="mt-1 block font-mono text-[11px] leading-[1.6] text-faint">
            {card.pullWindow.range}
          </span>
          {card.pullWindow.capped ? (
            <span className="mt-1 block font-mono text-[11px] leading-[1.6] text-negative">
              Hit the row cap — this data may be partial.
            </span>
          ) : null}
        </>
      )}
    </Fact>
  );
}

/** One project: what it is, what has been read for it, and the one thing to do next. */
export function ProjectCardView({ card }: { card: ProjectCard }) {
  return (
    <li className="border border-hairline bg-card">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline px-7 py-5">
        <h2 className="m-0 break-all font-mono text-[16px] font-semibold">{card.domain}</h2>
        <span className="font-mono text-[11px] text-faint">
          Added <time dateTime={card.createdAt}>{formatDate(card.createdAt)}</time>
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 sm:divide-x sm:divide-hairline">
        <CrawlLine card={card} />
        <GscLine card={card} />
        <PullLine card={card} />
      </div>

      <AuditLines lines={card.audits} />

      <InsightLines lines={card.insights} />

      <CrawlHistory entries={card.recentCrawls} />

      {/* The SAME recommendation whats_next gives, so the panel and the assistant never
          disagree — see lib/projects/parity.test.ts. */}
      <div className="flex flex-col gap-0.5 border-l-2 border-l-accent bg-paper px-7 py-3.5">
        <span className="font-mono text-[12.5px] font-semibold text-ink">
          Next step: run {card.nextStep.primary}
        </span>
        <span className="font-serif text-[14px] text-muted">{card.nextStep.reason}</span>
      </div>
    </li>
  );
}

/**
 * Every tracked project, oldest first — or the empty state, which points at the ONE tool that
 * creates a project. Nothing here invents a second creation path: the empty state names the MCP
 * call (setup_project) and the form above is the panel's single write.
 */
export function ProjectList({ cards }: { cards: readonly ProjectCard[] }) {
  if (cards.length === 0) {
    return (
      <div className="border border-dashed border-hairline-mid bg-card px-8 py-14 text-center">
        <p aria-hidden="true" className="m-0 mb-3.5 font-mono text-[12px] text-faint">
          $ list_projects → 0 results
        </p>
        <p className="m-0 mb-2 font-serif text-[22px] font-medium">No projects yet.</p>
        <p className="mx-auto mb-5 mt-0 max-w-[46ch] font-serif text-[15px] leading-[1.6] text-muted">
          Ask your assistant to run the setup_project tool with your website domain — for example
          “set up example.com” — and it will show up here.
        </p>
        <Link
          href="/app/connection"
          className="border-b border-accent pb-0.5 font-mono text-[12px] transition-colors duration-150"
        >
          Set up your MCP URL first <span aria-hidden="true">→</span>
        </Link>
      </div>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-7 p-0">
      {cards.map((card) => (
        <ProjectCardView key={card.projectId} card={card} />
      ))}
    </ul>
  );
}
