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
      <DocsLayout {...baseOptions()} tree={source.getPageTree()} themeSwitch={{ enabled: false }}>
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
