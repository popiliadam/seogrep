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
          unnamed landmark is announced as "navigation" and tells the user nothing.

          MEASURED ON A REAL DEPLOY, both widths, because the built HTML could not tell them apart:
            1440px -> main 1, navigation 1, labelled "Documentation", on <aside id="nd-sidebar">
             375px -> main 1, navigation 0

          THIS REACHES THE DESKTOP SIDEBAR ONLY, and that is a limit, not an oversight. fumadocs
          renders two different elements: `Sidebar({...rest})` spreads these props into
          SidebarContent (#nd-sidebar), while the mobile drawer (#nd-sidebar-mobile) is rendered
          beside it from its own props, which this prop never reaches. Getting the role onto the
          drawer means overriding `slots.sidebar.root` with a client component — a coupling to
          fumadocs internals that a version bump breaks silently, bought for a panel that is
          `invisible` until the user opens it. The trade was declined deliberately; the `main`
          landmark, which is the one a reader needs to skip to the content, IS present at both
          widths. */}
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
