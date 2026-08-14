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
    <form action={addDomain} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Add domain</span>
        <input
          type="text"
          name="domain"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="example.com"
          aria-describedby="add-domain-hint"
          className="w-72 rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
      >
        Add
      </button>
      <p id="add-domain-hint" className="w-full text-xs text-neutral-500">
        A domain or a URL — SeoGrep stores one canonical form, so adding a site twice returns the
        project you already have.
      </p>
    </form>
  );
}
