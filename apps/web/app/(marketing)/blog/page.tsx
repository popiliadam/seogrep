import type { Metadata } from "next";
import Link from "next/link";
import { formatDate } from "../../../lib/format";
import { blogSource } from "../../../lib/source";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Notes from the team building SeoGrep: how the MCP tools work, what we ship, and what we learn running SEO from a chat window.",
};

export default function Page() {
  // Copy the loader's array before sorting — never mutate what the collection handed back.
  const posts = [...blogSource.getPages()].sort(
    (a, b) => Date.parse(b.data.date) - Date.parse(a.data.date),
  );

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-20">
      <div className="flex flex-col items-start gap-4">
        <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-accent-strong">
          <span aria-hidden="true" className="h-0.5 w-6 rounded-full bg-accent" />
          Blog
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">What we are building and learning</h1>
        <p className="max-w-2xl text-ink/70">
          Product notes, SEO workflows, and the thinking behind the tools SeoGrep gives your AI client.
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="mt-12 text-ink/70">No posts yet.</p>
      ) : (
        <ul className="mt-12 flex flex-col gap-8">
          {posts.map((post) => (
            <li key={post.url} className="border-t border-ink/10 pt-8">
              <article className="flex flex-col items-start gap-2">
                <time dateTime={post.data.date} className="text-sm text-ink/60">
                  {formatDate(post.data.date)}
                </time>
                <h2 className="text-xl font-semibold tracking-tight">
                  <Link href={post.url} className="hover:text-accent-strong">
                    {post.data.title}
                  </Link>
                </h2>
                <p className="max-w-2xl text-ink/70">{post.data.description}</p>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
