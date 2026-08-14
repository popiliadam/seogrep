import type { ReactNode } from "react";
import type { ProjectCard } from "../../../lib/projects/card";
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
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-neutral-500">{label}</span>
      <span className="text-sm text-neutral-700">{children}</span>
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
      <span className="break-all">{card.gsc.property}</span>
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
        <span className="block text-neutral-600">{card.crawl.summary}</span>
      ) : null}
    </Fact>
  );
}

/** One project: what it is, what has been read for it, and the one thing to do next. */
export function ProjectCardView({ card }: { card: ProjectCard }) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold break-all">{card.domain}</h2>
        <span className="text-xs text-neutral-500">
          Added <time dateTime={card.createdAt}>{formatDate(card.createdAt)}</time>
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <CrawlLine card={card} />
        <GscLine card={card} />
        <Fact label="Last Search Console pull">
          {card.pullAt === null ? (
            "No pull yet"
          ) : (
            <time dateTime={card.pullAt}>{formatDate(card.pullAt)}</time>
          )}
        </Fact>
      </div>

      {/* The SAME recommendation whats_next gives, so the panel and the assistant never
          disagree — see lib/projects/parity.test.ts. */}
      <div className="flex flex-col gap-0.5 rounded-md bg-neutral-50 p-3">
        <span className="text-sm font-medium text-neutral-900">
          Next step: run {card.nextStep.primary}
        </span>
        <span className="text-sm text-neutral-600">{card.nextStep.reason}</span>
      </div>
    </li>
  );
}

/**
 * Every tracked project, oldest first — or the empty state, which points at the ONE tool that
 * creates a project. Nothing on this page can create one: /app/projects is read-only, so the
 * empty state has to name the MCP call rather than offer a button that does not exist.
 */
export function ProjectList({ cards }: { cards: readonly ProjectCard[] }) {
  if (cards.length === 0) {
    return (
      <p className="text-sm text-neutral-600">
        No projects yet. Ask your assistant to run the setup_project tool with your website
        domain — for example “set up example.com” — and it will show up here.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {cards.map((card) => (
        <ProjectCardView key={card.projectId} card={card} />
      ))}
    </ul>
  );
}
