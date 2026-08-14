const TOOL_ROWS = [
  {
    name: "crawl_site",
    result: <>job c_42 · up to 100 URLs</>,
    right: <span className="flex-none text-[11px] text-dark-faint">-20 credits</span>,
    delay: "1.7s",
  },
  {
    name: "get_job_status",
    result: <>crawl finished · 87 pages fetched</>,
    right: (
      <span className="flex-none text-[12px] text-dark-success" aria-hidden="true">
        ✓
      </span>
    ),
    delay: "2.4s",
  },
  {
    name: "audit_onpage",
    result: (
      <>
        <span className="text-accent-dark">12 missing meta</span> ·{" "}
        <span className="text-accent-dark">3 duplicate titles</span>
      </>
    ),
    right: (
      <span className="flex-none text-[12px] text-dark-success" aria-hidden="true">
        ✓
      </span>
    ),
    delay: "3.1s",
  },
] as const;

export function ChatDemo() {
  return (
    <figure className="m-0 w-full overflow-hidden rounded-lg bg-terminal shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_24px_48px_-24px_rgba(28,27,24,0.5)]">
      <div className="flex items-center gap-2 border-b border-hairline-dark bg-terminal-chrome px-[18px] py-[13px]">
        <span aria-hidden="true" className="h-[11px] w-[11px] rounded-full bg-dark-dot" />
        <span aria-hidden="true" className="h-[11px] w-[11px] rounded-full bg-dark-dot" />
        <span aria-hidden="true" className="h-[11px] w-[11px] rounded-full bg-dark-dot" />
        <span className="flex-1 text-center font-mono text-[11px] tracking-[0.04em] text-dark-muted">
          claude — seogrep mcp
        </span>
        <span aria-hidden="true" className="w-[49px]" />
      </div>
      <div className="flex flex-col gap-[15px] px-6 pb-[22px] pt-[26px] font-mono text-[13px] leading-[1.55]">
        <div className="animate-[line-in_0.5s_ease-out_1s_both]">
          <span className="sr-only">You:</span>
          <span aria-hidden="true" className="text-accent-dark">
            ❯
          </span>{" "}
          <span className="text-dark-text">Audit example.com for SEO issues.</span>
        </div>
        {TOOL_ROWS.map((row) => (
          <div
            key={row.name}
            className="flex items-baseline gap-3"
            style={{ animation: `line-in 0.5s ease-out ${row.delay} both` }}
          >
            <span className="sr-only">Tool call:</span>
            <span className="w-[130px] flex-none text-dark-muted">{row.name}</span>
            <span className="flex-1 text-dark-faint">{row.result}</span>
            {row.right}
          </div>
        ))}
        <div className="mt-1 border-t border-hairline-dark pt-[15px] animate-[line-in_0.5s_ease-out_3.9s_both]">
          <span className="sr-only">SeoGrep:</span>
          <span className="text-dark-text">
            Here&apos;s your prioritized fix list. Want the shareable report?
          </span>
          <span
            aria-hidden="true"
            className="ml-1.5 inline-block h-[15px] w-[7px] translate-y-0.5 bg-accent-dark animate-[cursor-blink_1.1s_step-end_4.4s_infinite]"
          />
        </div>
      </div>
      <figcaption className="flex justify-between gap-4 border-t border-hairline-dark bg-terminal-chrome px-[18px] py-[9px] font-mono text-[10.5px] tracking-[0.04em] text-dark-faint">
        <span>3 tool calls · 20 credits</span>
        <span>Illustrative example — sample site, sample numbers.</span>
      </figcaption>
    </figure>
  );
}
