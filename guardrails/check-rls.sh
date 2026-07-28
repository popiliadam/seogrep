#!/usr/bin/env bash
# rls-enabled goal predicate -- FINAL STATE, not migration history.
#
# Replays the migrations in lexical (= apply) order and tracks, per public table, the LAST
# statement that touched RLS. A table is covered only if its FINAL state is BOTH
# "enable row level security" AND "force row level security". A later DISABLE / NO FORCE
# is therefore RED, which the previous grep-the-whole-history version could not see
# (audit M-12: every synthetic later-weakening false-PASSed).
#
# Migrations dir: $1, else $MIGRATIONS_DIR, else the repo default. Parameterised so
# guardrails/check-guards-selftest.sh can prove this gate actually goes red.
# Exit 0 = every table ends ENABLE+FORCE; exit 1 lists offenders with file:line.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
export LC_ALL=C

MIGRATIONS_DIR="${1:-${MIGRATIONS_DIR:-packages/db/supabase/migrations}}"
[ -d "$MIGRATIONS_DIR" ] || { echo "check-rls: no migrations dir: $MIGRATIONS_DIR"; exit 1; }

set -- "$MIGRATIONS_DIR"/*.sql
[ -e "$1" ] || { echo "check-rls: no .sql migrations in $MIGRATIONS_DIR"; exit 1; }

# -v q: the single-quote character. The awk program below is a single-quoted shell block,
# so the literal cannot appear inside it; string-literal tracking needs it (audit R4).
# -v dq: the double-quote character, for unquoting quoted identifiers (audit R7).
awk -v q="'" -v dq='"' '
function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }

# Index of the " that closes the quoted identifier opening at p, or 0 when this line has
# none. A doubled "" inside a quoted identifier is an escaped quote, not the end.
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

# Local is named z, not q: q is now the global quote character (see the -v above) and a
# parameter of that name would silently shadow it for anything this function called.
function tname(chunk,   z, t) {
  z = index(chunk, "public.")
  t = substr(chunk, z + 7)
  gsub(/"/, "", t)
  return t
}

# Prefix the identifier that follows <pre> with "public." when it carries no schema of its
# own: an unqualified name resolves through search_path, so SET search_path = public makes
# "alter table credit_ledger" mean exactly "alter table public.credit_ledger" (audit R6).
# A name that already names a schema keeps it and therefore stays out of scope, as before.
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

# ALTER TABLE [ IF EXISTS ] [ ONLY ] name is the keyword order PostgreSQL documents, and
# the gate used to match ONLY before IF EXISTS only (audit R3). Strip whichever of the two
# appear, in ANY order and any number of times, so the shapes below match one spelling.
function normalize(s) {
  while (sub(/^alter table (if exists|only) /, "alter table ", s)) { }
  sub(/^create table if not exists /, "create table ", s)
  sub(/^drop table if exists /, "drop table ", s)
  s = qualify(s, "alter table ")
  s = qualify(s, "create table ")
  s = qualify(s, "drop table ")
  return s
}

# Remember a table in first-seen order so the report is deterministic.
function note(t, f, l) {
  if (!(t in known)) { known[t] = 1; ord[++nord] = t; cloc[t] = f ":" l }
}

function handle(s, f, l,   t) {
  s = normalize(s)
  if (match(s, /^create table public\.[a-z0-9_]+/)) {
    t = tname(substr(s, RSTART, RLENGTH))
    note(t, f, l)
    made[t] = 1; cloc[t] = f ":" l
    # A freshly created table has RLS off until an ALTER turns it on.
    en[t] = 0; fo[t] = 0; enloc[t] = ""; foloc[t] = ""
    return
  }
  if (match(s, /^drop table public\.[a-z0-9_]+/)) {
    t = tname(substr(s, RSTART, RLENGTH))
    delete made[t]; delete en[t]; delete fo[t]; delete enloc[t]; delete foloc[t]
    return
  }
  if (match(s, /^alter table public\.[a-z0-9_]+/)) {
    t = tname(substr(s, RSTART, RLENGTH))
    # "no force" is checked first: it contains "force" as a substring.
    if (s ~ / no force row level security/)   { note(t, f, l); fo[t] = 0; foloc[t] = f ":" l }
    else if (s ~ / force row level security/) { note(t, f, l); fo[t] = 1; foloc[t] = f ":" l }
    if (s ~ / disable row level security/)    { note(t, f, l); en[t] = 0; enloc[t] = f ":" l }
    else if (s ~ / enable row level security/){ note(t, f, l); en[t] = 1; enloc[t] = f ":" l }
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

# A statement never spans two files.
FNR == 1 && NR > 1 { flush() }
# ...and neither does a string literal or a block comment, so an unbalanced quote can
# blind at most its own file instead of every migration that follows it.
FNR == 1 { inblock = 0; instr = 0; estr = 0 }

{
  # Lowercase, strip -- and /* */ comments, unquote quoted identifiers, then split into
  # statements on ";".
  # String literals are tracked (q is the quote character, passed in with -v because this
  # program lives in a single-quoted shell block) because two dashes INSIDE a literal start
  # no comment: without this the rest of that line was dropped and a real statement sharing
  # the line was swallowed (audit R4).
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
      # Inside an E-string (a literal introduced by a bare E) a backslash escapes the NEXT
      # character, so a backslash-quote pair does NOT end it, the two dashes that may
      # follow are DATA, and the real statement sharing the line must not be dropped
      # (audit c18). In a plain literal standard_conforming_strings makes the backslash an
      # ordinary character, and escaping THERE would swallow live statements instead - so
      # this is deliberately E-only rather than universal.
      if (estr && c == "\\") { out = out c substr(line, i + 1, 1); i += 2; continue }
      # A doubled quote inside a literal is an escaped quote, not the end of the string.
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
      # A leading E switches backslash escapes on, and that e must be a token of its own.
      estr = (i > 1 && substr(line, i - 1, 1) == "e" &&
              (i < 3 || substr(line, i - 2, 1) !~ /[a-z0-9_$]/)) ? 1 : 0
      out = out c
      i += 1
      continue
    }
    if (c == dq) {
      # Quoted identifier: PostgreSQL applies alter table public."credit_ledger" exactly
      # like the bare word, while every shape below matches bare words only (audit R7).
      # Unquote it - but ONLY when the closing quote is on this same line, so an unbalanced
      # double quote keeps the old behaviour instead of blinding the rest of the file.
      e = dqend(line, i)
      if (e > 0) {
        # The ORIGINAL characters are copied, not the folded ones: "Credit_Ledger" is a
        # DIFFERENT table from credit_ledger in postgres. A mixed-case quoted name then
        # matches no shape and is ignored exactly as before, whereas folding it would let a
        # quoted ENABLE on some other table cancel a real DISABLE - a loss of coverage.
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
  for (i = 1; i <= nord; i++) {
    t = ord[i]
    if (t in made) {
      ntab++
      if (en[t] != 1) {
        if (enloc[t] != "")
          printf "check-rls: FAIL public.%s - final state is DISABLE ROW LEVEL SECURITY (%s)\n", t, enloc[t]
        else
          printf "check-rls: FAIL public.%s - RLS never ENABLEd (table created at %s)\n", t, cloc[t]
        nfail++
      }
      if (fo[t] != 1) {
        if (foloc[t] != "")
          printf "check-rls: FAIL public.%s - final state is NO FORCE ROW LEVEL SECURITY (%s)\n", t, foloc[t]
        else
          printf "check-rls: FAIL public.%s - RLS never FORCEd (table created at %s)\n", t, cloc[t]
        nfail++
      }
    } else {
      # Table not created by these migrations: only an explicit weakening is reported.
      if (enloc[t] != "" && en[t] != 1) {
        printf "check-rls: FAIL public.%s - RLS DISABLEd at %s (table not created in these migrations)\n", t, enloc[t]
        nfail++
      }
      if (foloc[t] != "" && fo[t] != 1) {
        printf "check-rls: FAIL public.%s - FORCE removed at %s (table not created in these migrations)\n", t, foloc[t]
        nfail++
      }
    }
  }
  if (nfail > 0) {
    printf "CHECK-RLS: FAIL (%d finding(s) across %d tables)\n", nfail, ntab
    exit 1
  }
  printf "CHECK-RLS: PASS (%d tables, final state ENABLE + FORCE)\n", ntab
  exit 0
}
' "$@"
