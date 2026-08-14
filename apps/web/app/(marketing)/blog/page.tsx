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
    <section className="mx-auto w-full max-w-[880px] px-5 pb-24 pt-16 sm:px-8">
      <div className="mb-14 flex justify-between font-mono text-[12px] tracking-[0.06em] text-faint animate-[rise_0.7s_ease-out_both]">
        <span>SEOGREP(1)</span>
        <span>CHANGELOG &amp; NOTES</span>
        <span>SEOGREP(1)</span>
      </div>

      <div className="flex max-w-[620px] flex-col gap-5 animate-[rise_0.7s_ease-out_0.08s_both]">
        <p className="m-0 font-mono text-[12px] font-semibold tracking-[0.14em] text-accent">BLOG</p>
        <h1 className="m-0 font-serif text-4xl font-medium leading-[1.1] tracking-[-0.015em] sm:text-[46px]">
          What we are building and learning
        </h1>
        <p className="m-0 font-serif text-[17px] leading-[1.65] text-body">
          Product notes, SEO workflows, and the thinking behind the tools SeoGrep gives your AI client.
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="mt-16 font-serif text-body">No posts yet.</p>
      ) : (
        <ul className="m-0 mt-16 flex list-none flex-col border-t border-ink p-0 animate-[rise_0.7s_ease-out_0.16s_both]">
          {posts.map((post) => (
            <li key={post.url} className="border-b border-hairline">
              <article className="grid grid-cols-1 items-start gap-2 py-8 sm:grid-cols-[130px_1fr] sm:gap-9">
                <time dateTime={post.data.date} className="pt-1.5 font-mono text-[12px] text-faint">
                  {formatDate(post.data.date)}
                </time>
                <div>
                  <h2 className="m-0 mb-2 font-serif text-[25px] font-medium leading-[1.3] tracking-[-0.01em]">
                    <Link href={post.url} className="transition-colors duration-150">
                      {post.data.title}
                    </Link>
                  </h2>
                  <p className="m-0 font-serif text-[15.5px] leading-[1.6] text-muted">{post.data.description}</p>
                  <Link
                    href={post.url}
                    aria-hidden="true"
                    tabIndex={-1}
                    className="mt-3 inline-block font-mono text-[12px] text-accent"
                  >
                    Read →
                  </Link>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
