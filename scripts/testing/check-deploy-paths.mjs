// check-deploy-paths.mjs — the MCP image's workspace-package list is written in FOUR places, and
// three of them are copies. This gate derives the list from the ONE that cannot lie and fails when
// any copy has drifted.
//
// THE SOURCE OF TRUTH is apps/mcp/package.json: a `@pseo/*` entry in `dependencies` is what makes
// the runtime need that package's dist. Everything else follows from it:
//
//   consumer                                        what a stale copy costs
//   ─────────────────────────────────────────────── ──────────────────────────────────────────────
//   Dockerfile  RUN pnpm --filter @pseo/X run build  image build fails, or ships without X's dist
//   Dockerfile  COPY .../packages/X/dist             runtime ERR_MODULE_NOT_FOUND on first import
//   deploy-mcp.yml  paths: packages/X/**             NOTHING — and that is the dangerous one
//
// BOTH DOCKERFILE COPIES FAIL LOUDLY; THE WORKFLOW COPY FAILS SILENTLY. A main commit that touches
// only a forgotten package passes CI, triggers no deploy, and leaves production on the previous
// image with a deploy history that is entirely green. Nothing anywhere turns red.
//
// THIS HAS ALREADY HAPPENED TWICE, to two different copies, from the same single edit:
//   2026-08-14  @pseo/mcp gained the @pseo/db dependency. The Dockerfile still built @pseo/core
//               alone; verify.sh stayed green because turbo resolves ^build on its own. Caught by
//               the image build breaking, then fixed BY HAND — see apps/mcp/Dockerfile.
//   2026-08-27  The same edit's other victim surfaced: deploy-mcp.yml had watched apps/mcp,
//               packages/core and the root inputs since 2026-07-20 and was never widened. It sat
//               stale for two weeks and was found by an outside audit, not by a gate (H-03).
//
// The 2026-08-14 fix was a hand edit to one copy, which is precisely why 2026-08-27 happened: a
// hand-kept list has no memory. This file is the memory.
//
// Usage:
//   node scripts/testing/check-deploy-paths.mjs              # exit 1 on any drift
//   node scripts/testing/check-deploy-paths.mjs --self-test  # prove the four assertions go RED

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = new URL("../../", import.meta.url);
const PKG = new URL("apps/mcp/package.json", REPO);
const DOCKERFILE = new URL("apps/mcp/Dockerfile", REPO);
const WORKFLOW = new URL(".github/workflows/deploy-mcp.yml", REPO);

// ---------------------------------------------------------------------------
// Pure extractors — each reads ONE artifact and answers "which @pseo packages does it name?".
// Exported so the self-test can feed them hand-built strings instead of the repo's real files.
// ---------------------------------------------------------------------------

/** Workspace package names @pseo/mcp declares as RUNTIME dependencies (devDependencies excluded:
 *  they never reach the image, which installs with --prod). `@pseo/mcp` itself is not a dependency
 *  of itself, so the list is exactly the packages whose dist must be built and copied. */
export function requiredPackages(packageJsonText) {
  const deps = JSON.parse(packageJsonText).dependencies || {};
  return Object.keys(deps)
    .filter((name) => name.startsWith("@pseo/"))
    .map((name) => name.slice("@pseo/".length))
    .sort();
}

/** Packages the Dockerfile compiles: `RUN pnpm --filter @pseo/X run build`. `mcp` is dropped — the
 *  app builds itself and has no packages/ directory to watch. */
export function dockerfileBuilds(dockerfileText) {
  const found = [...dockerfileText.matchAll(/pnpm\s+--filter\s+@pseo\/([a-z0-9-]+)\s+run\s+build/g)];
  return [...new Set(found.map((m) => m[1]))].filter((name) => name !== "mcp").sort();
}

/** Packages whose dist the runtime image copies: `COPY --from=builder /app/packages/X/dist`. */
export function dockerfileCopies(dockerfileText) {
  const found = [...dockerfileText.matchAll(/COPY\s+--from=builder\s+\S*\/packages\/([a-z0-9-]+)\/dist/g)];
  return [...new Set(found.map((m) => m[1]))].sort();
}

/**
 * Packages the deploy trigger watches: `- "packages/X/**"` inside the workflow's `paths:` list.
 * Deliberately matches the whole file rather than parsing YAML — this gate has no YAML dependency,
 * and deploy-mcp.yml has exactly one `paths:` block. A `packages/X/**` line anywhere in the file
 * still means the trigger fires, which is the property being asserted.
 */
export function workflowWatches(workflowText) {
  const found = [...workflowText.matchAll(/^\s*-\s*"packages\/([a-z0-9-]+)\/\*\*"\s*$/gm)];
  return [...new Set(found.map((m) => m[1]))].sort();
}

