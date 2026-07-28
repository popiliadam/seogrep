#!/usr/bin/env bash
# append-only-armor goal predicate -- FINAL STATE, not migration history.
#
# Two tables are armored append-only in the committed migrations: public.credit_ledger
# (0002) and public.events (0003). Both must END the migration sequence with
#   1. public.reject_mutation() defined AND still raising,
#   2. UPDATE/DELETE/TRUNCATE revoked from anon/authenticated/service_role and granted
#      to NOBODY (any role),
#   3. a live, enabled BEFORE UPDATE OR DELETE trigger that executes reject_mutation().
# The previous version grepped the whole migration history for those three shapes, so a
# later GRANT UPDATE / DROP TRIGGER / neutered function false-PASSed, and public.events
# was out of scope entirely (audit M-12). This version replays the migrations in lexical
# (= apply) order and only judges the final state.
#
# Grep/awk based and DB-less on purpose so `make goals` needs no Supabase stack; the LIVE
# negative that proves the armor actually rejects (even for service_role) runs in
# guardrails/verify-db.sh via append-only-armor.db.test.ts.
# Migrations dir: $1, else $MIGRATIONS_DIR, else the repo default (parameterised so
# guardrails/check-guards-selftest.sh can prove this gate actually goes red).
# Exit 0 = armor intact; exit 1 lists what broke it, with file:line.
# (CLAUDE.md NEVER #2 -- the ledger stays append-only.)
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
export LC_ALL=C

# Hardcoded on purpose: an env-overridable scope would be a way to shrink the gate.
ARMORED_TABLES="credit_ledger events"

MIGRATIONS_DIR="${1:-${MIGRATIONS_DIR:-packages/db/supabase/migrations}}"
[ -d "$MIGRATIONS_DIR" ] || { echo "check-append-only: no migrations dir: $MIGRATIONS_DIR"; exit 1; }

