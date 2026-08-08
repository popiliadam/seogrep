// The --dry-run renderer: the plan and the projected cost, and NOTHING on the wire.
//
// It lives in its own module for one reason: --self-test hands it a counting transport spy and
// asserts the count is still zero afterwards. A dry run that quietly resolved a project_id, or
// read a balance "just to be helpful", would be a dry run that spends — so the assertion is on
// the transport, not on a promise in a comment.
import { projectCost } from "./plan.mjs";

/** Placeholders for the values a real run resolves over the wire. */
function dryContext(cell, foreignProjectId) {
  return {
    site: cell.siteRef,
    projectId: `<project_id:${cell.site}>`,
    foreignProjectId: foreignProjectId ?? "<foreign-project-id: NOT SUPPLIED — S4 will be skipped>",
    jobId: `<job_id:${cell.site}>`,
  };
}

/**
 * Print the projection table with the arithmetic spelled out. `charged` cells are the ones
 * pre-registered as reaching a reserve; `rejection` cells sit on a tool that could charge but
 * are expected to return before it (S2/S3/S4). They project 0 — and are measured anyway.
 */
export function printProjection(cells, log) {
  const projection = projectCost(cells);
  log("");
  log("PROJECTED CREDITS — the arithmetic, so a human can check it");
  log("  tool                      unit  x  charged  =  subtotal   cells  [free-by-design]");
  for (const row of projection.rows) {
    log(
      `  ${row.tool.padEnd(24)} ${String(row.unit).padStart(4)}  x  ${String(row.charged).padStart(7)}  =  ` +
        `${String(row.subtotal).padStart(8)}   ${String(row.cells).padStart(5)}  [${row.guarded}]`,
    );
  }
  log(`  ${"".padEnd(24)} ${"----".padStart(4)}     ${"-------"}     ${"--------"}   ${"-----"}`);
  log(`  PROJECTED TOTAL: ${projection.total} credits over ${cells.length} cells`);
  log(
    `  ${projection.guardedCells} cell(s) sit on a tool with a nonzero cost but are pre-registered as free ` +
      `(S2/S3/S4 return before the reserve). They project 0, are MEASURED anyway, and --max-credits still guards them.`,
  );
  return projection;
}

/** Render the whole plan. `deps.call` is accepted and deliberately never used. */
export function dryRun(cells, opts, log, deps = {}) {
  void deps;
  log(`DRY RUN — zero tools/call will be issued. run_id=${opts.runId}`);
  log(
    `  layers=${opts.layers?.join(",") ?? "all"} · scenarios=${opts.scenarios?.join(",") ?? "all"} · ` +
      `sites=${opts.siteKeys?.join(",") ?? "all"} · cells=${cells.length}`,
  );
  log("");
  log("  layer scen  site         tool                     cost  args");
  for (const cell of cells) {
    log(
      `  ${cell.layer.padEnd(5)} ${cell.scenario.padEnd(5)} ${cell.site.padEnd(12)} ` +
        `${cell.tool.padEnd(24)} ${String(cell.expectedCost).padStart(4)}  ` +
        `${JSON.stringify(cell.argsOf(dryContext(cell, opts.foreignProjectId)))}`,
    );
  }
  const projection = printProjection(cells, log);
  log("");
  log("DRY RUN COMPLETE — 0 tools/call issued, 0 credits spent.");
  return projection;
}
