/**
 * The parsers the /app/projects SOURCE PINS share — and the reason they are shared.
 *
 * Every spec beside this file reads `page.tsx`, strips its comments, and matches the shortest
 * distinctive fragment of ONE function body (signed lesson 11). That machinery — `codeOf`, `read`,
 * `bodyOf`, `selectOf` — is deliberately left copied per spec: it is four short, obvious functions,
 * each carrying an error message written for its own read, and a single shared copy would be one
 * place where "fixing" a spec quietly softens six gates at once.
 *
 * These parsers are the opposite case. They answer questions a regex cannot ask honestly — WHICH
 * identifier a filter compares a column against, WHETHER the error branch throws or degrades,
 * WHETHER the row a fan-out fetched is still on the object the fan-out returns — and getting one of
 * them subtly wrong produces a parser that matches nothing and therefore a spec that passes
 * vacuously (signed lesson 12: a permissive double turns a missing constraint into a green test).
 * Copied six times, that is six vacuous passes to notice instead of one, so they live here once and
 * `query-pins.test.ts` drives them against inputs that must be REJECTED.
 *
 * Two rules hold throughout:
 *
 *   - They take an ALREADY-EXTRACTED body, never a path. No file IO here, so each spec keeps
 *     owning which function it is talking about and what to say when that function disappears.
 *   - They THROW rather than return empty. A parser that returned `[]` for "no filters found" would
 *     make `expect(filters.get("user_id")).toBe(userId)` fail loudly, but one that returned an
 *     empty Map for a body it simply failed to understand would make a `.not.toMatch` pin pass
 *     forever. Silence is the failure mode being designed out.
 */

const CLOSERS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };

/**
 * The text INSIDE the bracket at `openIndex`, with its matching close found by depth.
 *
 * String and template literals are skipped whole, so a `)` inside `.select("a, b")` or the `${…}`
 * of a thrown message never closes a bracket it did not open. That is not hypothetical here: every
 * read in `page.tsx` throws a template-literal message, and several select lists are written as
 * concatenated literals.
 */
function inner(source: string, openIndex: number, what: string): string {
  const open = source[openIndex] ?? "";
  const close = CLOSERS[open];
  if (close === undefined) {
    throw new Error(`${what}: expected a bracket at index ${openIndex}, found ${JSON.stringify(open)}`);
  }
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i] as string;
    if (char === '"' || char === "'" || char === "`") {
      i = endOfLiteral(source, i, what);
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  throw new Error(`${what}: unbalanced ${open} — the body this spec sliced is not a whole function`);
}

/** The index of the quote that CLOSES the literal opened at `start`, escapes honoured. */
function endOfLiteral(source: string, start: number, what: string): number {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i += 1) {
    const char = source[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === quote) return i;
  }
  throw new Error(`${what}: unterminated ${quote} literal`);
}

