// dist-freshness.mjs — does a compiled output tree still correspond to its TypeScript sources?
//
// WHY THIS EXISTS (measured, 2026-08-26). `gen-tool-docs.mjs --check` derives every tool page from
// the BUILT registry (`apps/mcp/dist`). Run against a stale `dist` it compares TODAY's MDX with
// YESTERDAY's code and prints "38 tool pages in sync" — a green that measures nothing. Measured
// canary: a tool `description` edited in `apps/mcp/src` and deliberately NOT rebuilt still produced
//   `gen-tool-docs --check OK — 38 tool pages in sync …`  exit 0.
// The repo gate was safe only by accident (verify.sh happens to run the check after `build`); every
// standalone run — `make goals`, a developer, a CI job that skips build — got the meaningless green.
//
// THE CRITERION, and what it does NOT measure.
//
// Primary observable: per-file MODIFICATION TIME. `src/a/b.ts` must have a `dist/a/b.js` that is not
// older than it. That catches "edited and not rebuilt" and "added and never compiled" — the two ways
// dist actually goes stale. It does NOT measure:
//   • CONTENT. A `touch`, or an edit reverted back to identical bytes, moves the mtime without
//     changing the code. That direction is a FALSE ALARM, never a false green — and the fingerprint
//     memo below removes it for every case a previous run already verified.
//   • A dist file that is NEWER than its source but was built from DIFFERENT code (hand-edited
//     `dist`, or a source restored with a back-dated mtime via `touch -t`). Nothing short of
//     recompiling can see that, and recompiling is what a verifier must not do.
//   • `packages/core` / `packages/db`: `apps/mcp/dist` imports THEIR dist at runtime, so a stale
//     workspace package can still feed the generator old values. Only apps/mcp is measured here.
//   • Whether the build was CORRECT. Freshness is not compilation success.
//   • ORPHANS — a `dist/x.js` whose `src/x.ts` is gone. Deliberately NOT flagged: `tsc --outDir`
//     never deletes removed outputs, so every rename or deletion would leave a red that rebuilding
//     cannot clear. It costs little: dropping a tool edits `tools/index.ts`, and THAT file's
//     timestamp is checked.
//
// WHY A FINGERPRINT MEMO IS NEEDED (measured, not assumed). Turbo's cache is content-hashed, and a
// cache HIT does not touch `dist`:
//     $ touch apps/mcp/src/tools/list-projects.ts
//     $ pnpm turbo run build --filter=@pseo/mcp   → "cache hit, replaying logs"
//     src mtime 1787730895   dist mtime 1787730885     ← still older, no write happened
// So an mtime-only gate could go red in a state where the repo-standard build command CANNOT clear
// it — a gate whose stated fix does not fix it. The memo closes that: on every run that passes on
// timestamps alone, we record (fingerprint of all sources, identity of this dist). A later run whose
// timestamps look stale is forgiven ONLY if both still match — i.e. the very same sources against
// the very same dist that were already verified. Different bytes, or a dist that has changed since,
// void the memo and the run goes red.
//
// The memo is a CACHE inside the build output (gitignored, safe to delete, best-effort write). It
// can never turn a real drift green: a changed source changes the fingerprint.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Memo file name, written inside the dist directory it describes. */
export const MEMO_BASENAME = ".gen-tool-docs-freshness.json";

/** Bumped whenever the memo's meaning changes, so old memos are ignored rather than trusted. */
export const MEMO_VERSION = 1;

/** How many example paths a failure message lists before it summarises the rest. */
export const SAMPLE_LIMIT = 5;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/**
 * Is this source file one the build emits a `.js` for? `tsc -p apps/mcp/tsconfig.json` includes
 * `src` and excludes `src/**\/*.test.ts`, so tests have no counterpart and must not be demanded.
 * Declaration files never emit either. (Measured: 130 non-test sources ↔ 130 dist .js files.)
 */
export function isCompiledSource(rel) {
  return rel.endsWith(".ts") && !rel.endsWith(".test.ts") && !rel.endsWith(".d.ts");
}

/** `tools/list-projects.ts` → `tools/list-projects.js` (the path tsc emits for it). */
export function outputRelFor(sourceRel) {
  return sourceRel.replace(/\.ts$/, ".js");
}

/**
 * Sources whose compiled output is missing or older than they are.
 *
 * `sources`: [{ rel, mtimeMs }] — already filtered by isCompiledSource.
 * `outputs`: Map<rel, mtimeMs> of the emitted `.js` files.
 *
 * Equal timestamps count as fresh: tsc writes the output after reading the input, so same-millisecond
 * pairs are the normal result of a fast build, not evidence of staleness.
 */
export function findSuspects(sources, outputs) {
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const newer = [];
  for (const source of sources) {
    const outputMtime = outputs.get(outputRelFor(source.rel));
    if (outputMtime === undefined) missing.push(source.rel);
    else if (source.mtimeMs > outputMtime) newer.push(source.rel);
  }
  return { missing: missing.sort(), newer: newer.sort() };
}

/**
 * A content fingerprint of the whole source set: every path AND every byte, order-independent.
 * `files`: [{ rel, content }]. Path and content are separated by NUL so that renaming a file cannot
 * be cancelled out by an edit that shifts the same bytes into the neighbouring field.
 */
