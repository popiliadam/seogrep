import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import { getMDXComponents } from "../../../mdx-components";
import { source } from "../../../lib/source";

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();
  const MDX = page.data.body;
  return (
    // role="main" ON THE ARTICLE, not a <main> wrapper. The docs shell rendered a HEADER and an
    // ASIDE but no main landmark at all (L-01, audit 2026-08-26; re-measured on the built HTML
    // 2026-08-27: 0 <main>, 0 <nav>, 2 <header>, 1 <aside>), so a screen-reader user had no way to
    // jump to the content — the whole point of landmarks.
    //
    // WHY NOT A WRAPPER. fumadocs places this article with `[grid-area:main]`; wrapping it would
    // make the WRAPPER the grid item and the placement would stop applying, i.e. the a11y fix
    // would break the layout. DocsPageProps extends ComponentProps<'article'>, so the role lands
    // on the element that already exists and nothing moves. There is exactly one DocsPage per
    // route, so this cannot produce two main landmarks.
    <DocsPage toc={page.data.toc} full={page.data.full} role="main">
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();
  return { title: page.data.title, description: page.data.description };
}
