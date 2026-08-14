import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMDXComponents } from "../../../../mdx-components";
import { formatDate } from "../../../../lib/format";
import { blogSource } from "../../../../lib/source";

type PageProps = { params: Promise<{ slug: string }> };

export default async function Page(props: PageProps) {
  const { slug } = await props.params;
  const post = blogSource.getPage([slug]);
  if (!post) notFound();
  const MDX = post.data.body;

  return (
    <article className="mx-auto w-full max-w-[720px] px-5 pb-24 pt-16 sm:px-8">
      <header className="animate-[rise_0.6s_ease-out_both]">
        <Link href="/blog" className="font-mono text-[12px] text-faint transition-colors duration-150 hover:text-accent">
          ← Blog
        </Link>
        <div className="mb-5 mt-7 flex gap-[18px] font-mono text-[12px] text-faint">
          <time dateTime={post.data.date}>{formatDate(post.data.date)}</time>
        </div>
        <h1 className="m-0 mb-[22px] font-serif text-[32px] font-medium leading-[1.15] tracking-[-0.015em] text-pretty sm:text-[42px]">
          {post.data.title}
        </h1>
        <p className="m-0 font-serif text-[19px] italic leading-[1.65] text-body">{post.data.description}</p>
      </header>

      <div className="blog-prose mt-12 animate-[rise_0.6s_ease-out_0.1s_both]">
        <MDX components={getMDXComponents()} />
      </div>

      <div className="mt-14 flex flex-wrap items-center justify-between gap-6 border border-hairline bg-band px-8 py-7 animate-[rise_0.6s_ease-out_0.15s_both]">
        <div>
          <p className="m-0 mb-1 font-serif text-[19px] font-medium">Run the same audit on your site.</p>
          <p className="m-0 font-mono text-[12px] text-faint">200 free credits, no card required.</p>
        </div>
        <Link
          href="/signup"
          className="whitespace-nowrap bg-ink px-[22px] py-3 font-mono text-[13px] font-semibold text-paper transition-colors duration-150 hover:bg-accent hover:text-paper"
        >
          Get started free
        </Link>
      </div>
    </article>
  );
}

export function generateStaticParams() {
  return blogSource.getPages().map((post) => ({ slug: post.slugs[0] }));
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const post = blogSource.getPage([slug]);
  if (!post) notFound();
  return { title: post.data.title, description: post.data.description };
}