set -- "$MIGRATIONS_DIR"/*.sql
[ -e "$1" ] || { echo "check-append-only: no .sql migrations in $MIGRATIONS_DIR"; exit 1; }

awk -v armored="$ARMORED_TABLES" '
function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }

function tname(chunk,   z, t) {
  z = index(chunk, "public.")
  t = substr(chunk, z + 7)
  gsub(/"/, "", t)
  return t
}

# Last GRANT/REVOKE wins, per (table, role, privilege).
function applypriv(t, roles, vlist, isg, f, l,   nr, ra, r, rr, nv, va, v) {
  nr = split(roles, ra, ",")
  nv = split(vlist, va, " ")
  for (r = 1; r <= nr; r++) {
    rr = trim(ra[r])
    if (rr == "") continue
    if (!(rr in roleseen)) { roleseen[rr] = 1; roleord[++nrole] = rr }
    for (v = 1; v <= nv; v++) {
      pv[t, rr, va[v]] = (isg ? "g" : "r")
      pvloc[t, rr, va[v]] = f ":" l
    }
  }
}

function handle(s, f, l,   t, nm, head, parts, np, isg, rest, privs, obj, roles,
                           sep, vlist, pp, pa, oa, ob, tt, dis, q, q2, q3, no) {
  if (s ~ /^create (or replace )?function public\.reject_mutation *\(/) {
    fnexists = 1; fnloc = f ":" l
    fnraise = (s ~ /raise exception/) ? 1 : 0
    return
  }
  if (s ~ /^drop function (if exists )?public\.reject_mutation/) {
    fnexists = 0; fnraise = 0; fnloc = f ":" l
    return
  }
  if (match(s, /^create table (if not exists )?public\.[a-z0-9_]+/)) {
    t = tname(substr(s, RSTART, RLENGTH))
    if (t in arm) made[t] = 1
    return
  }
  if (match(s, /^drop table (if exists )?public\.[a-z0-9_]+/)) {
    t = tname(substr(s, RSTART, RLENGTH))
    if (t in arm) delete made[t]
    return
  }
  if (match(s, /^create (or replace )?(constraint )?trigger [a-z0-9_]+/)) {
    head = substr(s, RSTART, RLENGTH)
    np = split(head, parts, " ")
    nm = parts[np]
    if (match(s, / on public\.[a-z0-9_]+/)) {
      t = tname(substr(s, RSTART, RLENGTH))
      if (t in arm) {
        if (trgknown[t, nm] != 1) { trgknown[t, nm] = 1; tnames[t] = tnames[t] " " nm }
        trg[t, nm] = 1; trgdis[t, nm] = 0; trgloc[t, nm] = f ":" l
        trgok[t, nm] = (s ~ / before [a-z ]*update/ && s ~ / before [a-z ]*delete/ &&
                        s ~ /execute (function|procedure) public\.reject_mutation/) ? 1 : 0
      }
    }
    return
  }
  if (match(s, /^drop trigger (if exists )?[a-z0-9_]+ on public\.[a-z0-9_]+/)) {
    head = substr(s, RSTART, RLENGTH)
    np = split(head, parts, " ")
    t = tname(parts[np]); nm = parts[np - 2]
    if (t in arm) { delete trg[t, nm]; trgkill[t, nm] = f ":" l }
    return
  }
  if (s ~ /^alter table (only )?public\.[a-z0-9_]+ (disable|enable) trigger /) {
    match(s, /^alter table (only )?public\.[a-z0-9_]+/)
    t = tname(substr(s, RSTART, RLENGTH))
    if (t in arm) {
      match(s, / trigger [a-z0-9_]+/)
      nm = substr(s, RSTART + 9, RLENGTH - 9)
      dis = (s ~ / disable trigger /) ? 1 : 0
      if (nm == "all" || nm == "user") { alldis[t] = dis; alldisloc[t] = f ":" l }
      else { trgdis[t, nm] = dis; if (dis) trgkill[t, nm] = f ":" l }
    }
    return
  }
  if (s ~ /^grant / || s ~ /^revoke /) {
    isg = (s ~ /^grant /) ? 1 : 0
    rest = isg ? substr(s, 7) : substr(s, 8)
    if (!isg) sub(/^grant option for /, "", rest)
    q = index(rest, " on ")
    if (q == 0) return
    privs = substr(rest, 1, q - 1)
    rest = substr(rest, q + 4)
    if (isg) { q = index(rest, " to "); sep = 4 } else { q = index(rest, " from "); sep = 6 }
    if (q == 0) return
    obj = substr(rest, 1, q - 1)
    roles = substr(rest, q + sep)
    sub(/ with grant option$/, "", roles)
    sub(/ granted by .*$/, "", roles)
    sub(/ cascade$/, "", roles); sub(/ restrict$/, "", roles)
    gsub(/\([^)]*\)/, "", privs)        # column-level grants: drop the column list
    np = split(privs, pa, ",")
    vlist = ""
    for (q2 = 1; q2 <= np; q2++) {
      pp = trim(pa[q2])
      if (pp == "all" || pp == "all privileges") { vlist = " update delete truncate"; break }
      if (pp == "update" || pp == "delete" || pp == "truncate") vlist = vlist " " pp
    }
    if (vlist == "") return
    no = split(obj, oa, ",")
    for (q2 = 1; q2 <= no; q2++) {
      ob = trim(oa[q2]); sub(/^table /, "", ob)
      if (ob == "all tables in schema public") {
        for (q3 = 1; q3 <= narm; q3++) applypriv(armlist[q3], roles, vlist, isg, f, l)
      } else if (ob ~ /^public\.[a-z0-9_]+$/) {
        tt = ob; sub(/^public\./, "", tt)
        if (tt in arm) applypriv(tt, roles, vlist, isg, f, l)
      }
    }
    return
  }
}

function addpart(part) {
  if (stmt !~ /[^ \t]/ && part ~ /[^ \t]/) { sfile = FILENAME; sline = FNR }
  stmt = stmt " " part
}

function flush(   s) {
  s = stmt
  gsub(/[ \t]+/, " ", s)
  s = trim(s)
  if (s != "") handle(s, sfile, sline)
  stmt = ""; sfile = ""; sline = 0
}

BEGIN {
  narm = split(armored, armlist, " ")
  for (b = 1; b <= narm; b++) arm[armlist[b]] = 1
  nverb = split("update delete truncate", verbs, " ")
  nreq = split("anon authenticated service_role", reqroles, " ")
  for (b = 1; b <= nreq; b++) {
    req[reqroles[b]] = 1; roleseen[reqroles[b]] = 1; roleord[++nrole] = reqroles[b]
  }
}

# A statement never spans two files.
FNR == 1 && NR > 1 { flush() }

{
  # Lowercase, strip -- and /* */ comments, then split into statements on ";".
  # Dollar-quoted bodies are deliberately NOT treated as opaque: a GRANT hidden inside a
  # DO block still has to be seen.
  line = tolower($0)
  out = ""
  i = 1
  n = length(line)
  while (i <= n) {
    c2 = substr(line, i, 2)
    if (inblock) {
      if (c2 == "*/") { inblock = 0; i += 2 } else { i += 1 }
      continue
    }
    if (c2 == "/*") { inblock = 1; i += 2; continue }
    if (c2 == "--") { i = n + 1; continue }
    out = out substr(line, i, 1)
    i += 1
  }
  line = out
  while ((p = index(line, ";")) > 0) {
    addpart(substr(line, 1, p - 1))
    flush()
    line = substr(line, p + 1)
  }
  addpart(line)
}

