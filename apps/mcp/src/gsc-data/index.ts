/**
 * The GSC data + discovery slice: pull_gsc_data stores two windows of Search Console rows,
 * and the three discovery engines (quick wins / cannibalization / content decay) read them.
 * Pure analysis is separated from I/O — the engines take a PullData and return findings; the
 * Google client is a port (pull.ts) and the DB read a loader (load.ts).
 */
export * from "./types.ts";
export * from "./windows.ts";
export * from "./rows.ts";
export * from "./pull.ts";
export * from "./quick-wins.ts";
export * from "./cannibalization.ts";
export * from "./content-decay.ts";
export * from "./format.ts";
export * from "./load.ts";