/** Split on the commas at depth ZERO — `select("a, b")` and `Map<string, X>` stay in one piece. */
function splitTop(list: string, what: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    const char = list[i] as string;
    if (char === '"' || char === "'" || char === "`") {
      i = endOfLiteral(list, i, what);
      continue;
    }
    if (char === "(" || char === "[" || char === "{" || char === "<") depth += 1;
    else if (char === ")" || char === "]" || char === "}" || char === ">") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** `"user_id"` / `'user_id'` -> `user_id`; anything else stays as written. */
function unquote(text: string): string {
  const match = /^["'](.*)["']$/.exec(text.trim());
  return match === null ? text.trim() : (match[1] as string);
}

/**
 * The DECLARED PARAMETER NAMES of the sliced function, in order.
 *
 * This is what lets a value pin be a RELATIONSHIP rather than a spelling: a spec asserts that the
 * `user_id` filter compares against the function's own caller parameter, so renaming that parameter
 * changes both sides at once and the pin stays green, while comparing against a DIFFERENT id in
 * scope turns it red. Types are dropped (`userId: string` -> `userId`).
 */
export function paramsOf(body: string, what: string): readonly string[] {
  const open = body.indexOf("(");
  if (open === -1) {
    throw new Error(`${what}: no parameter list — is this a function body at all?`);
  }
  const list = inner(body, open, what);
  return splitTop(list, what).map((part) => (part.split(":")[0] as string).trim());
}

/**
 * Every EQUALITY filter in the chain, as `column -> the text it is compared against`.
 *
 * `.eq("user_id", userId)`, `.is("archived_at", null)` and the longhand
 * `.filter("user_id", "eq", userId)` all count, because the longhand is a functionally identical
 * rewording and a pin that reddened on it would be teaching the reader to edit the spec. What is
 * NOT tolerated is a column named by anything but a literal, or the same column filtered twice with
 * different values: both are defects, and both throw here rather than being quietly dropped.
 */
export function filtersOf(body: string, what: string): ReadonlyMap<string, string> {
  const filters = new Map<string, string>();
  const calls = /\.(eq|is|filter)\s*\(/g;
  let call: RegExpExecArray | null;
  while ((call = calls.exec(body)) !== null) {
    const openIndex = body.indexOf("(", call.index);
    const args = splitTop(inner(body, openIndex, what), what);
    const method = call[1];
    const expected = method === "filter" ? 3 : 2;
    if (args.length !== expected) continue;
    if (method === "filter" && unquote(args[1] as string) !== "eq") continue;
    const rawColumn = args[0] as string;
    if (!/^["'][^"']+["']$/.test(rawColumn)) {
      throw new Error(
        `${what}: \`.${method}(${rawColumn}, …)\` names its column with an expression. A source ` +
          "pin cannot say which column that is, so it would pass whatever the query filtered on.",
      );
    }
    const column = unquote(rawColumn);
    const value = (args[expected - 1] as string).replace(/\s+/g, " ");
    const seen = filters.get(column);
    if (seen !== undefined && seen !== value) {
      throw new Error(
        `${what}: \`${column}\` is filtered twice, against \`${seen}\` and \`${value}\`. One of ` +
          "the two decides nothing, and this spec cannot tell you which.",
      );
    }
    filters.set(column, value);
  }
  if (filters.size === 0) {
    throw new Error(`${what}: no \`.eq\`/\`.is\` filter at all — the read is unscoped (NEVER #4).`);
  }
  return filters;
}

/**
 * The single-row terminators on the chain, in source order.
 *
 * A read that MEANT to fetch one row and lost its `.maybeSingle()` hands back an ARRAY, and the
 * `as unknown as Row | null` cast every one of these reads ends with swallows the difference whole:
 * `data` is truthy, every field is `undefined`, and the card falls back to its empty state on a
 * project whose row was fetched successfully. Asserted as an exact list rather than a `toMatch`, so
 * `.single()` — which ERRORS on zero rows, and would take the page down for a project that has
 * simply never run the tool — cannot satisfy a pin meant for `.maybeSingle()`.
 */
export function singleRowTerminatorsOf(body: string): readonly string[] {
  return [...body.matchAll(/\.(maybeSingle|single)\s*\(\s*\)/g)].map((match) => match[1] as string);
}

/**
 * The body of the `if (error)` branch, braces or no braces.
 *
 * Absent, it throws: a read with no error branch at all is the same defect the branch's CONTENT is
 * pinned for — a failed lookup that returns whatever the client left in `data` and renders as an
 * empty card.
 */
export function errorBranchOf(body: string, what: string): string {
  const guard = /if\s*\(\s*error\s*\)\s*/.exec(body);
  if (guard === null) {
    throw new Error(
      `${what}: no \`if (error)\` branch. The read does not look at its own error, so a failed ` +
        "lookup renders as an empty card instead of failing visibly.",
    );
  }
  const rest = body.slice(guard.index + guard[0].length);
  if (rest.startsWith("{")) return inner(rest, 0, what);
  const end = rest.indexOf(";");
  return end === -1 ? rest : rest.slice(0, end + 1);
}

/**
 * `const [a, b] = await Promise.all([f(…), g(…)])` read as `callee -> the binding it lands in`.
 *
 * The PAIRING is the point. A spec that only checked "the returned object mentions `lookupRuns`"
 * would stay green after two bindings were swapped, and the sibling row types are structurally
 * identical enough that `tsc` would not notice either.
 */
export function fanOutBindingsOf(body: string, what: string): ReadonlyMap<string, string> {
  const head = /const\s*\[([^\]]*)\]\s*=\s*await\s+Promise\.all\s*\(/.exec(body);
  if (head === null) {
    throw new Error(
      `${what}: no \`const [ … ] = await Promise.all(\` — the reads are no longer gathered here, ` +
        "so nothing this spec says about which row reaches the card still applies.",
    );
  }
  const bindings = splitTop(head[1] as string, what);
  const listOpen = body.indexOf("[", head.index + head[0].length - 1);
  const calls = splitTop(inner(body, listOpen, what), what).map((element) => {
    const callee = /^([A-Za-z_$][\w$.]*)\s*\(/.exec(element);
    if (callee === null) {
      throw new Error(`${what}: \`${element}\` in the fan-out is not a plain call this spec can name.`);
    }
    return callee[1] as string;
  });
  if (bindings.length !== calls.length) {
    throw new Error(
      `${what}: ${bindings.length} bindings for ${calls.length} reads. Every binding after the ` +
        "mismatch holds another read's rows.",
    );
  }
  return new Map(calls.map((callee, index) => [callee, bindings[index] as string]));
}

/**
 * The properties of the `return { … }` object literal, as `key -> the expression it holds`.
 *
 * Shorthand counts as itself (`crawl,` reads as `crawl: crawl`), which is what makes the pin
 * indifferent to whether the property is written long or short while still catching
 * `lookupRuns: undefined` — a row fetched, paid for, and dropped on the floor.
 */
export function returnPropsOf(body: string, what: string): ReadonlyMap<string, string> {
  const start = /return\s*\{/.exec(body);
  if (start === null) {
    throw new Error(`${what}: no \`return {\` object literal — what does the fan-out hand back now?`);
  }
  const braceIndex = body.indexOf("{", start.index);
  const props = new Map<string, string>();
  for (const part of splitTop(inner(body, braceIndex, what), what)) {
    const colon = topLevelColon(part, what);
    if (colon === -1) props.set(part.trim(), part.trim());
    else props.set(part.slice(0, colon).trim(), part.slice(colon + 1).replace(/\s+/g, " ").trim());
  }
  return props;
}

/** The first `:` at depth zero in one object-literal property, or -1 for shorthand. */
function topLevelColon(part: string, what: string): number {
  let depth = 0;
  for (let i = 0; i < part.length; i += 1) {
    const char = part[i] as string;
    if (char === '"' || char === "'" || char === "`") {
      i = endOfLiteral(part, i, what);
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === ":" && depth === 0) return i;
  }
  return -1;
}