export function fingerprintSources(files) {
  const hash = createHash("sha256");
  const sorted = [...files].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  for (const file of sorted) {
    hash.update(file.rel);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * The identity of a dist tree: how many outputs it has and when the newest was written. A rebuild
 * moves at least one of the two, which is what makes a memo recorded against an OLDER dist stop
 * rescuing a newer one.
 */
export function distStampOf(outputs) {
  let newest = 0;
  for (const mtimeMs of outputs.values()) if (mtimeMs > newest) newest = mtimeMs;
  return `${outputs.size}:${newest}`;
}

/**
 * May a memo forgive timestamps that look stale? Only when it was written by this version, for
 * exactly these source bytes, against exactly this dist. Anything else is not evidence.
 */
export function memoRescues(memo, { sourceFingerprint, distStamp }) {
  if (!memo || typeof memo !== "object") return false;
  return (
    memo.version === MEMO_VERSION &&
    memo.sourceFingerprint === sourceFingerprint &&
    memo.distStamp === distStamp
  );
}

/** `["a","b","c"]` with SAMPLE_LIMIT 2 → "a, b, and 1 more". */
function sample(paths, limit = SAMPLE_LIMIT) {
  if (paths.length <= limit) return paths.join(", ");
  return `${paths.slice(0, limit).join(", ")}, and ${paths.length - limit} more`;
}

/**
 * The English failure text. It names WHAT is stale, WHY that makes the check worthless, and the ONE
 * command that fixes it — `pnpm --filter @pseo/mcp build` rather than the turbo form, because a
 * turbo cache hit is exactly the state that cannot clear this (measured above).
 *
 * @param {{ missing?: string[], newer?: string[], srcLabel: string, distLabel: string }} input
 * @returns {string}
 */
export function renderStaleMessage({ missing = [], newer = [], srcLabel, distLabel }) {
  const lines = [
    `${distLabel} is STALE — it no longer matches ${srcLabel}.`,
    "The docs check reads the BUILT registry, so checking against a stale build compares today's",
    "MDX with yesterday's code and passes for the wrong reason.",
  ];
  if (newer.length > 0) {
    lines.push(`  - ${newer.length} source(s) newer than their compiled output: ${sample(newer)}`);
  }
  if (missing.length > 0) {
    lines.push(`  - ${missing.length} source(s) never compiled at all: ${sample(missing)}`);
  }
  lines.push("Rebuild before checking:  pnpm --filter @pseo/mcp build");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/** Every file under `dir` (recursive) as POSIX-style relative paths, with mtimes. */
export function listFiles(dir, keep = () => true) {
  /** @type {{ rel: string, absPath: string, mtimeMs: number }[]} */
  const found = [];
  /** @param {string} current */
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return; // unreadable directory: contributes nothing, the empty-set guards below catch it
    }
    for (const entry of entries) {
      const absPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(dir, absPath).split(sep).join("/");
      if (!keep(rel)) continue;
      found.push({ rel, absPath, mtimeMs: statSync(absPath).mtimeMs });
    }
  };
  walk(dir);
  return found;
}

function readMemo(memoPath) {
  try {
    return JSON.parse(readFileSync(memoPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Throw unless `distDir` is a build of `srcDir`. Returns a short English summary of WHAT was
 * measured on success, so a green line can say how it earned itself (signed lesson 7).
 *
 * Reads only — never compiles, never regenerates. The single write is the best-effort memo, and a
 * failure to write it is not a gate failure.
 */
export function assertDistFresh({ srcDir, distDir, srcLabel = srcDir, distLabel = distDir }) {
  const outputs = new Map(
    listFiles(distDir, (rel) => rel.endsWith(".js")).map((file) => [file.rel, file.mtimeMs]),
  );
  if (outputs.size === 0) {
    throw new Error(
      `${distLabel} has no compiled output — the docs check has nothing to read.\n` +
        "Build it first:  pnpm --filter @pseo/mcp build",
    );
  }

  const sources = listFiles(srcDir, isCompiledSource);
  if (sources.length === 0) {
    // Not a pass. Zero sources means the path is wrong or the tree is gone, and a freshness check
    // that finds nothing to compare would otherwise report the emptiest possible green.
    throw new Error(
      `${srcLabel} contains no compiled TypeScript sources — the freshness check cannot measure ` +
        "anything, so it refuses to report a pass. Check the path.",
    );
  }

  const { missing, newer } = findSuspects(sources, outputs);
  const measured = `${sources.length} sources vs ${outputs.size} compiled outputs`;
  const memoPath = join(distDir, MEMO_BASENAME);

  if (missing.length === 0 && newer.length === 0) {
    // Every output is at least as new as its source: this dist IS a build of these bytes. Record
    // that pairing so a later run whose timestamps drift (turbo cache hit, revert, touch) can be
    // forgiven on evidence rather than on faith.
    const memo = {
      version: MEMO_VERSION,
      sourceFingerprint: fingerprintSources(
        sources.map((file) => ({ rel: file.rel, content: readFileSync(file.absPath) })),
      ),
      distStamp: distStampOf(outputs),
    };
    try {
      writeFileSync(memoPath, `${JSON.stringify(memo, null, 2)}\n`);
    } catch {
      // A read-only dist is not a freshness verdict; the timestamps already decided this run.
    }
    return { measured, rescued: false };
  }

  // Timestamps look stale. Only identical bytes against this same dist may forgive them.
  if (missing.length === 0) {
    const fingerprint = fingerprintSources(
      sources.map((file) => ({ rel: file.rel, content: readFileSync(file.absPath) })),
    );
    if (memoRescues(readMemo(memoPath), { sourceFingerprint: fingerprint, distStamp: distStampOf(outputs) })) {
      return { measured, rescued: true };
    }
  }

  throw new Error(renderStaleMessage({ missing, newer, srcLabel, distLabel }));
}
