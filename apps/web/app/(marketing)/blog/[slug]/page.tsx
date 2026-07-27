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
    <article className="mx-auto w-full max-w-3xl px-4 py-16 sm:py-20">
      <header className="flex flex-col items-start gap-3">
        <time dateTime={post.data.date} className="text-sm text-ink/60">
          {formatDate(post.data.date)}
        </time>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{post.data.title}</h1>
        <p className="text-lg text-ink/70">{post.data.description}</p>
      </header>
      <div className="prose mt-10 max-w-none">
        <MDX components={getMDXComponents()} />
      </div>
      <Link href="/blog" className="mt-12 inline-block text-sm text-ink/70 hover:text-ink">
        ← All posts
      </Link>
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
