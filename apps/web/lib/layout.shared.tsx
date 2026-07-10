import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: "Ranklens" },
    links: [
      { text: "Pricing", url: "/pricing" },
      { text: "How it works", url: "/how-it-works" },
    ],
  };
}
