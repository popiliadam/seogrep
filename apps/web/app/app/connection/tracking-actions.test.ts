// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same posture as ./actions.test.ts, and the same fake tables (./fixtures/fake-db): the
// service-role client is faked, `lib/gsc/accounts.ts` runs for REAL against it, and the ONE
// network call inside `accessTokenFor` is the only thing stubbed — constitution NEVER #5.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@pseo/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pseo/core")>();
  return { ...actual, refreshAccessToken: vi.fn() };
});
vi.mock("@pseo/db/server", async () => {
  const { fakeDbServerModule } = await import("./fixtures/fake-db");
  return fakeDbServerModule();
});

const getUser = vi.fn();
vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

import { revalidatePath } from "next/cache";
import { encryptToken, refreshAccessToken, toByteaHex } from "@pseo/core";
import { db, filtersOf, type Row } from "./fixtures/fake-db";
import { restoreProject, trackProperty, untrackProject } from "./tracking-actions";

function signedIn(userId: string) {
  getUser.mockResolvedValue({ data: { user: { id: userId } } });
}
function signedOut() {
  getUser.mockResolvedValue({ data: { user: null } });
}

/**
 * TRACK / UNTRACK / RESTORE — the web half of `track_gsc_property` and `untrack_project`.
 *
 * THE TWO SURFACES MUST NOT DISAGREE ABOUT THE SAME ACTION, so every case below is one the
 * MCP tools already answered, re-asked here: the validation ORDER (listed → queryable →
 * recognisable domain → project → mapping), the refusal that happens BEFORE any project row
 * exists, archive-never-delete, the zero-row proof on each UPDATE, and idempotency in both
 * directions.
 *
 * `lib/gsc/accounts.ts` runs for REAL against the fake tables (only `refreshAccessToken` is
 * mocked) and `sites.list` is injected, so these specs make zero live requests — constitution
 * NEVER #5 — while still exercising the real unseal and its tenant filter.
 */