END {
  flush()
  nfail = 0
  if (!fnexists) {
    print "check-append-only: FAIL public.reject_mutation() is not defined in the final state"
    nfail++
  } else if (!fnraise) {
    printf "check-append-only: FAIL public.reject_mutation() no longer RAISEs - neutered at %s\n", fnloc
    nfail++
  }

  for (a = 1; a <= narm; a++) {
    t = armlist[a]
    if (!(t in made)) {
      printf "check-append-only: FAIL public.%s - armored table does not exist in the final state\n", t
      nfail++
      continue
    }
    for (r = 1; r <= nrole; r++) {
      rr = roleord[r]
      for (v = 1; v <= nverb; v++) {
        vb = verbs[v]
        st = pv[t, rr, vb]
        if (st == "g") {
          printf "check-append-only: FAIL public.%s - %s is GRANTed to %s (%s)\n", \
            t, toupper(vb), rr, pvloc[t, rr, vb]
          nfail++
        } else if ((rr in req) && st != "r") {
          printf "check-append-only: FAIL public.%s - %s is never REVOKEd from %s\n", t, toupper(vb), rr
          nfail++
        }
      }
    }
    live = 0
    nnm = split(tnames[t], nma, " ")
    for (k = 1; k <= nnm; k++) {
      nm2 = nma[k]
      if (!trg[t, nm2]) continue
      if (alldis[t] == 1 || trgdis[t, nm2] == 1) continue
      if (trgok[t, nm2] != 1) continue
      live++
    }
    if (live == 0) {
      printf "check-append-only: FAIL public.%s - no live BEFORE UPDATE OR DELETE trigger executing public.reject_mutation()\n", t
      nfail++
      for (k = 1; k <= nnm; k++) {
        nm2 = nma[k]
        if (!trg[t, nm2]) {
          printf "  trigger %s: DROPPED at %s\n", nm2, trgkill[t, nm2]
        } else if (alldis[t] == 1) {
          printf "  trigger %s: DISABLED by ALTER TABLE ... DISABLE TRIGGER ALL at %s\n", nm2, alldisloc[t]
        } else if (trgdis[t, nm2] == 1) {
          printf "  trigger %s: DISABLED at %s\n", nm2, trgkill[t, nm2]
        } else if (trgok[t, nm2] != 1) {
          printf "  trigger %s at %s: not BEFORE UPDATE OR DELETE ... EXECUTE public.reject_mutation()\n", \
            nm2, trgloc[t, nm2]
        }
      }
    }
  }

  if (nfail > 0) {
    printf "CHECK-APPEND-ONLY: FAIL (%d finding(s))\n", nfail
    exit 1
  }
  printf "CHECK-APPEND-ONLY: PASS (final state armored: %s - REVOKE + live reject_mutation trigger)\n", armored
  exit 0
}
' "$@"
