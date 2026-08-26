import Link from "next/link";
import { createClient } from "../../../../lib/supabase/server";
import { loadProjectCards } from "../page";
import { ProjectList } from "../project-list";

/**
 * /app/projects/[id] — one project, in full.
 *
 * WHY THIS ROUTE EXISTS. Measured 2026-08-26: /app/projects rendered fifteen complete cards on one
 * page — three fact lines plus the audit, insight, lookup and crawl-history blocks each — and no
 * project route existed anywhere under /app to go to. Every card carried detail, and detail had
 * nowhere to be. Nothing was deleted to fix that; the blocks moved here, where one site has the
 * page to itself, and the list kept the facts and the next step.
 *
 * IT BUILDS ITS CARD THROUGH `loadProjectCards`, the list's own composition, narrowed to one id.
 * A second copy of those reads would be a second place for the tenant filters to be forgotten and
 * two surfaces that could disagree about one project. The narrowing happens AFTER a tenant-scoped
 * read, so an id belonging to another tenant and an id that does not exist come back the same way
 * — the property the by-id MCP tools hold, on the surface that shares their data.
 *
 * The /app layout guards the session; the read below goes through the caller's AUTHENTICATED
 * client, so RLS is the real gate.
 */
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Project</h1>
        <p className="text-sm text-neutral-600">Sign in to view this project.</p>
      </section>
    );
  }

  const cards = await loadProjectCards(supabase, user.id, id);
  const card = cards[0];

  if (card === undefined) {
    // ONE sentence for both "no such project" and "not yours", deliberately: two different
    // answers would turn this page into a way to find out which ids exist. It also covers an
    // ARCHIVED project, which the list read excludes — untracking is reversible, and the sentence
    // says so rather than implying the work is gone.
    return (
      <section className="flex flex-col gap-3">
        <h1 className="m-0 font-serif text-[28px] font-medium">Project not found</h1>
        <p className="m-0 max-w-[60ch] font-serif text-[15px] leading-[1.6] text-muted">
          No tracked project with that id. It may have been untracked — nothing is deleted when it
          is, and running setup_project with the same domain brings it back on the same id.
        </p>
        <Link href="/app/projects" className="font-mono text-[12px] text-muted hover:text-accent">
          <span aria-hidden="true">←</span> All projects
        </Link>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-8 animate-[rise_0.5s_ease-out_both]">
        <Link
          href="/app/projects"
          className="font-mono text-[11px] tracking-[0.14em] text-accent transition-colors duration-150 hover:text-ink"
        >
          <span aria-hidden="true">←</span> ALL PROJECTS
        </Link>
        <h1 className="m-0 mb-2 mt-3 break-all font-serif text-[34px] font-medium tracking-[-0.01em]">
          {card.domain}
        </h1>
        <p className="m-0 max-w-[64ch] font-serif text-[15px] leading-[1.6] text-muted">
          Everything read for this site, and the same next step the whats_next tool gives. Crawls,
          audits and Search Console pulls all run through your assistant.
        </p>
      </div>

      <div className="animate-[rise_0.5s_ease-out_0.08s_both]">
        <ProjectList detail cards={[card]} />
      </div>
    </section>
  );
}