describe("track / untrack / restore", () => {
  const ENC_KEY = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  const ACCOUNT = "44444444-4444-4444-8444-444444444444";
  const PROJECT = "33333333-3333-4333-8333-333333333333";
  const REFRESH_TOKEN = "1//the-refresh-token";
  const ACCESS_TOKEN = "ya29.the-access-token";
  /**
   * A domain with NO reserved suffix and no word any assertion below looks for. The two
   * fixtures this branch already burned on — `archived.example` (Task 3) and `not-yours.test`
   * (Task 6) — were both refused by a normalizer for their TLD alone, so the refusal echoed
   * the fixture's own name and the spec passed against unmodified source. `.com` is refused by
   * nothing, so every refusal here has to come from the code under test.
   */
  const DOMAIN = "zephyrbrook.com";
  const PROPERTY = `sc-domain:${DOMAIN}`;
  /** Listed by Google, queryable, and NOT a website — `propertyToDomain` answers null. */
  const APP_PROPERTY = "android-app://com.zephyrbrook.reader";
  const ARCHIVED_AT = "2026-08-01T00:00:00.000Z";

  function accountRow(userId: string): Row {
    return {
      id: ACCOUNT,
      user_id: userId,
      google_account_sub: "google-sub-1",
      google_account_email: "owner@example.com",
      encrypted_refresh_token: toByteaHex(
        encryptToken(REFRESH_TOKEN, ENC_KEY, { userId, accountId: ACCOUNT }),
      ),
      token_status: "active",
      token_checked_at: null,
    };
  }

  function projectRow(userId: string, over: Row = {}): Row {
    return { id: PROJECT, user_id: userId, domain: DOMAIN, archived_at: null, ...over };
  }

  /** `sites.list` as Google answers it, injected so no request is ever made. */
  function listing(...sites: { siteUrl: string; permissionLevel: string }[]) {
    return { listSites: async () => sites };
  }

  /** The default: this account owns the property and Google will answer queries for it. */
  const OWNED = listing({ siteUrl: PROPERTY, permissionLevel: "siteOwner" });

  /** The project row the action created or reused — read back, never assumed. */
  function onlyProject(): Row {
    const rows = db.rows.projects ?? [];
    const [only, ...rest] = rows;
    if (!only || rest.length > 0) {
      throw new Error(`expected exactly one project row, saw ${rows.length}`);
    }
    return only;
  }

  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY);
    signedIn("user-1");
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: ACCESS_TOKEN,
      refreshToken: null,
      idToken: null,
      expiresIn: 3599,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      tokenType: "Bearer",
    });
    db.rows = { projects: [], gsc_accounts: [accountRow("user-1")], gsc_connections: [] };
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    db.rows = { gsc_accounts: [], gsc_connections: [], projects: [] };
    db.errors = {};
    db.hooks = {};
    db.tables = [];
    db.statements = [];
    db.ops = [];
  });

  /** Capture a server-side diagnostic instead of printing it into the test output. */
  function captureConsole(level: "warn" | "error") {
    return vi.spyOn(console, level).mockImplementation(() => {});
  }

  describe("trackProperty", () => {
    it("opens the project for the property's domain and maps it", async () => {
      expect(await trackProperty(ACCOUNT, PROPERTY, OWNED)).toEqual({ ok: true });

      const project = onlyProject();
      expect(project).toMatchObject({ user_id: "user-1", domain: DOMAIN });
      expect(db.rows.gsc_connections).toEqual([
        {
          user_id: "user-1",
          project_id: project.id,
          account_id: ACCOUNT,
          gsc_property: PROPERTY,
        },
      ]);
      expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/app/connection");
    });

    // Nothing arriving from the client is evidence — the same rule saveProjectProperty and
    // track_gsc_property both state. The picker's own list is minutes old at best.
    it("refuses a property the LIVE listing does not carry, and opens no project", async () => {
      const out = await trackProperty(
        ACCOUNT,
        PROPERTY,
        listing({ siteUrl: "https://elsewhere.org/", permissionLevel: "siteOwner" }),
      );

      expect(out).toEqual({ ok: false, error: expect.stringContaining("not listed") });
      expect(db.rows.projects).toEqual([]);
      expect(db.rows.gsc_connections).toEqual([]);
    });

    /**
     * VALIDATION ORDER, step 2. A project SeoGrep cannot answer for is worse than no project:
     * it reads as tracked and returns nothing (measured live 2026-08-09). So the refusal has to
     * land BEFORE the row exists, which is why this spec asserts the `projects` table was never
     * even reached rather than merely that it ended up empty.
     */
    it("refuses an unqueryable property BEFORE any project row exists", async () => {
      const out = await trackProperty(
        ACCOUNT,
        PROPERTY,
        listing({ siteUrl: PROPERTY, permissionLevel: "siteUnverifiedUser" }),
      );

      expect(out).toEqual({ ok: false, error: expect.stringContaining("cannot query") });
      expect(db.tables).not.toContain("projects");
      expect(db.rows.projects).toEqual([]);
      expect(db.rows.gsc_connections).toEqual([]);
    });

    /**
     * VALIDATION ORDER, step 3. `android-app://` properties are listed by `sites.list` and can
     * be owned outright, so this arrives past both earlier gates — and names no website, so
     * there is nothing to track. Same rule as `unrecognisedMessage` in track_gsc_property.
     */
    it("refuses a property that names no website BEFORE any project row exists", async () => {
      const out = await trackProperty(
        ACCOUNT,
        APP_PROPERTY,
        listing({ siteUrl: APP_PROPERTY, permissionLevel: "siteOwner" }),
      );

      expect(out).toEqual({ ok: false, error: expect.stringMatching(/does not recognise/i) });
      expect(db.tables).not.toContain("projects");
      expect(db.rows.projects).toEqual([]);
    });

    /**
     * VALIDATION ORDER, step 4 — the SHARED HOST GATE, and the divergence it closes.
     *
     * Until Task 8.5 this action opened a project for ANY property whose domain merely had the
     * right SHAPE, while `track_gsc_property` and `setup_project` refused internal / reserved
     * names outright (`normalizeDomain`). Two surfaces, same verb, opposite answers. The gate
     * now lives in @pseo/core and both call it.
     *
     * THE FIXTURE CANNOT ANSWER FOR THE CODE. This branch has twice shipped a spec that passed
     * against unmodified source because a refusal echoed the fixture's own name back
     * (`archived.example`, Task 3; `not-yours.test`, Task 6) — and reserved TLDs are this
     * spec's whole subject, so the trap is live here. `silverpine.corp` shares no substring
     * with the sentence asserted below, and the strongest claim made here is not about wording
     * at all: the `projects` table is never REACHED. A refusal that arrived after a row existed
     * would still carry the right sentence and still fail this spec.
     */
    it("refuses a reserved / internal host BEFORE any project row exists", async () => {
      const reserved = "sc-domain:silverpine.corp";

      const out = await trackProperty(
        ACCOUNT,
        reserved,
        listing({ siteUrl: reserved, permissionLevel: "siteOwner" }),
      );

      expect(out).toEqual({
        ok: false,
        error: expect.stringMatching(/internal or reserved names cannot be tracked/i),
      });
      expect(db.tables).not.toContain("projects");
      expect(db.rows.projects).toEqual([]);
      expect(db.rows.gsc_connections).toEqual([]);
    });

    /**
     * ARCHIVE, NEVER DELETE — this is what makes coming back free. The archived row keeps its
     * id, and so its crawls, reports and mapping; a second row for the same domain is both
     * impossible (unique (user_id, domain), migration 0010) and would orphan all of it.
     */
    it("brings an ARCHIVED project back on its own id instead of opening a second one", async () => {
      db.rows = { ...db.rows, projects: [projectRow("user-1", { archived_at: ARCHIVED_AT })] };

      expect(await trackProperty(ACCOUNT, PROPERTY, OWNED)).toEqual({ ok: true });

      expect(onlyProject()).toMatchObject({ id: PROJECT, archived_at: null });
      expect(db.rows.gsc_connections).toEqual([
        { user_id: "user-1", project_id: PROJECT, account_id: ACCOUNT, gsc_property: PROPERTY },
      ]);
    });

    /**
     * THE RACE, and the ONLY thing that separates ON CONFLICT DO NOTHING from a plain upsert on
     * this path. Added because dropping `ignoreDuplicates` reddened nothing at first: the action
     * READS before it writes, so in every single-threaded spec the insert either finds the row
     * already (and never runs) or conflicts with nothing. The branch is reachable only when a
     * concurrent first call takes the (user_id, domain) slot BETWEEN this action's read and its
     * write — which is what the hook does.
     *
     * The winner is ARCHIVED on purpose. DO NOTHING declines to touch it and returns no row, so
     * the action must read the winner back — and reading it back is what runs the archive check
     * on it. A plain upsert returns the winner's id straight out of the write, skips that check,
     * and maps a property onto a project still sitting in the archive.
     */
    it("a concurrent first call wins the slot: the winner is read back, archive check included", async () => {
      db.hooks = {
        "upsert:projects": () => {
          db.rows = { ...db.rows, projects: [projectRow("user-1", { archived_at: ARCHIVED_AT })] };
        },
      };

      expect(await trackProperty(ACCOUNT, PROPERTY, OWNED)).toEqual({ ok: true });

      expect(onlyProject()).toMatchObject({ id: PROJECT, archived_at: null });
      expect(db.rows.gsc_connections).toEqual([
        { user_id: "user-1", project_id: PROJECT, account_id: ACCOUNT, gsc_property: PROPERTY },
      ]);
    });

    it("tracking an ALREADY-tracked property is idempotent: same project, one mapping", async () => {
      db.rows = { ...db.rows, projects: [projectRow("user-1")] };

      expect(await trackProperty(ACCOUNT, PROPERTY, OWNED)).toEqual({ ok: true });
      expect(await trackProperty(ACCOUNT, PROPERTY, OWNED)).toEqual({ ok: true });

      expect(onlyProject()).toMatchObject({ id: PROJECT, archived_at: null });
      expect(db.rows.gsc_connections).toHaveLength(1);
    });

    /**
     * SILENT RE-POINTING STAYS (controller ruling, 2026-08-13). A project already mapped to a
     * different property is re-pointed with no warning and no confirmation step, because
     * `saveProjectProperty` — the picker's Save, on this same table — does the byte-identical
     * upsert. Two surfaces disagreeing about one action is worse than either answer.
     */
    it("re-points a project already mapped elsewhere, silently and onto the SAME row", async () => {
      db.rows = {
        ...db.rows,
        projects: [projectRow("user-1")],
        gsc_connections: [
          {
            id: "conn-1",
            user_id: "user-1",
            project_id: PROJECT,
            account_id: ACCOUNT,
            gsc_property: "https://old.zephyrbrook.com/",
          },
        ],
      };

      // `toEqual`, not `toMatchObject`: a warning field smuggled onto the success would fail.
      expect(await trackProperty(ACCOUNT, PROPERTY, OWNED)).toEqual({ ok: true });

      expect(db.rows.gsc_connections).toEqual([
        {
          id: "conn-1",
          user_id: "user-1",
          project_id: PROJECT,
          account_id: ACCOUNT,
          gsc_property: PROPERTY,
        },
      ]);
    });

    /**
     * FAIL CLOSED ON A LISTING WE NEVER GOT BACK. An absence we did not observe is not an
     * absence — the account may well list this property — so nothing is opened and nothing is
     * mapped. This is the single-account shape of track_gsc_property's undecidable refusal:
     * the web action always NAMES its account, so no other account is ever consulted and the
     * "one account answered, another did not" state cannot arise here.
     */
    it("a listing that could not be read tracks NOTHING", async () => {
      const error = captureConsole("error");
      vi.mocked(refreshAccessToken).mockRejectedValue(
        new Error("Google token endpoint failed (400): invalid_grant"),
      );

      const out = await trackProperty(ACCOUNT, PROPERTY, OWNED);

      expect(out).toEqual({ ok: false, error: expect.stringContaining("Reconnect") });
      expect(db.tables).not.toContain("projects");
      expect(db.rows.projects).toEqual([]);
      expect(db.rows.gsc_connections).toEqual([]);
      expect(error).toHaveBeenCalled();
      expect(JSON.stringify(out)).not.toContain(REFRESH_TOKEN);
    });

    /**
     * Constitution NEVER #4. Another tenant holds a project for the SAME domain, which is
     * legitimate — two users may track one site. The read must not find it, so this call opens
     * the caller's OWN project and leaves the stranger's row untouched.
     */
    it("never lands on another tenant's project of the same domain", async () => {
      const otherTenantRow = projectRow("user-2");
      db.rows = { ...db.rows, projects: [otherTenantRow] };

      expect(await trackProperty(ACCOUNT, PROPERTY, OWNED)).toEqual({ ok: true });

      expect(filtersOf("projects", "select")).toEqual([
        { column: "user_id", value: "user-1" },
        { column: "domain", value: DOMAIN },
      ]);
      expect(db.rows.projects).toContainEqual(otherTenantRow);
      expect(db.rows.projects).toHaveLength(2);
      const mine = (db.rows.projects ?? []).find((row) => row.user_id === "user-1");
      expect(mine?.id).not.toBe(PROJECT);
      expect(db.rows.gsc_connections).toEqual([
        { user_id: "user-1", project_id: mine?.id, account_id: ACCOUNT, gsc_property: PROPERTY },
      ]);
    });

    // NEVER #4 again, on the WRITE: the service-role client bypasses RLS, so the session user
    // riding both as a column and inside the conflict target is the whole boundary.
    it("maps with the SESSION user id and conflicts on (user_id, project_id)", async () => {
      await trackProperty(ACCOUNT, PROPERTY, OWNED);

      expect(filtersOf("gsc_connections", "upsert")).toEqual([
        { column: "user_id", value: "user-1" },
        { column: "project_id", value: onlyProject().id },
      ]);
    });

    /**
     * The restore UPDATE PROVES it matched a row. PostgREST answers a zero-row UPDATE with no
     * error at all, so reporting success from `error === null` would tell the user their
     * archived project is tracked again while it is still in the archive. The hook deletes the
     * row between the ownership read and the write — the race the proof exists for.
     */
    it("a restore that matched NO row is a refusal, not a silent success", async () => {
      db.rows = { ...db.rows, projects: [projectRow("user-1", { archived_at: ARCHIVED_AT })] };
      db.hooks = {
        "update:projects": () => {
          db.rows = { ...db.rows, projects: [] };
        },
      };

      const out = await trackProperty(ACCOUNT, PROPERTY, OWNED);

      expect(out).toEqual({ ok: false, error: expect.stringMatching(/nothing was tracked/i) });
      expect(db.rows.gsc_connections).toEqual([]);
    });

    it("carries both tenant filters on the restore UPDATE", async () => {
      db.rows = { ...db.rows, projects: [projectRow("user-1", { archived_at: ARCHIVED_AT })] };

      await trackProperty(ACCOUNT, PROPERTY, OWNED);

      expect(filtersOf("projects", "update")).toEqual([
        { column: "id", value: PROJECT },
        { column: "user_id", value: "user-1" },
      ]);
    });

    it("rejects with no session and never queries", async () => {
      signedOut();
      await expect(trackProperty(ACCOUNT, PROPERTY, OWNED)).rejects.toThrow(/not authenticated/i);
      expect(db.tables).toEqual([]);
    });

    it("refuses a malformed account id without querying the DB", async () => {
      expect(await trackProperty("not-a-uuid", PROPERTY, OWNED)).toEqual({
        ok: false,
        error: expect.stringContaining("not found"),
      });
      expect(db.tables).toEqual([]);
    });

    it("refuses an empty property without contacting Google", async () => {
      expect(await trackProperty(ACCOUNT, "", OWNED)).toEqual({
        ok: false,
        error: expect.stringContaining("not listed"),
      });
      expect(db.tables).toEqual([]);
      expect(vi.mocked(refreshAccessToken)).not.toHaveBeenCalled();
    });

    it("a failed mapping write answers ok:false and keeps the DB message server-side", async () => {
      const error = captureConsole("error");
      db.errors = { "upsert:gsc_connections": { message: "deadlock detected" } };

      const out = await trackProperty(ACCOUNT, PROPERTY, OWNED);

      expect(out).toEqual({ ok: false, error: expect.stringContaining("Could not save") });
      expect(JSON.stringify(out)).not.toContain("deadlock detected");
      expect(db.rows.gsc_connections).toEqual([]);
      expect(error).toHaveBeenCalled();
    });
  });

  describe("untrackProject", () => {
    /**
     * IT ARCHIVES, IT NEVER DELETES, and the surviving mapping is what makes restore free. A
     * DELETE would cascade `gsc_connections` away and orphan every job, so a domain added again
     * later could never re-attach its own past.
     */
    it("stamps archived_at and leaves the Search Console mapping untouched", async () => {
      const mapping = {
        id: "conn-1",
        user_id: "user-1",
        project_id: PROJECT,
        account_id: ACCOUNT,
        gsc_property: PROPERTY,
      };
      db.rows = { ...db.rows, projects: [projectRow("user-1")], gsc_connections: [mapping] };

      expect(await untrackProject(PROJECT)).toEqual({ ok: true });

      expect(onlyProject().archived_at).toEqual(expect.any(String));
      expect(db.rows.gsc_connections).toEqual([mapping]);
      // Only `projects` is touched — never the mapping, and never the ledger (NEVER #2).
      expect(db.tables).toEqual(["projects", "projects"]);
      expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/app/connection");
    });

    /**
     * IDEMPOTENT, AND WITHOUT RE-STAMPING: no write runs, so the date the tenant actually put
     * the project away survives a second call.
     */
    it("an already-archived project succeeds without re-stamping the date", async () => {
      db.rows = { ...db.rows, projects: [projectRow("user-1", { archived_at: ARCHIVED_AT })] };

      expect(await untrackProject(PROJECT)).toEqual({ ok: true });

      expect(onlyProject().archived_at).toBe(ARCHIVED_AT);
      expect(db.ops).toEqual(["select:projects"]);
      // Nothing was written, but the view that offered Untrack was wrong about where this
      // project stood — a stale page must still be corrected, or the button looks inert.
      expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/app/connection");
    });

    it("refuses another tenant's project opaquely and archives nothing", async () => {
      const otherTenantRow = projectRow("user-2");
      db.rows = { ...db.rows, projects: [otherTenantRow] };

      expect(await untrackProject(PROJECT)).toEqual({
        ok: false,
        error: expect.stringContaining("not found"),
      });
      expect(db.rows.projects).toEqual([otherTenantRow]);
      expect(db.ops).toEqual(["select:projects"]);
    });

    it("carries both tenant filters on the UPDATE", async () => {
      db.rows = { ...db.rows, projects: [projectRow("user-1")] };

      await untrackProject(PROJECT);

      expect(filtersOf("projects", "update")).toEqual([
        { column: "id", value: PROJECT },
        { column: "user_id", value: "user-1" },
      ]);
    });

    /**
     * The zero-row proof, head-on: `error === null` on an UPDATE that matched nothing says the
     * statement was fine, never that anything changed. Reporting "stopped tracking" from it is
     * exactly the defect Task 4's referee found in setup_project's twin write.
     */
    it("an UPDATE that matched NO row is a refusal, not a silent success", async () => {
      db.rows = { ...db.rows, projects: [projectRow("user-1")] };
      db.hooks = {
        "update:projects": () => {
          db.rows = { ...db.rows, projects: [] };
        },
      };

      expect(await untrackProject(PROJECT)).toEqual({
        ok: false,
        error: expect.stringMatching(/nothing was archived/i),
      });
    });

    it("a failed UPDATE answers ok:false and keeps the DB message server-side", async () => {
      const error = captureConsole("error");
      db.rows = { ...db.rows, projects: [projectRow("user-1")] };
      db.errors = { "update:projects": { message: "deadlock detected" } };

      const out = await untrackProject(PROJECT);

      expect(out).toEqual({ ok: false, error: expect.stringContaining("Could not stop tracking") });
      expect(JSON.stringify(out)).not.toContain("deadlock detected");
      expect(onlyProject().archived_at).toBeNull();
      expect(error).toHaveBeenCalled();
      expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    });

    it("rejects with no session and never queries", async () => {
      signedOut();
      await expect(untrackProject(PROJECT)).rejects.toThrow(/not authenticated/i);
      expect(db.tables).toEqual([]);
    });

    it("refuses a malformed project id without querying the DB", async () => {
      expect(await untrackProject("not-a-uuid")).toEqual({
        ok: false,
        error: expect.stringContaining("not found"),
      });
      expect(db.tables).toEqual([]);
    });
  });

  describe("restoreProject", () => {
    it("clears archived_at on a project the caller owns", async () => {
      db.rows = { ...db.rows, projects: [projectRow("user-1", { archived_at: ARCHIVED_AT })] };

      expect(await restoreProject(PROJECT)).toEqual({ ok: true });

      expect(onlyProject()).toMatchObject({ id: PROJECT, archived_at: null });
      expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/app/connection");
    });

    it("restoring an ACTIVE project succeeds without writing", async () => {
      db.rows = { ...db.rows, projects: [projectRow("user-1")] };

      expect(await restoreProject(PROJECT)).toEqual({ ok: true });

      expect(db.ops).toEqual(["select:projects"]);
      expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/app/connection");
    });

    it("refuses another tenant's project opaquely and restores nothing", async () => {
      const otherTenantRow = projectRow("user-2", { archived_at: ARCHIVED_AT });
      db.rows = { ...db.rows, projects: [otherTenantRow] };

      expect(await restoreProject(PROJECT)).toEqual({
        ok: false,
        error: expect.stringContaining("not found"),
      });
      expect(db.rows.projects).toEqual([otherTenantRow]);
      expect(db.ops).toEqual(["select:projects"]);
    });

    it("carries both tenant filters on the UPDATE", async () => {
      db.rows = { ...db.rows, projects: [projectRow("user-1", { archived_at: ARCHIVED_AT })] };

      await restoreProject(PROJECT);

      expect(filtersOf("projects", "update")).toEqual([
        { column: "id", value: PROJECT },
        { column: "user_id", value: "user-1" },
      ]);
    });

    it("an UPDATE that matched NO row is a refusal, not a silent success", async () => {
      db.rows = { ...db.rows, projects: [projectRow("user-1", { archived_at: ARCHIVED_AT })] };
      db.hooks = {
        "update:projects": () => {
          db.rows = { ...db.rows, projects: [] };
        },
      };

      expect(await restoreProject(PROJECT)).toEqual({
        ok: false,
        error: expect.stringMatching(/nothing was restored/i),
      });
    });

    it("a failed UPDATE answers ok:false and keeps the DB message server-side", async () => {
      const error = captureConsole("error");
      db.rows = { ...db.rows, projects: [projectRow("user-1", { archived_at: ARCHIVED_AT })] };
      db.errors = { "update:projects": { message: "deadlock detected" } };

      const out = await restoreProject(PROJECT);

      expect(out).toEqual({ ok: false, error: expect.stringContaining("Could not restore") });
      expect(JSON.stringify(out)).not.toContain("deadlock detected");
      expect(onlyProject().archived_at).toBe(ARCHIVED_AT);
      expect(error).toHaveBeenCalled();
      expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    });

    it("rejects with no session and never queries", async () => {
      signedOut();
      await expect(restoreProject(PROJECT)).rejects.toThrow(/not authenticated/i);
      expect(db.tables).toEqual([]);
    });

    it("refuses a malformed project id without querying the DB", async () => {
      expect(await restoreProject("not-a-uuid")).toEqual({
        ok: false,
        error: expect.stringContaining("not found"),
      });
      expect(db.tables).toEqual([]);
    });
  });
});
