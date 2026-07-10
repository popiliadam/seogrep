import type { ReactNode } from "react";

export const metadata = { title: "pseo-saas", description: "Hosted SEO MCP — coming soon" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
