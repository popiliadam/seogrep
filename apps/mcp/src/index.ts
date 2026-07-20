import { argv } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.ts";
import { createApp } from "./server.ts";
import { startWorker, stopWorker } from "./queue/worker.ts";

export type Mode = "web" | "worker";

/**
 * Resolve the process role from MODE (default "web"). Throws on an unknown value
 * so a typo fails fast instead of silently starting the wrong process.
 */
export function resolveMode(raw: string | undefined): Mode {
  const mode = raw ?? "web";
  if (mode !== "web" && mode !== "worker") {
    throw new Error(`Unknown MODE "${mode}" (expected "web" or "worker")`);
  }
  return mode;
}

/** Start the selected process: the web gateway, or the pg-boss queue worker. */
export function main(): void {
  const mode = resolveMode(process.env.MODE);
  if (mode === "worker") {
    // Queue consumer. SIGTERM triggers a graceful pg-boss stop: in-flight jobs
    // drain, the pool closes, the event loop empties, and the process exits 0.
    process.once("SIGTERM", () => {
      void stopWorker();
    });
    startWorker().catch((error: unknown) => {
      console.error("worker failed to start:", error);
      process.exitCode = 1;
    });
    return;
  }

  const env = loadEnv();
  createApp().listen(env.PORT, () => {
    console.warn(`seogrep-mcp web listening on :${env.PORT}`);
  });
}

// Auto-start only when run as the entrypoint, never when imported by tests.
if (argv[1] !== undefined && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