/** The four assertions, as data. Returns a list of human-readable failures (empty = in sync). */
export function collectDriftErrors({ packageJsonText, dockerfileText, workflowText }) {
  const required = requiredPackages(packageJsonText);
  const errors = [];
  if (required.length === 0) {
    errors.push(
      "apps/mcp/package.json declares no @pseo/* runtime dependency — either the manifest moved or " +
        "this gate's extractor is broken. Refusing to report 'in sync' off an empty list.",
    );
    return errors;
  }
  const checks = [
    ["Dockerfile builds it (RUN pnpm --filter @pseo/X run build)", dockerfileBuilds(dockerfileText)],
    ["Dockerfile copies its dist (COPY --from=builder .../packages/X/dist)", dockerfileCopies(dockerfileText)],
    ['deploy-mcp.yml watches it (paths: - "packages/X/**")', workflowWatches(workflowText)],
  ];
  for (const [label, actual] of checks) {
    for (const name of required) {
      if (!actual.includes(name)) {
        errors.push(`@pseo/${name} is a runtime dependency of @pseo/mcp, but ${label} does not name it.`);
      }
    }
    for (const name of actual) {
      if (!required.includes(name)) {
        errors.push(
          `${label} names @pseo/${name}, which is NOT a runtime dependency of @pseo/mcp — ` +
            "drop it, or add the dependency it is standing in for.",
        );
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Self-test — a green assertion is evidence only if it was deliberately broken and MEASURED red
// (constitution lesson 12). Each case removes exactly one package from exactly one consumer.
// ---------------------------------------------------------------------------

const SELF_TEST_PKG = JSON.stringify({ dependencies: { "@pseo/core": "workspace:*", "@pseo/db": "workspace:*" } });
const SELF_TEST_DOCKERFILE = [
  "RUN pnpm --filter @pseo/core run build",
  "RUN pnpm --filter @pseo/db run build",
  "RUN pnpm --filter @pseo/mcp run build",
  "COPY --from=builder /app/packages/core/dist ./packages/core/dist",
  "COPY --from=builder /app/packages/db/dist ./packages/db/dist",
].join("\n");
const SELF_TEST_WORKFLOW = ['      - "packages/core/**"', '      - "packages/db/**"'].join("\n");

function selfTest() {
  const base = {
    packageJsonText: SELF_TEST_PKG,
    dockerfileText: SELF_TEST_DOCKERFILE,
    workflowText: SELF_TEST_WORKFLOW,
  };
  const cases = [
    ["in-sync fixture is GREEN", base, 0],
    [
      "workflow forgets packages/db (the EXACT 2026-08-27 shape) is RED",
      { ...base, workflowText: '      - "packages/core/**"' },
      1,
    ],
    [
      "Dockerfile forgets to build @pseo/db (the EXACT 2026-08-14 shape) is RED",
      { ...base, dockerfileText: SELF_TEST_DOCKERFILE.replace("RUN pnpm --filter @pseo/db run build\n", "") },
      1,
    ],
    [
      "Dockerfile forgets to COPY packages/db/dist is RED",
      {
        ...base,
        dockerfileText: SELF_TEST_DOCKERFILE.replace(
          "COPY --from=builder /app/packages/db/dist ./packages/db/dist",
          "",
        ),
      },
      1,
    ],
    [
      "a consumer naming a package that is NOT a dependency is RED",
      { ...base, workflowText: `${SELF_TEST_WORKFLOW}\n      - "packages/ghost/**"` },
      1,
    ],
    [
      "an empty dependency list is REFUSED, not reported in sync",
      { ...base, packageJsonText: JSON.stringify({ dependencies: {} }) },
      1,
    ],
  ];
  let failed = 0;
  for (const [label, input, expected] of cases) {
    const errors = collectDriftErrors(input);
    const got = errors.length > 0 ? 1 : 0;
    const ok = got === expected;
    if (!ok) failed++;
    console.error(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` — expected ${expected}, got ${got}`}`);
  }
  return failed;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  if (process.argv.includes("--self-test")) {
    const failed = selfTest();
    if (failed > 0) {
      console.error(`check-deploy-paths --self-test FAILED: ${failed} case(s) did not behave as designed.`);
      process.exit(1);
    }
    console.error("check-deploy-paths --self-test OK — every drift shape measured RED, in-sync measured GREEN.");
    return;
  }
  const errors = collectDriftErrors({
    packageJsonText: readFileSync(PKG, "utf8"),
    dockerfileText: readFileSync(DOCKERFILE, "utf8"),
    workflowText: readFileSync(WORKFLOW, "utf8"),
  });
  if (errors.length > 0) {
    console.error("check-deploy-paths FAILED — the MCP image's package list has drifted:");
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const required = requiredPackages(readFileSync(PKG, "utf8"));
  console.error(
    `check-deploy-paths OK — @pseo/mcp's ${required.length} workspace dependencies ` +
      `(${required.map((n) => `@pseo/${n}`).join(", ")}) are built, copied and watched.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
