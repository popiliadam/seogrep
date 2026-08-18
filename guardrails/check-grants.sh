#!/usr/bin/env bash
# grant-completeness goal predicate -- FINAL STATE, not migration history.
#
# THE HOLE THIS GATE EXISTS TO CLOSE. A table's privileges are not only what the migrations
# GRANT: they are the grants PLUS whatever the server's default ACL hands out at CREATE TABLE
# time. On the cloud project that default (grantor `postgres`, schema public, objtype 'r') is
# `arwdxtm` -- INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN -- for anon,
# authenticated AND service_role. So every table this repo creates is BORN on cloud with the
# full DML surface, every `grant select ...` line is a no-op there, and every migration comment
# that says "UPDATE/DELETE deliberately absent" is false on the only stack that takes money.
#
# WHY NO DB TEST CAN BE THIS GATE. The LOCAL stack's postgres-grantor default for a new public
# table is `xtm` -- REFERENCES/TRIGGER/MAINTAIN, no DML at all (measured 2026-08-18; 0016 and
# 0021 measured the same thing before). So locally the tables really do carry only what the
# migrations granted, and an assertion about relacl passes identically before and after the
# repair. A green local spec says NOTHING about the divergence. Migration 0028 repairs the
# state that exists today and shuts the default off going forward; THIS gate is what stops the
# next table being written without the revokes, and it is static precisely because the only
# stack where the bug is observable is one no gate can reach.
#
# THE PROPERTY. Replay the migrations in lexical (= apply) order. For every table (and view)
# that EXISTS in the final state, each of SELECT / INSERT / UPDATE / DELETE must be DECIDED for
# each of anon / authenticated / service_role -- explicitly GRANTed or explicitly REVOKEd.
# "Not mentioned" is the failure: not-mentioned is exactly what the default ACL fills in.
#
# COLUMN-LEVEL GRANTS DO NOT DECIDE, and that is the point rather than an omission.
# `grant select (a, b) on t to authenticated` confers no TABLE-level SELECT, so it leaves the
# default's table-wide SELECT standing -- which is how, on cloud, `authenticated` could read
# gsc_accounts.encrypted_refresh_token that 0021 believed a column list had fenced off. A
# column grant is therefore ignored here and the table-level pair stays undecided until a real
# REVOKE names it. (Measured: a table-level REVOKE also drops the column-level entries, so the
# migration must revoke and then re-grant the column list, in that order.)
#
# ALSO RED: any `alter default privileges ... grant ... on tables`, which would re-open the
# mechanism 0028 shut off.
#
# OUT OF SCOPE, said plainly: TRUNCATE (0016 + per-table revokes own it), REFERENCES / TRIGGER
# / MAINTAIN (0016 left them on purpose -- neither bypasses RLS nor destroys data), the
# `supabase_admin`-grantor default ACL a migration cannot alter (0016's documented residual),
# and any privilege held by a role other than the three named below.
#
# Migrations dir: $1, else $MIGRATIONS_DIR, else the repo default. Parameterised so
# guardrails/check-guards-selftest.sh can prove this gate actually goes red.
# Exit 0 = every privilege decided; exit 1 lists offenders with file:line.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
export LC_ALL=C

# Hardcoded on purpose: an env-overridable scope would be a way to shrink the gate.
GRANT_ROLES="anon authenticated service_role"
GRANT_PRIVS="select insert update delete"

MIGRATIONS_DIR="${1:-${MIGRATIONS_DIR:-packages/db/supabase/migrations}}"
[ -d "$MIGRATIONS_DIR" ] || { echo "check-grants: no migrations dir: $MIGRATIONS_DIR"; exit 1; }

