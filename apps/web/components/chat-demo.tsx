const TURNS = [
  { role: "user", text: "Audit example.com for SEO issues." },
  { role: "tool", text: "crawl_site → job c_42 started · up to 100 URLs · 20 credits" },
  { role: "tool", text: "get_job_status → crawl finished · 87 pages fetched" },
  { role: "tool", text: "audit_onpage → 12 missing meta descriptions · 3 broken internal links" },
  { role: "assistant", text: "Here's your prioritized fix list. Want the shareable report? (generate_report)" },
] as const;

export function ChatDemo() {
  return (
    <figure className="w-full max-w-xl rounded-2xl border border-ink/10 bg-white/60 p-4 shadow-sm">
      <ol className="flex flex-col gap-3">
        {TURNS.map((turn, index) => (
          <li
            key={turn.text}
            style={{ animationDelay: `${index * 900}ms` }}
            className={`chat-turn max-w-[85%] rounded-xl px-3 py-2 text-sm ${
              turn.role === "user"
                ? "self-end bg-ink text-paper"
                : turn.role === "tool"
                  ? "self-start border border-accent/40 bg-accent/10 font-mono text-[13px]"
                  : "self-start bg-ink/5"
            }`}
          >
            <span className="sr-only">
              {turn.role === "user" ? "You:" : turn.role === "tool" ? "Tool call:" : "SeoGrep:"}
            </span>
            {turn.text}
          </li>
        ))}
      </ol>
      <figcaption className="mt-3 text-xs text-ink/60">
        Illustrative example — sample site, sample numbers.
      </figcaption>
    </figure>
  );
}
