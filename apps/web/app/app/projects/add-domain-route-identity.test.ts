import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * IMPORT IDENTITY — the Add-domain action does not merely AGREE with the shared project route,
 * it CALLS it.
 *
 * Its own file, because `vi.mock` is hoisted to the top of whichever module it appears in and
 * the behavioural specs next door (add-domain.test.ts) must run against the real, unwrapped
 * `@pseo/db/projects`. This is the mechanism `lib/projects/core-identity.test.ts` uses for the
 * card's ladder, one step further: the module is not merely spied but given a SENTINEL result,
 * so the assertion is not "the values match" (a second insert written inside the action could
 * produce matching values all day) but "the answer the page got came out of THAT module".
 *
 * Why it is worth a file: an action that opened its own project would look completely fine. It
 * would create rows, redirect sensibly, and pass every behavioural spec that only inspects the
 * table — while quietly skipping the `normalizeDomain` gate that lives INSIDE the shared route,
 * which is exactly how /app/connection once came to open projects for `sc-domain:foo.internal`
 * that the MCP tools refused.
 *
 * The source pin below covers the same rule from the other side, because the two fail
 * differently: the spy notices a route that stops being called, the pin notices a second write
 * path added BESIDE the call.
 */

const openTrackedProject = vi.hoisted(() => vi.fn());
/**
 * The DNS port, stubbed — NO SPEC TOUCHES A RESOLVER (the rule `net/reachability.ts` states and
 * the reason setup_project injects the same check). Caught here on 2026-08-26: the moment the
 * action started asking, this file went red because `sentinel.example` was being looked up for
 * real, and a spec about IMPORT IDENTITY had quietly acquired a network dependency whose answer
 * decides the asserted URL.
 */
const checkDomainReachable = vi.hoisted(() => vi.fn(async () => "unknown" as const));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@pseo/db/server", () => ({ createServiceClient: () => ({ marker: "service-client" }) }));
vi.mock("../../../lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: () => ({ data: { user: { id: "u-1" } } }) } }),
}));
vi.mock("@pseo/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pseo/core")>();
  return { ...actual, checkDomainReachable };
});
vi.mock("@pseo/db/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pseo/db/projects")>();
  return { ...actual, openTrackedProject };
});

const { addDomain } = await import("./actions");

/** `pathname` percent-encodes; this repo's path contains a space, so decode it properly. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** Comments out, statements only — prose is not code (query-and-nav.test.ts's mechanism). */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const ACTION_SOURCE = codeOf(readFileSync(resolve(HERE, "actions.ts"), "utf8"));

async function redirectOf(domain: string): Promise<string> {
  const form = new FormData();
  form.set("domain", domain);
  try {
    await addDomain(form);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("addDomain returned without redirecting");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the panel's Add-domain action runs the SHARED project route", () => {
  it("hands @pseo/db/projects the service client, the session user and the raw input", async () => {
    openTrackedProject.mockResolvedValue({
      ok: true,
      project: { id: "p-sentinel", domain: "sentinel.example", outcome: "restored" },
    });

    const message = await redirectOf("https://Sentinel.example/typed-by-the-user");

    // The outcome and the domain the page was redirected with are the SENTINEL's — values no
    // real domain would produce, and values the action cannot have derived on its own. A
    // direct insert here could not have picked them up.
    expect(message).toBe("NEXT_REDIRECT /app/projects?added=restored&domain=sentinel.example");
    expect(openTrackedProject).toHaveBeenCalledExactlyOnceWith(
      { marker: "service-client" },
      "u-1",
      "https://Sentinel.example/typed-by-the-user",
    );
  });

  /**
   * The refusal path goes through the same route too — the action must not "helpfully" fall
   * back to its own insert when the shared route says no.
   */
  it("carries the shared route's refusal through without opening anything", async () => {
    openTrackedProject.mockResolvedValue({ ok: false, error: "not a public domain" });

    expect(await redirectOf("foo.internal")).toBe(
      "NEXT_REDIRECT /app/projects?error=invalid_domain",
    );
    expect(openTrackedProject).toHaveBeenCalledOnce();
  });
});

describe("the action owns no second write path (source pin)", () => {
  /**
   * Matched by the SHORTEST DISTINCTIVE FRAGMENT and tolerant of both quote styles and of the
   * order of the names inside the braces (signed lesson 11): a pin that only matches one
   * pasted line reports drift on the first reformat.
   */
  it("imports openTrackedProject from @pseo/db/projects", () => {
    expect(ACTION_SOURCE).toMatch(
      /import\s*\{[^}]*\bopenTrackedProject\b[^}]*\}\s*from\s*["']@pseo\/db\/projects["']/,
    );
  });

  /**
   * And writes NOTHING to the table itself. The spy above proves the route is called; only this
   * notices an insert added BESIDE that call — which is how a "just this one case" special path
   * (a domain the route refuses, forced in from the panel) would arrive.
   */
  it("issues no projects statement of its own", () => {
    expect(ACTION_SOURCE).not.toMatch(/\.from\(\s*["']projects["']\s*\)/i);
    expect(ACTION_SOURCE).not.toMatch(/\.(insert|upsert|update|delete)\(/i);
  });
});
