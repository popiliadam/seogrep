import { addDomain } from "./actions";

/**
 * The one thing /app/projects can now DO: add a site.
 *
 * A native <form> whose action is a server action — no `"use client"`, no event handler, no
 * fetch. It therefore works with JavaScript disabled, needs no loading state, and adds nothing
 * to the client bundle; the answer arrives as a normal navigation carrying the status the
 * banner renders (see add-domain-contract.ts).
 *
 * The input is deliberately permissive (`example.com`, `https://Example.com/blog`, a trailing
 * dot, a port) because the shared route normalizes all of those to one canonical domain — the
 * browser's own `type="url"` validation would reject most of what people paste. `required`
 * keeps an empty submit from making a round trip; the server refuses it again regardless.
 */
export function AddDomainForm() {
  return (
    <form action={addDomain} className="flex flex-wrap items-end">
      <label className="flex flex-col">
        <span className="sr-only">Add domain</span>
        <input
          type="text"
          name="domain"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="example.com"
          aria-describedby="add-domain-hint"
          className="w-[220px] border border-r-0 border-hairline-mid bg-card px-3.5 py-[11px] font-mono text-[13px] text-ink outline-none placeholder:text-faintest focus:border-accent"
        />
      </label>
      <button
        type="submit"
        className="whitespace-nowrap bg-ink px-5 py-3 font-mono text-[13px] font-semibold text-paper transition-colors duration-150 hover:bg-accent hover:text-paper"
      >
        Add domain
      </button>
      <p id="add-domain-hint" className="m-0 mt-2 w-full font-mono text-[11px] leading-[1.6] text-faint">
        A domain or a URL — SeoGrep stores one canonical form, so adding a site twice returns the
        project you already have.
      </p>
    </form>
  );
}
