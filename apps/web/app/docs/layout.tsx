import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import { baseOptions } from "../../lib/layout.shared";
import { source } from "../../lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  // RootProvider is scoped to this segment rather than mounted in the root layout: only the docs
  // surface reads its context (search dialog, sidebar state), and at the root it put fumadocs'
  // client chunk on every marketing, auth and app page — 107KB of it prefetched on first paint.
  return (
    <RootProvider theme={{ enabled: false }}>
      {/* The sidebar holds the page tree — it IS the docs navigation, but fumadocs renders it as a
          bare <aside>, which exposes a "complementary" landmark and no navigation one (L-01).
          SidebarProps extends ComponentProps<'aside'>, so the role and its name pass straight
          through with no wrapper and no layout change. The name matters as much as the role: an
          unnamed landmark is announced as "navigation" and tells the user nothing. */}
      <DocsLayout
        {...baseOptions()}
        tree={source.getPageTree()}
        themeSwitch={{ enabled: false }}
        sidebar={{ role: "navigation", "aria-label": "Documentation" }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
