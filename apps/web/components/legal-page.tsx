import Link from "next/link";
import type { ReactNode } from "react";

type LegalSection = {
  readonly heading: string;
  readonly body: string;
  readonly link?: { readonly href: string; readonly label: string };
};

/**
 * Shared "manpage" presentation for the three legal routes (terms / privacy / refunds).
 * Each route keeps its own SECTIONS copy verbatim; this component only renders it.
 */
export function LegalPage({
  effective,
  title,
  intro,
  sections,
}: {
  effective: string;
  title: string;
  intro: ReactNode;
  sections: readonly LegalSection[];
}) {
  return (
    <section className="mx-auto w-full max-w-[780px] px-5 pb-24 pt-16 sm:px-8">
      <div className="animate-[rise_0.5s_ease-out_both]">
        <p className="m-0 mb-6 w-fit border border-accent-badge-border bg-accent-badge-bg px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-accent">
          {effective}
        </p>
        <h1 className="m-0 mb-3.5 font-serif text-[34px] font-medium tracking-[-0.015em] sm:text-[44px]">{title}</h1>
        <p className="m-0 mb-12 font-serif text-[17px] leading-[1.7] text-body">{intro}</p>
        <div className="flex flex-col gap-9 border-t border-ink pt-10">
          {sections.map((section, index) => (
            <section key={section.heading} className="grid grid-cols-[48px_1fr] gap-6">
              <span aria-hidden="true" className="pt-1 font-mono text-[12px] text-faint">
                §{index + 1}
              </span>
              <div>
                <h2 className="m-0 mb-2 font-serif text-[22px] font-medium tracking-[-0.01em]">{section.heading}</h2>
                <p className="m-0 font-serif text-[16px] leading-[1.75] text-body">{section.body}</p>
                {section.link ? (
                  <Link
                    href={section.link.href}
                    className="mt-3 inline-block border-b border-accent pb-0.5 font-mono text-[13px] transition-colors duration-150"
                  >
                    {section.link.label} <span aria-hidden="true">→</span>
                  </Link>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