set -- "$MIGRATIONS_DIR"/*.sql
[ -e "$1" ] || { echo "check-grants: no .sql migrations in $MIGRATIONS_DIR"; exit 1; }

# -v q / -v dq: the quote characters. The awk program is a single-quoted shell block, so the
# single quote cannot appear inside it, and both string-literal tracking and quoted-identifier
# unquoting need them. Same convention as check-rls.sh and check-append-only.sh.
awk -v roles="$GRANT_ROLES" -v privs="$GRANT_PRIVS" -v q="'" -v dq='"' '
function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }

# Index of the " that closes the quoted identifier opening at p, or 0 when this line has none.
# A doubled "" inside a quoted identifier is an escaped quote, not the end.
function dqend(s, p,   j, m) {
  m = length(s)
  j = p + 1
  while (j <= m) {
    if (substr(s, j, 1) == dq) {
      if (substr(s, j + 1, 1) == dq) { j += 2; continue }
      return j
    }
    j += 1
  }
  return 0
}

function tname(chunk,   z, t) {
  z = index(chunk, "public.")
  t = substr(chunk, z + 7)
  gsub(/"/, "", t)
  return t
}

# Prefix the identifier that follows <pre> with "public." when it carries no schema of its own:
# an unqualified name resolves through search_path, so SET search_path = public makes
# "create table projects" mean exactly "create table public.projects" (check-rls.sh audit R6).
function qualify(s, pre,   rest, tok, i, c, n) {
  if (index(s, pre) != 1) return s
  rest = substr(s, length(pre) + 1)
  n = length(rest)
  tok = ""
  for (i = 1; i <= n; i++) {
    c = substr(rest, i, 1)
    if (c ~ /[a-z0-9_"]/) tok = tok c; else break
  }
  if (tok == "" || substr(rest, i, 1) == ".") return s
  return pre "public." rest
}

# CREATE TABLE [ IF NOT EXISTS ] / DROP TABLE [ IF EXISTS ] / the view spellings, folded to one
# shape each so the matchers below need only one spelling apiece.
function normalize(s) {
  sub(/^create table if not exists /, "create table ", s)
  sub(/^drop table if exists /, "drop table ", s)
  sub(/^create or replace view /, "create view ", s)
  sub(/^create materialized view if not exists /, "create view ", s)
  sub(/^create materialized view /, "create view ", s)
  sub(/^create view if not exists /, "create view ", s)
  sub(/^drop materialized view if exists /, "drop table ", s)
  sub(/^drop materialized view /, "drop table ", s)
  sub(/^drop view if exists /, "drop table ", s)
  sub(/^drop view /, "drop table ", s)
  s = qualify(s, "create table ")
  s = qualify(s, "create view ")
  s = qualify(s, "drop table ")
  return s
}

# A dropped relation takes its GRANTs and REVOKEs with it, and a CREATE that follows starts
# again from the server default. Carrying the pre-DROP decisions forward would be a false
# GREEN of exactly the kind check-append-only.sh audit R2 found.
function forget(t,   r, v) {
  for (r = 1; r <= nrole; r++)
    for (v = 1; v <= npriv; v++) { delete pv[t, roleord[r], privord[v]]; }
}

function note(t, f, l) {
  if (!(t in known)) { known[t] = 1; ord[++nord] = t }
  cloc[t] = f ":" l
}

# Last GRANT/REVOKE wins, per (relation, role, privilege). Only the three named roles are
# tracked; a grant to some other role decides nothing here and is out of scope by design.
function applypriv(t, roles, vlist, isg, f, l,   nr, ra, r, rr, nv, va, v) {
  if (!(t in made)) return
  nr = split(roles, ra, ",")
  nv = split(vlist, va, " ")
  for (r = 1; r <= nr; r++) {
    rr = trim(ra[r])
    if (!(rr in roleseen)) continue
    for (v = 1; v <= nv; v++) {
      pv[t, rr, va[v]] = (isg ? "g" : "r")
      pvloc[t, rr, va[v]] = f ":" l
    }
  }
}

# Which of the four privileges this GRANT/REVOKE decides AT TABLE LEVEL. A privilege written
# with a column list confers (or removes) nothing table-wide, so it is skipped -- see the
# header. `pl` is padded with spaces so a word can be matched without anchoring worries.
function tablelevel(pl,   v, out, w) {
  pl = " " pl " "
  gsub(/[ \t]+/, " ", pl)
  out = ""
  # ALL / ALL PRIVILEGES covers every one of the four - unless IT carries a column list.
  if (pl ~ /[^a-z_]all[^a-z_]/ && pl !~ /[^a-z_]all *\(/ && pl !~ /[^a-z_]all privileges *\(/) {
    for (v = 1; v <= npriv; v++) out = out " " privord[v]
    return out
  }
  for (v = 1; v <= npriv; v++) {
    w = privord[v]
    if (pl ~ ("[^a-z_]" w " *\\(")) continue      # column-level: decides nothing table-wide
    if (pl ~ ("[^a-z_]" w "[^a-z_]")) out = out " " w
  }
  return out
}

function handle(s, f, l,   t, isg, rest, pl, obj, roles, sep, vlist, i, no, oa, ob, tt) {
  s = normalize(s)

  # The mechanism itself: re-granting DML through the schema default would put every FUTURE
  # table back where 0028 found them, while every per-table assertion below stayed green.
  if (s ~ /alter default privileges/ && s ~ / grant / && s ~ / on tables /) {
    defgrant[++ndefgrant] = f ":" l
    return
  }

  if (match(s, /^create table public\.[a-z0-9_]+/) || match(s, /^create view public\.[a-z0-9_]+/)) {
    t = tname(substr(s, RSTART, RLENGTH))
    note(t, f, l)
    forget(t)
    made[t] = 1
    return
  }
  if (match(s, /^drop table public\.[a-z0-9_]+/)) {
    t = tname(substr(s, RSTART, RLENGTH))
    forget(t); delete made[t]
    return
  }
  if (s !~ /^grant / && s !~ /^revoke /) return

  isg = (s ~ /^grant /) ? 1 : 0
  rest = isg ? substr(s, 7) : substr(s, 8)
  # REVOKE GRANT OPTION FOR <priv> takes away only the right to pass <priv> on; the privilege
  # itself survives, so counting it as a REVOKE would be a false GREEN (check-append-only.sh
  # audit R1 -- the same trap, in the shape this gate reads).
  if (!isg && rest ~ /^grant option for /) return
  i = index(rest, " on ")
  if (i == 0) return
  pl = substr(rest, 1, i - 1)
  rest = substr(rest, i + 4)
  if (isg) { i = index(rest, " to "); sep = 4 } else { i = index(rest, " from "); sep = 6 }
  if (i == 0) return
  obj = substr(rest, 1, i - 1)
  roles = substr(rest, i + sep)
  sub(/ with grant option$/, "", roles)
  sub(/ granted by .*$/, "", roles)
  sub(/ cascade$/, "", roles); sub(/ restrict$/, "", roles)

  vlist = tablelevel(pl)
  if (vlist == "") return

  # The object list may name several relations, or the whole schema at once.
  no = split(obj, oa, ",")
  for (i = 1; i <= no; i++) {
    ob = trim(oa[i]); sub(/^table /, "", ob)
    if (ob == "all tables in schema public") {
      for (tt = 1; tt <= nord; tt++) applypriv(ord[tt], roles, vlist, isg, f, l)
    } else if (ob ~ /^[a-z0-9_]+$/) {
      # Unqualified object: search_path resolves it, so judge it as public (audit R6).
      applypriv(ob, roles, vlist, isg, f, l)
    } else if (ob ~ /^public\.[a-z0-9_]+$/) {
      tt = ob; sub(/^public\./, "", tt)
      applypriv(tt, roles, vlist, isg, f, l)
    }
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
  nrole = split(roles, roleord, " ")
  for (b = 1; b <= nrole; b++) roleseen[roleord[b]] = 1
  npriv = split(privs, privord, " ")
}

# A statement never spans two files...
FNR == 1 && NR > 1 { flush() }
# ...and neither does a string literal or a block comment, so an unbalanced quote can blind at
# most its own file instead of every migration that follows it.
FNR == 1 { inblock = 0; instr = 0; estr = 0 }

{
  # Lowercase, strip -- and /* */ comments, unquote quoted identifiers, then split on ";".
  # This block is deliberately the SAME reader check-rls.sh and check-append-only.sh use; every
  # comment on it there records a measured leak, and a third, subtly different copy of it would
  # be a third set of leaks. Dollar-quoted bodies are NOT opaque: a GRANT inside a DO block
  # still has to be seen.
  line = tolower($0)
  out = ""
  i = 1
  n = length(line)
  while (i <= n) {
    c = substr(line, i, 1)
    if (inblock) {
      if (substr(line, i, 2) == "*/") { inblock = 0; i += 2 } else { i += 1 }
      continue
    }
    if (instr) {
      # Inside an E-string a backslash escapes the NEXT character, so a backslash-quote pair
      # does not end it and the two dashes that may follow are DATA (audit c18). In a plain
      # literal standard_conforming_strings makes the backslash ordinary, and escaping there
      # would swallow live statements - so this is deliberately E-only.
      if (estr && c == "\\") { out = out c substr(line, i + 1, 1); i += 2; continue }
      if (c == q) {
        if (substr(line, i + 1, 1) == q) { out = out c q; i += 2; continue }
        instr = 0
      }
      out = out c
      i += 1
      continue
    }
    c2 = substr(line, i, 2)
    if (c2 == "/*") { inblock = 1; i += 2; continue }
    if (c2 == "--") { i = n + 1; continue }
    if (c == q) {
      instr = 1
      estr = (i > 1 && substr(line, i - 1, 1) == "e" &&
              (i < 3 || substr(line, i - 2, 1) !~ /[a-z0-9_$]/)) ? 1 : 0
      out = out c
      i += 1
      continue
    }
    if (c == dq) {
      # Quoted identifier: postgres applies grant select on public."events" exactly like the
      # bare word, while every shape above matches bare words only (audit R7). Unquote it under
      # the two loss guards check-rls.sh documents at length: the closing quote must be on this
      # line, and the span must be a plain lowercase identifier (so DATA quotes are not paired
      # and a mixed-case name -- a DIFFERENT relation in postgres -- stays quoted).
      e = dqend(line, i)
      if (e > 0 && substr($0, i + 1, e - i - 1) ~ /^[a-z0-9_]+$/) {
        out = out substr($0, i + 1, e - i - 1)
        i = e + 1
        continue
      }
    }
    out = out c
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
  nfail = 0; ntab = 0

  for (d = 1; d <= ndefgrant; d++) {
    printf "check-grants: FAIL ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES at %s - this is the mechanism 0028 shut off; new tables would be born with it again\n", defgrant[d]
    nfail++
  }

  for (i = 1; i <= nord; i++) {
    t = ord[i]
    if (!(t in made)) continue
    ntab++
    for (r = 1; r <= nrole; r++) {
      rr = roleord[r]
      miss = ""
      for (v = 1; v <= npriv; v++) {
        st = pv[t, rr, privord[v]]
        if (st != "g" && st != "r") miss = miss (miss == "" ? "" : ", ") toupper(privord[v])
      }
      if (miss != "") {
        printf "check-grants: FAIL public.%s - %s: %s neither GRANTed nor REVOKEd (relation created at %s)\n", \
          t, rr, miss, cloc[t]
        nfail++
      }
    }
  }

  if (nfail > 0) {
    printf "CHECK-GRANTS: FAIL (%d finding(s) across %d relations)\n", nfail, ntab
    exit 1
  }
  printf "CHECK-GRANTS: PASS (%d relations, every SELECT/INSERT/UPDATE/DELETE decided for %s)\n", ntab, roles
  exit 0
}
' "$@"
