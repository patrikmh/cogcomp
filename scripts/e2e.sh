#!/usr/bin/env bash
#
# End-to-end test: drives the real app in a real browser against the real backend.
#
# The unit and integration suites verify the backend in isolation. This verifies the
# thing a person actually touches — that the auth gate redirects, that an entry
# survives the round trip and comes back rendered, and that a low-confidence
# inference is presented as a guess rather than as knowledge.
#
# The app runs as React Native Web so Playwright can drive it. Web is a test
# surface, not a shipping one — see src/state/storage.ts for what that costs.
#
# Prerequisites:
#   - Postgres running (infrastructure/docker-compose.yml)
#   - nothing already bound to 8080 or 8081
#
# Usage: scripts/e2e.sh

set -uo pipefail
# Keep the browser, shell date helpers, and API summary buckets on one explicit
# timezone. This prevents a local midnight from disagreeing with the browser's
# Today route during the run.
export TZ=UTC

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT=8080
WEB_PORT=8081
API_URL="http://localhost:${API_PORT}"
E2E_DATABASE_URL="${E2E_DATABASE_URL:-postgres://tlon:tlon@127.0.0.1:5433/tlon_e2e_$$}"
FALKOR_DATABASE="tlon_e2e_$$"

if ! E2E_DATABASE_URL="$E2E_DATABASE_URL" python3 - <<'PYDB'
from urllib.parse import unquote, urlparse
import os
import re

url = urlparse(os.environ["E2E_DATABASE_URL"])
if url.scheme not in {"postgres", "postgresql"} or url.hostname not in {"localhost", "127.0.0.1", "::1"}:
    raise SystemExit("E2E_DATABASE_URL must be a local PostgreSQL URL")
database = unquote(url.path.lstrip("/"))
if not re.fullmatch(r"tlon_e2e_[a-z0-9_]+", database):
    raise SystemExit("E2E_DATABASE_URL database must match tlon_e2e_*")
PYDB
then
  exit 1
fi
export E2E_DATABASE_URL
# E2E is an isolated local contract: never inherit remote agents or graph
# settings, even when the caller's shell has production-like values.
export AGENTS_ENABLED=false
export FALKOR_HOST=127.0.0.1
export FALKOR_PORT=6379
export FALKOR_DATABASE

# The section names come from the design, through the same file both clients
# render them from. Asserting on a literal here is how this suite came to
# describe screens that had been renamed underneath it: the app changed, the
# script did not, and nothing failed until the next full run.
#
#   section kept  ->  What they left behind
section() {
  python3 - "$ROOT" "$1" <<'PYSEC'
import re, sys
src = open(sys.argv[1] + "/packages/copy/sections.ts").read()
found = re.search(r"\b" + re.escape(sys.argv[2]) + r":\s*\{[^}]*?title:\s*\"([^\"]+)\"", src)
print(found.group(1) if found else "")
PYSEC
}

WEB_URL="http://localhost:${WEB_PORT}"
LOGS="$(mktemp -d)"
# Keep bearer tokens out of the external curl process argv. Calls below can
# continue to read naturally while this wrapper moves Authorization headers to
# a mode-600 temporary file before invoking the real binary.
AUTH_HEADER_FILE="$(mktemp "${LOGS}/auth-header.XXXXXX")"
chmod 600 "$AUTH_HEADER_FILE"
curl() {
  local -a safe=() input=("$@")
  local index arg next
  for ((index = 0; index < ${#input[@]}; index += 1)); do
    arg="${input[index]}"
    if [ "$arg" = "-H" ] && [ $((index + 1)) -lt "${#input[@]}" ]; then
      next="${input[index + 1]}"
      if [[ "$next" == Authorization:\ Bearer\ * ]]; then
        printf '%s\n' "$next" >"$AUTH_HEADER_FILE"
        safe+=( -H "@${AUTH_HEADER_FILE}" )
        index=$((index + 1))
        continue
      fi
    fi
    safe+=( "$arg" )
  done
  command curl "${safe[@]}"
}
# Refs are generated from the newest snapshot. Old snapshots from a previous
# run can otherwise make a navigation wait pass before the new route exists and
# send the next click to a stale control.
rm -f "${ROOT}/.playwright-cli"/page-*.yml "${ROOT}/.playwright-cli"/console-*.log
EMAIL="e2e-$(date +%s)@example.com"
PASSWORD="a long enough passphrase"

FAILURES=0
STARTED_API=0
STARTED_WEB=0
DATABASE_CREATED=0

create_database() {
  E2E_DATABASE_URL="$E2E_DATABASE_URL" "${ROOT}/apps/backend/.venv/bin/python" - <<'PYCREATE'
import asyncio
import os
import re
from urllib.parse import unquote, urlparse

import asyncpg


async def main():
    database_url = os.environ["E2E_DATABASE_URL"]
    url = urlparse(database_url)
    database = unquote(url.path.lstrip("/"))
    if not re.fullmatch(r"tlon_e2e_[a-z0-9_]+", database):
        raise RuntimeError("refusing to create a non-disposable E2E database")

    admin_url = url._replace(path="/postgres").geturl()
    connection = await asyncpg.connect(admin_url)
    try:
        if await connection.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1", database
        ):
            raise RuntimeError(f"E2E database already exists: {database}")
        identifier = '"' + database.replace('"', '""') + '"'
        await connection.execute(f"CREATE DATABASE {identifier}")
    finally:
        await connection.close()


asyncio.run(main())
PYCREATE
}

drop_falkor_graph() {
  "${ROOT}/apps/backend/.venv/bin/python" - "$FALKOR_DATABASE" <<'PYFALKOR'
import os
import sys

import redis

client = redis.Redis(host="127.0.0.1", port=6379)
try:
    client.execute_command("GRAPH.DELETE", sys.argv[1])
except redis.ResponseError as error:
    if "does not exist" not in str(error).lower():
        raise
PYFALKOR
}

drop_database() {
  E2E_DATABASE_URL="$E2E_DATABASE_URL" "${ROOT}/apps/backend/.venv/bin/python" - <<'PYDROP'
import asyncio
import os
import re
from urllib.parse import unquote, urlparse

import asyncpg


async def main():
    database_url = os.environ["E2E_DATABASE_URL"]
    url = urlparse(database_url)
    database = unquote(url.path.lstrip("/"))
    if not re.fullmatch(r"tlon_e2e_[a-z0-9_]+", database):
        raise RuntimeError("refusing to drop a non-disposable E2E database")

    admin_url = url._replace(path="/postgres").geturl()
    connection = await asyncpg.connect(admin_url)
    try:
        await connection.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = $1 AND pid <> pg_backend_pid()",
            database,
        )
        identifier = '"' + database.replace('"', '""') + '"'
        await connection.execute(f"DROP DATABASE IF EXISTS {identifier}")
    finally:
        await connection.close()


asyncio.run(main())
PYDROP
}


pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

cleanup() {
  playwright-cli close-all >/dev/null 2>&1
  drop_falkor_graph >/dev/null 2>&1 || true
  [ "$STARTED_WEB" = 1 ] && pkill -f "expo start --web --port ${WEB_PORT}" >/dev/null 2>&1
  [ "$STARTED_API" = 1 ] && pkill -f "uvicorn tlon.main:app.*${API_PORT}" >/dev/null 2>&1
  if [ "$DATABASE_CREATED" = 1 ] && ! drop_database; then
    echo "failed to drop disposable E2E database" >&2
    exit 1
  fi
  rm -f "${LOGS}"/* 2>/dev/null
  rmdir "${LOGS}" 2>/dev/null || true
  return 0
}
trap cleanup EXIT

# The most recent snapshot playwright-cli wrote. Refs are regenerated on every
# navigation, so they have to be resolved from the current snapshot by label
# rather than hard-coded.
latest_snapshot() { ls -t "${ROOT}/.playwright-cli"/*.yml 2>/dev/null | head -1; }

ref_for() {
  local label="$1"
  grep -F "$label" "$(latest_snapshot)" 2>/dev/null | grep -oE 'ref=e[0-9]+' | head -1 | cut -d= -f2
}

ref_for_role() {
  local role="$1" label="$2"
  grep -F "${role} \"${label}\"" "$(latest_snapshot)" 2>/dev/null | grep -oE 'ref=e[0-9]+' | head -1 | cut -d= -f2
}

snapshot_contains() {
  grep -qF "$1" "$(latest_snapshot)" 2>/dev/null
}

# The ref of the thing you tap to reach some text.
#
# A card's label is often a `- text:` child of the pressable rather than the
# pressable itself, and a child line carries no ref of its own — so matching the
# label and grepping the same line for a ref finds nothing. Walking back to the
# nearest ref at or above the match lands on the node that actually handles the
# press. `ref_for` still exists for labels that sit on the pressable directly.
ref_for_tappable() {
  local label="$1" snapshot line
  snapshot="$(latest_snapshot)"
  line="$(grep -nF "$label" "$snapshot" 2>/dev/null | tail -1 | cut -d: -f1)"
  [ -n "$line" ] || return 1
  sed -n "1,${line}p" "$snapshot" | grep -oE 'ref=e[0-9]+' | tail -1 | cut -d= -f2
}

# Experiment screens intentionally name the safety boundary. Allow those negated
# disclosures, but reject affirmative tracking or medical language.
experiment_language_clean() {
  local page="$1" text
  text="$(cat "$(latest_snapshot)" 2>/dev/null)"
  if printf '%s\n' "$text" | grep -Ei '(^|[^a-z])(you (have|are)|diagnos(e|is|tic)|prescri(be|ption)|streak|reminder|score)([^a-z]|$)' \
    | grep -Eiv 'not diagnosis|not medical treatment|no score|no interpretation' | grep -q .; then
    fail "prohibited diagnosis, prescription, streak, score, or reminder language on ${page}"
  else
    pass "experiment framing has no prohibited interpretation or engagement language on ${page}"
  fi
}

# A section heading is its own node in the snapshot, rendered as `...: <label>` at
# the end of a line. Matching the bare word would also hit the footnote, which
# names both section titles in prose.
snapshot_has_section() {
  # Either shape. A section title is a heading now — the mobile client marks the
  # ones that genuinely title a section with a header role at level 2, which is
  # how a screen reader user navigates between them — and a heading puts its text
  # in the accessible name rather than after a colon.
  grep -qE ": $1\$|heading \"$1\"" "$(latest_snapshot)" 2>/dev/null
}

wait_for_snapshot() {
  local text="$1" attempts="${2:-30}"
  for _ in $(seq 1 "$attempts"); do
    playwright-cli snapshot >/dev/null 2>&1
    if snapshot_contains "$text"; then return 0; fi
    sleep 1
  done
  return 1
}

wait_for_experiment_state() {
  local state="$1" attempts="${2:-90}"
  for _ in $(seq 1 "$attempts"); do
    playwright-cli snapshot >/dev/null 2>&1
    if grep -qE "generic \\[ref=e[0-9]+\\]: ${state}$" "$(latest_snapshot)" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Mutation completion is a server contract, not a rendering delay. Poll the
# authenticated collection before asserting that a save took effect.
wait_for_api_text() {
  local url="$1" text="$2" attempts="${3:-30}" body
  for _ in $(seq 1 "$attempts"); do
    body="$(curl -s "$url" -H "Authorization: Bearer ${TOKEN:-}")"
    if printf '%s' "$body" | grep -qF "$text"; then return 0; fi
    sleep 1
  done
  return 1
}

wait_for_empty_observations() {
  local token="$1" attempts="${2:-30}" body
  for _ in $(seq 1 "$attempts"); do
    body="$(curl -sf "${API_URL}/v1/observations" -H "Authorization: Bearer ${token}")" || return 1
    if python3 -c 'import json,sys; raise SystemExit(0 if not json.load(sys.stdin).get("observations") else 1)' <<<"$body"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# The console buffer resets on navigation, so checking once at the end only ever
# inspected the final page — the login screen, the least interesting one in the
# run. Checked per page instead, right after that page has been exercised.
#
# The count is read from the log file playwright-cli writes, not from its stdout,
# which does not carry it. The previous version parsed stdout and defaulted to
# zero when it found nothing, so it reported "no console errors" on every page
# without ever looking — a green check that could not fail. An unreadable count
# is a failure here, so that a change in output format breaks the suite loudly
# rather than turning the check off.
# A second argument narrowly excuses errors matching that pattern. Used only where
# this run has deliberately broken something — stripping the voice credential
# makes a 503 the correct answer, and a suite that failed on it would be
# punishing the app for being honest. Anything not named here still fails.
console_clean() {
  local where="$1" allow="${2:-}" log errors
  playwright-cli console >/dev/null 2>&1
  log="$(ls -t "${ROOT}/.playwright-cli"/console-*.log 2>/dev/null | head -1)"
  if [ -z "$log" ] || [ ! -s "$log" ]; then
    fail "no console log was written for ${where}"
    return
  fi
  if [ -n "$allow" ]; then
    errors="$(grep -E '^\[ERROR\]' "$log" | grep -vcF "$allow")"
  else
    errors="$(grep -cE '^\[ERROR\]' "$log")"
  fi
  if [ "$errors" = "0" ]; then
    pass "no console errors on ${where}"
  else
    fail "${errors} console error(s) on ${where}"
    grep -E '^\[ERROR\]' "$log" | head -3 | cut -c1-160
  fi
}

wait_for() {
  local url="$1" name="$2" attempts="${3:-60}"
  for _ in $(seq 1 "$attempts"); do
    if curl -sf -o /dev/null "$url"; then return 0; fi
    sleep 2
  done
  echo "timed out waiting for ${name} at ${url}" >&2
  return 1
}

step "Starting services"
playwright-cli close-all >/dev/null 2>&1 || true
for port in "$API_PORT" "$WEB_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "a service is already listening on port ${port}; refusing shared E2E services" >&2
    exit 1
  fi
done

# The database is created only after all local-service and port checks pass, so a
# failed preflight never touches a shared database.
if ! "${ROOT}/apps/backend/.venv/bin/python" - <<'PYFALKORCHECK'
import redis
redis.Redis(host="127.0.0.1", port=6379).ping()
PYFALKORCHECK
then
  echo "could not reach the required loopback FalkorDB service" >&2
  exit 1
fi
if ! create_database; then
  echo "could not create disposable E2E database" >&2
  exit 1
fi
DATABASE_CREATED=1

# Cleared so the run uses the deterministic stubs even when real keys are in
# .env. An end-to-end test that quietly starts calling a paid API is slow,
# nondeterministic, and no longer testing this code — the same reasoning as the
# integration suite's conftest. The live model is covered by benchmarks/.
export OPENROUTER_API_KEY=""
export TRANSCRIPTION_API_KEY=""
export ELEVENLABS_API_KEY=""

if curl -sf -o /dev/null "${API_URL}/health"; then
  echo "backend became reachable after listener check; refusing reused E2E service" >&2
  exit 1
else
  (cd "${ROOT}/apps/backend" && DATABASE_URL="${E2E_DATABASE_URL}" AGENTS_ENABLED=false \
    FALKOR_HOST=127.0.0.1 FALKOR_PORT=6379 .venv/bin/python -m uvicorn tlon.main:app \
    --host 127.0.0.1 --port "${API_PORT}" >"${LOGS}/api.log" 2>&1 &)
  STARTED_API=1
  wait_for "${API_URL}/health" "backend" || { cat "${LOGS}/api.log"; exit 1; }
  pass "backend started"
fi

if curl -sf -o /dev/null "${WEB_URL}"; then
  echo "web became reachable after listener check; refusing reused E2E service" >&2
  exit 1
else
  (cd "${ROOT}/apps/mobile" && EXPO_PUBLIC_API_URL="${API_URL}" \
    npx expo start --web --port "${WEB_PORT}" >"${LOGS}/web.log" 2>&1 &)
  STARTED_WEB=1
  wait_for "${WEB_URL}" "web" 90 || { tail -20 "${LOGS}/web.log"; exit 1; }
  pass "web started"
fi

step "Signed-out users are sent to the login screen"
playwright-cli open "${WEB_URL}" >/dev/null 2>&1
wait_for_snapshot "Welcome back." 30 || true
if playwright-cli snapshot 2>&1 | grep -q "/login"; then
  pass "redirected to /login"
else
  # Fall back to checking the rendered content, since the URL line only appears
  # in the command output rather than the snapshot file.
  snapshot_contains "Welcome back." && pass "login screen rendered" \
    || fail "did not land on the login screen"
fi

step "Signed-out disclosure is public and returnable"
playwright-cli goto "${WEB_URL}/words" >/dev/null 2>&1
wait_for_snapshot "What happens to your words" 30 \
  && pass "signed-out users can read the disclosure" \
  || fail "signed-out disclosure did not render"
snapshot_contains "Start writing" \
  && pass "disclosure offers a return to writing" \
  || fail "disclosure has no writing action"
playwright-cli click "$(ref_for 'Start writing')" >/dev/null 2>&1
wait_for_snapshot "Welcome back." 30 \
  && pass "signed-out writing action returns to login" \
  || fail "signed-out writing action bypassed login"

step "Creating an account"
SWITCH="$(ref_for 'Create an account instead')"
[ -n "$SWITCH" ] && playwright-cli click "$SWITCH" >/dev/null 2>&1
wait_for_snapshot "At least 12 characters" 15 || true
snapshot_contains "At least 12 characters" \
  && pass "password guidance shown before signup" \
  || fail "password guidance missing"

playwright-cli fill "$(ref_for 'Email')" "$EMAIL" >/dev/null 2>&1
playwright-cli fill "$(ref_for 'Password')" "$PASSWORD" >/dev/null 2>&1
playwright-cli click "$(ref_for 'Create account')" >/dev/null 2>&1
wait_for_snapshot "Write what happened" 30 || true

playwright-cli snapshot >/dev/null 2>&1
# The composer's placeholder, which is now the design's wording and pinned to
# the bottom of the screen rather than sitting at the end of the stream.
snapshot_contains "Write what happened" \
  && pass "signup lands on the journal" \
  || fail "signup did not reach the journal"

TOKEN="$(playwright-cli localstorage-get tlon.token 2>&1 | grep -oE '[A-Za-z0-9_-]{40,}' | head -1)"
[ -n "$TOKEN" ] && pass "session persisted to storage" || fail "no token stored"

step "Writing an entry"
ENTRY="I told Sara I would finish the report and I have not started it."
# Resolved by the field's accessible name, not its placeholder: `ref_for`
# reads the ref off the line it matched, and a placeholder sits on its own
# line in the snapshot with no ref on it.
playwright-cli fill "$(ref_for "Journal entry")" "$ENTRY" >/dev/null 2>&1
# Re-snapshot before resolving Save. The composer shows one control at a time —
# with nothing typed that slot is the microphone, and the way to keep an entry
# only exists once there is something to keep. Resolving its ref from the
# pre-fill snapshot found nothing, so the click silently did nothing.
playwright-cli snapshot >/dev/null 2>&1
playwright-cli click "$(ref_for 'Save this entry')" >/dev/null 2>&1
wait_for_api_text "${API_URL}/v1/observations" "$ENTRY" 30 \
  && pass "entry was actually saved" \
  || fail "entry was not saved"
wait_for_snapshot "$ENTRY" 30 \
  && pass "entry round-tripped and rendered" \
  || fail "entry did not appear in the journal"

step "Findings can be turned off and back on"
playwright-cli goto "${WEB_URL}/settings" >/dev/null 2>&1
wait_for_snapshot "Patterns and regions" 30 || fail "findings setting missing"
playwright-cli click "$(ref_for 'Patterns and regions')" >/dev/null 2>&1
playwright-cli goto "${WEB_URL}/patterns" >/dev/null 2>&1
wait_for_snapshot "Patterns are turned off" 30 \
  && pass "findings-off hides the patterns screen" \
  || fail "findings-off did not hide patterns"
# The mobile journal is the public root route; preserve the raw record through
# the authoritative API check without inventing a /journal destination.
playwright-cli goto "${WEB_URL}/" >/dev/null 2>&1
wait_for_api_text "${API_URL}/v1/observations" "$ENTRY" 30 \
  && pass "findings-off preserves the raw journal" \
  || fail "findings-off hid the raw journal"
playwright-cli goto "${WEB_URL}/search" >/dev/null 2>&1
playwright-cli fill "$(ref_for 'A word you remember writing')" "Sara" >/dev/null 2>&1
wait_for_snapshot "$ENTRY" 30 \
  && pass "findings-off preserves raw Search results" \
  || fail "findings-off hid raw Search results"
playwright-cli goto "${WEB_URL}/settings" >/dev/null 2>&1
playwright-cli click "$(ref_for 'Patterns and regions')" >/dev/null 2>&1
playwright-cli goto "${WEB_URL}/patterns" >/dev/null 2>&1
wait_for_snapshot "What keeps returning" 30 \
  && pass "findings can be restored" \
  || fail "findings could not be restored"

step "The daily summary"
# Use the route after the account-wide save assertion; the link itself is
# covered by the shared toolbar checks, while a direct route avoids a stale
# generic ref turning this critical state transition into a silent no-op.
playwright-cli goto "${WEB_URL}/today" >/dev/null 2>&1
wait_for_snapshot "The acts" 30 \
  && pass "today reports one act" || fail "act count wrong"
snapshot_contains "$ENTRY" && pass "entry shown under what you wrote" || fail "entry missing"
# Invalid route input must not be handed to the API as a date or render a blank
# summary; Today falls back to the local day through its validated param parser.
playwright-cli goto "${WEB_URL}/today?date=not-a-date" >/dev/null 2>&1
wait_for_snapshot "$ENTRY" 30 \
  && pass "invalid Today date falls back to the local day" \
  || fail "invalid Today date produced an unsafe or blank route"

step "A low-confidence inference is presented as a guess"
# No UI for extraction yet, so it is triggered directly. What is being verified is
# the rendering: a 0.3-confidence guess must not sit under the confident
# heading, which the design calls "What they left behind".
OID="$(curl -s "${API_URL}/v1/observations" -H "Authorization: Bearer ${TOKEN}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["observations"][0]["id"])')"
curl -sf -X POST "${API_URL}/v1/observations/${OID}/extract" \
  -H "Authorization: Bearer ${TOKEN}" >/dev/null && pass "extraction ran" || fail "extraction failed"
TODAY="$(date -u +%F)"
SUMMARY_READY=0
for _ in $(seq 1 30); do
  if curl -s "${API_URL}/v1/summary/${TODAY}?tz=UTC" -H "Authorization: Bearer ${TOKEN}" \
    | python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin).get("inferred") else 1)'; then
    SUMMARY_READY=1
    break
  fi
  sleep 1
done
[ "$SUMMARY_READY" = 1 ] \
  && pass "summary reports extraction completion" \
  || fail "summary never reported inferred content"
playwright-cli goto "${WEB_URL}/today?date=${TODAY}" >/dev/null 2>&1
wait_for_snapshot "Today" 30 \
  && wait_for_snapshot "Less sure" 60 \
  && pass "tentative inference is in its own section" \
  || fail "tentative section missing"
grep -qF 'heading "What they left behind"' "$(latest_snapshot)" 2>/dev/null \
  && fail "a 0.3-confidence guess was presented as something the record stands behind" \
  || pass "guess kept out of the confident section"
snapshot_contains "not a conclusion about you" \
  && pass "inferences are framed as hypotheses" \
  || fail "hypothesis framing missing"

step "The weekly report is navigable, deterministic, and explainable"
# Use the link a person sees on the journal rather than making the route itself
# the thing under test. The stub extractor above makes the tentative card stable.
playwright-cli goto "${WEB_URL}/" >/dev/null 2>&1
# The bar holds four places and a way to everything else; the week is on the
# map behind More, under "Looking back".
wait_for_snapshot "More" 30 \
  && pass "journal exposes the way to everything else" \
  || fail "no route out of the journal"
playwright-cli click "$(ref_for 'More places to go')" >/dev/null 2>&1
wait_for_snapshot "This week" 30 || true
playwright-cli click "$(ref_for 'This week')" >/dev/null 2>&1
wait_for_snapshot "$ENTRY" 30 \
  && pass "current week renders the entry" \
  || fail "current week did not render the entry"
snapshot_has_section "$(section forming)" \
  && pass "current week renders the tentative inference" \
  || fail "tentative inference missing from current week"

# The footnote promises this. It is the concrete form of "every inference must be
# explainable", so it is the single most important thing in the app to verify.
GUESS_REF="$(ref_for_tappable 'I told Sara')"
[ -n "$GUESS_REF" ] \
  && playwright-cli click "$GUESS_REF" >/dev/null 2>&1 \
  || fail "tentative inference card was not clickable"
wait_for_snapshot "How this was produced" 30 \
  && pass "inference opens the explanation UI" \
  || fail "explanation UI did not open"
snapshot_contains "hypothesis drawn from your own words" \
  && pass "framed as a hypothesis, not a conclusion" \
  || fail "hypothesis framing missing on the explain screen"
snapshot_contains "$ENTRY" \
  && pass "shows the user's own words as the source" \
  || fail "source entry not shown"
snapshot_contains "extract-v0.1" \
  && pass "records which extractor produced it" \
  || fail "extractor not shown"

# The explanation screen has no separate back control; returning to the route is
# equivalent to the user's Week navigation and keeps the next assertion scoped.
playwright-cli goto "${WEB_URL}/week" >/dev/null 2>&1
wait_for_snapshot "This week" 30 \
  && pass "returned to the Week report" \
  || fail "could not return to the Week report"
# The pagers show which week or day they go to; their accessible names say
# what they do, which is the handle that survives the label changing.
playwright-cli click "$(ref_for 'Previous week')" >/dev/null 2>&1
wait_for_snapshot "Nothing recorded" 30 \
  && pass "previous empty week says nothing was recorded" \
  || fail "previous empty week not reported"
for nudge in "streak" "Keep going" "Why not"; do
  snapshot_contains "$nudge" && fail "found an engagement nudge: ${nudge}"
done
pass "empty week has no engagement nudges"

console_clean "the journal"

step "The dashboard"
playwright-cli goto "${WEB_URL}/graph" >/dev/null 2>&1
wait_for_snapshot "entries" 30 \
  && pass "dashboard renders counts" || fail "dashboard counts missing"
snapshot_contains "What has been noticed" \
  && pass "dashboard lists what was drawn from entries" \
  || fail "dashboard list missing"
snapshot_contains 'button "Hide tentative guesses"' \
  && pass "tentative guesses can be filtered out" \
  || fail "tentative filter missing"

# Hiding tentative guesses should empty the list, since the stub emits 0.3.
playwright-cli click "$(ref_for 'Hide tentative guesses')" >/dev/null 2>&1
wait_for_snapshot "Nothing confident enough to show" 30 \
  && snapshot_contains "Nothing confident enough to show" \
  && pass "filtering removes the low-confidence guesses" \
  || fail "filter had no effect"

console_clean "the dashboard"

step "The graph explorer"
# Expo-Web now exposes the graph as an accessible SVG panel rather than a
# Skia canvas. Assert the named surface and its relationship disclaimer.
playwright-cli goto "${WEB_URL}/explore" >/dev/null 2>&1
wait_for_snapshot "The graph, as points and threads" 30 \
  && pass "the graph surface is accessible" \
  || fail "graph surface never appeared"
snapshot_contains "Position carries no meaning" \
  && pass "graph semantics disclaim positional meaning" \
  || fail "graph semantics missing"
console_clean "the graph explorer"

step "An empty day says so, without nudging"
playwright-cli goto "${WEB_URL}/today" >/dev/null 2>&1
wait_for_snapshot "Previous day" 30
playwright-cli click "$(ref_for 'Previous day')" >/dev/null 2>&1
wait_for_snapshot "Nothing recorded" 30 \
  && pass "empty day stated plainly" \
  || fail "empty day not reported"
for nudge in "streak" "Keep going" "Why not"; do
  snapshot_contains "$nudge" && fail "found an engagement nudge: ${nudge}"
done
pass "no engagement nudges"

step "The weekly report is deterministic and explainable"
WEEK_START="$(python3 - <<'PY'
from datetime import UTC, datetime, timedelta
today = datetime.now(UTC).date()
print(today - timedelta(days=today.weekday()))
PY
)"
WEEK_BODY="$(curl -sf "${API_URL}/v1/summary/week/${WEEK_START}?tz=UTC" -H "Authorization: Bearer ${TOKEN}")"
echo "$WEEK_BODY" | python3 -c 'import json,sys; b=json.load(sys.stdin); assert len(b["days"]) == 7 and b["week_start"] == "'"${WEEK_START}"'"' \
  && pass "weekly report has seven deterministic day buckets" || fail "weekly report contract failed"
echo "$WEEK_BODY" | grep -q '"mood_score"\|"trend"\|"streak"' \
  && fail "weekly report contains prohibited tracking language" || pass "weekly report has no tracking language"

step "Talking to the agent"
playwright-cli goto "${WEB_URL}/talk" >/dev/null 2>&1
wait_for_snapshot "What stays from this conversation" 30 \
  && pass "Talk privacy disclosure is visible" \
  || fail "Talk privacy disclosure missing"
snapshot_contains "The conversation transcript, including your turns and the agent's turns" \
  && pass "says which turns become entries" \
  || fail "did not state which turns are kept"
snapshot_contains "Audio is transcribed and then discarded" \
  && pass "says audio is discarded after transcription" \
  || fail "did not state audio handling"

# The mobile Talk surface is voice-first: options expose push-to-talk and the
# transcript drawer, while typed Talk is covered by the desktop client's suite.
wait_for_snapshot "Show options" 30 \
  && pass "Talk options are reachable" \
  || fail "Talk options never appeared"
OPTIONS="$(ref_for 'Show options')"
if [ -n "$OPTIONS" ]; then
  playwright-cli click "$OPTIONS" >/dev/null 2>&1
  wait_for_snapshot "Prefer to hold instead?" 30 \
    && pass "push-to-talk fallback is exposed" \
    || fail "push-to-talk fallback never appeared"
  snapshot_contains "View transcript" \
    && pass "transcript control is exposed" \
    || fail "transcript control is missing"
else
  fail "Talk options control was not addressable"
fi

# Exercise a real, deterministic typed turn through the authenticated API. The
# Expo-Web surface is voice-first, so this keeps the UI responsible for closing
# and displaying the receipt while avoiding microphone/device nondeterminism.
TALK_ID="$(curl -sf "${API_URL}/v1/conversations" -H "Authorization: Bearer ${TOKEN}" \
  | python3 -c 'import json,sys; print(next(c["id"] for c in json.load(sys.stdin)["conversations"] if c["closed_at"] is None))')" \
  && pass "an open Talk conversation is available" \
  || fail "could not find the open Talk conversation"
TALK_TEXT="A deterministic typed Talk turn for the end-to-end check."
TALK_TURN_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
TALK_REPLY="$(curl -sf -X POST "${API_URL}/v1/conversations/${TALK_ID}/turns" \
  -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
  -d '{"content":"'"${TALK_TEXT}"'","source":"text","timezone":"UTC","client_turn_id":"'"${TALK_TURN_ID}"'"}')" \
  && echo "$TALK_REPLY" | grep -q '"reply"' \
  && pass "typed Talk turn was accepted" \
  || fail "typed Talk turn was not accepted"
# The Talk query does not refetch after an external API turn. Reload the mounted
# screen so saidSomething observes the seeded turn before the close control is read.
playwright-cli reload >/dev/null 2>&1 \
  && pass "Talk screen was reloaded after the API turn" \
  || fail "Talk screen did not reload after the API turn"
wait_for_snapshot "$TALK_TEXT" 30 \
  && pass "Talk turn is observable in the surface" \
  || fail "Talk turn never appeared in the surface"
# Reloading closes the options drawer, so reopen it from the freshly rendered
# screen before resolving the close control.
wait_for_snapshot "Show options" 30 \
  && OPTIONS="$(ref_for 'Show options')" \
  && [ -n "$OPTIONS" ] \
  && playwright-cli click "$OPTIONS" >/dev/null 2>&1 \
  && wait_for_snapshot "Close conversation · keeps your turns" 30 \
  || fail "Talk options did not reopen after the API turn"
CLOSE_REF="$(ref_for 'Close conversation · keeps your turns')"
[ -n "$CLOSE_REF" ] \
  && playwright-cli click "$CLOSE_REF" >/dev/null 2>&1 \
  && pass "Talk conversation close was requested" \
  || fail "Talk close control was not addressable"
wait_for_snapshot "Conversation closed" 30 \
  && snapshot_contains "1 turn converted to Journal entries." \
  && pass "authoritative Talk conversion receipt is visible" \
  || fail "authoritative Talk conversion receipt missing"
# The only excused error in the run: speech is deliberately unconfigured here, so
# the one probe the client makes before learning that is expected. It asks once
# and then stops — see src/lib/useSpokenReply.ts. Check Talk before navigating so
# a clean Journal console cannot mask an error on the conversation screen.
console_clean "the talk screen" "/v1/voice/speak"
RETURN_REF="$(ref_for 'Return to Journal')"
[ -n "$RETURN_REF" ] \
  && playwright-cli click "$RETURN_REF" >/dev/null 2>&1 \
  && wait_for_snapshot "Journal" 30 \
  && pass "Talk returns explicitly to Journal" \
  || fail "Talk did not return to Journal"
console_clean "the Journal after Talk"

step "Speech is absent rather than faked"
# No key in this run. A stub that returned a beep would make a missing
# credential look like a working feature.
SPEAK="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${API_URL}/v1/voice/speak" \
  -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
  -d '{"text":"hello"}')"
[ "$SPEAK" = "503" ] \
  && pass "unconfigured speech reports 503" \
  || fail "expected 503 from speech, got ${SPEAK}"
curl -s -X POST "${API_URL}/v1/voice/speak" -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' -d '{"text":"hello"}' | grep -q '"audio"' \
  && fail "returned placeholder audio" \
  || pass "no placeholder clip returned"

step "Background agents"
curl -s "${API_URL}/v1/agents" -H "Authorization: Bearer ${TOKEN}" \
  | grep -q '"consolidation"' \
  && pass "the registry is nameable" \
  || fail "registry did not list its agents"

RUNS="$(curl -s -X POST "${API_URL}/v1/agents/run" -H "Authorization: Bearer ${TOKEN}")"
python3 -c 'import json,sys; data=json.load(sys.stdin); statuses=[item.get("status") for item in data]; raise SystemExit(0 if data and "succeeded" in statuses and all(status in {"succeeded", "skipped"} for status in statuses) else 1)' <<<"$RUNS" \
  && pass "agents ran on request" \
  || fail "manual agent run did not complete successfully"
# A button that declines to look is baffling; a forced run must report what it
# found, not that it did not check.
echo "$RUNS" | grep -q 'nothing new to work on' \
  && fail "a manual run declined to look" \
  || pass "a manual run always looks"

LOG="$(curl -s "${API_URL}/v1/agents/runs" -H "Authorization: Bearer ${TOKEN}")"
echo "$LOG" | grep -q '"trigger":"manual"' \
  && pass "runs record whether you asked for them" \
  || fail "trigger not recorded"
echo "$LOG" | grep -q '"version"' \
  && pass "runs record the version that drew the conclusion" \
  || fail "version not recorded"
# The run log must not become a second copy of someone's private writing. The
# same grep matches when the content IS present, so this is a live assertion.
echo "$LOG" | grep -qF "$ENTRY" \
  && fail "the run log copied the user's words" \
  || pass "the log holds counts, not content"

step "Patterns are counted, not asserted"
curl -s -X POST "${API_URL}/v1/patterns/mine" -H "Authorization: Bearer ${TOKEN}" \
  | grep -q '"considered"' \
  && pass "mining reports what it examined" \
  || fail "mining did not report its scope"
# Too little material is not a pattern. Three mentions in one sitting is one
# thought, and inventing recurrence from that would cheapen the word.
curl -s "${API_URL}/v1/patterns" -H "Authorization: Bearer ${TOKEN}" \
  | grep -q '^\[\]$' \
  && pass "too little material produces no pattern" \
  || fail "invented a pattern from too little"

step "The identity graph offers rather than asserts"
curl -s -o /dev/null -w '%{http_code}' "${API_URL}/v1/identity" \
  -H "Authorization: Bearer ${TOKEN}" | grep -q '200' \
  && pass "identity is readable" \
  || fail "identity endpoint did not answer"
curl -s "${API_URL}/v1/identity/candidates" -H "Authorization: Bearer ${TOKEN}" \
  | grep -qE '^\[|\{' \
  && pass "candidates are offered for the person to confirm" \
  || fail "candidates endpoint did not answer"

step "A stub-mined Pattern opens the Experiment engine"
# The stub extractor is deterministic, but pattern mining still requires three
# extracted observations across two local dates. Seed those through the real API
# so this browser journey starts from the same visible Pattern a person would
# reach after writing.
PATTERN_ENTRY="I take a short walk after lunch."
YESTERDAY="$(python3 - <<'PY'
from datetime import UTC, datetime, timedelta
print((datetime.now(UTC).date() - timedelta(days=1)).isoformat())
PY
)"
PATTERN_IDS=()
for suffix in 1 2 3; do
  OID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
  if [ "$suffix" = 1 ]; then CAPTURED="${YESTERDAY}T12:00:00+00:00"; else CAPTURED="$(date -u +%Y-%m-%d)T12:00:0${suffix}+00:00"; fi
  CREATED="$(curl -s -X POST "${API_URL}/v1/observations" -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' -d "{\"id\":\"${OID}\",\"content\":\"${PATTERN_ENTRY}\",\"source\":\"text\",\"captured_at\":\"${CAPTURED}\"}")"
  echo "$CREATED" | grep -q '"id"' && PATTERN_IDS+=("$OID") || fail "could not seed pattern observation ${suffix}"
  curl -sf -X POST "${API_URL}/v1/observations/${OID}/extract" -H "Authorization: Bearer ${TOKEN}" >/dev/null \
    || fail "could not extract pattern observation ${suffix}"
done
# The stub extractor emits Thought nodes, which mining excludes. Seed eligible
# provenance-backed inferred nodes in the disposable database, then use the real
# mining API.
DB_URL="$E2E_DATABASE_URL"
DATABASE_URL="$DB_URL" uv run --project "${ROOT}/apps/backend" python - "$EMAIL" "${PATTERN_IDS[@]-}" <<'PYSEED'
import asyncio
import os
import sys
from uuid import uuid4
import asyncpg

async def main():
    email, *observation_ids = sys.argv[1:]
    pool = await asyncpg.create_pool(dsn=os.environ["DATABASE_URL"])
    async with pool.acquire() as conn:
        user_id = await conn.fetchval("SELECT id FROM users WHERE email = $1", email)
        if user_id is None or len(observation_ids) != 3:
            raise RuntimeError("could not resolve seeded account or observations")
        for observation_id in observation_ids:
            node_id = uuid4()
            await conn.execute("""
                INSERT INTO graph_nodes
                    (id, user_id, kind, label, confidence, epistemic_status, extractor)
                VALUES ($1, $2, 'Activity', $3, 0.9, 'hypothesis', 'e2e-seed')
            """, node_id, user_id, "short walk after lunch")
            await conn.execute(
                "INSERT INTO node_provenance (node_id, observation_id) VALUES ($1, $2)",
                node_id, observation_id,
            )
    await pool.close()

asyncio.run(main())
PYSEED
if [ "$?" -ne 0 ]; then
  fail "could not seed eligible inferred pattern nodes"
  exit 1
fi
curl -sf -X POST "${API_URL}/v1/patterns/mine" -H "Authorization: Bearer ${TOKEN}" >/dev/null \
  && pass "stub mined the seeded pattern" || fail "pattern mining failed"
PATTERN_JSON="$(curl -sf "${API_URL}/v1/patterns" -H "Authorization: Bearer ${TOKEN}")"
PATTERN_ID="$(echo "$PATTERN_JSON" | python3 -c 'import json,sys; p=json.load(sys.stdin); print(p[0]["id"] if p else "")')"
PATTERN_LABEL="$(echo "$PATTERN_JSON" | python3 -c 'import json,sys; p=json.load(sys.stdin); print(p[0]["label"] if p else "")')"
if [ -z "$PATTERN_ID" ] || [ -z "$PATTERN_LABEL" ]; then
  fail "stub did not produce a usable pattern"
  exit 1
fi
pass "pattern is visible through the API"

playwright-cli goto "${WEB_URL}/patterns" >/dev/null 2>&1
wait_for_snapshot "Open experiments" 30 \
  && pass "Patterns screen exposes Open experiments" \
  || fail "Patterns screen has no Experiments entry"
experiment_language_clean "Patterns"
playwright-cli click "$(ref_for 'Open experiments')" >/dev/null 2>&1
wait_for_snapshot "Try a question" 30 \
  && pass "Experiments screen opened from the Pattern" \
  || fail "Experiments screen did not open"

TITLE="Lunch walk, observed"
HYPOTHESIS="I wonder whether a short walk after lunch helps me notice my afternoon energy."
ACTION="I will take a short walk after lunch."
CRITERION="I will record whether my afternoon energy felt easier to notice."
CHECKIN="After lunch I took the walk and noticed my afternoon energy more clearly."
playwright-cli fill "$(ref_for 'Title')" "$TITLE" >/dev/null 2>&1
playwright-cli fill "$(ref_for 'Hypothesis')" "$HYPOTHESIS" >/dev/null 2>&1
playwright-cli fill "$(ref_for 'Action')" "$ACTION" >/dev/null 2>&1
playwright-cli fill "$(ref_for 'Success criterion')" "$CRITERION" >/dev/null 2>&1
playwright-cli click "$(ref_for 'Save draft')" >/dev/null 2>&1
wait_for_snapshot "$TITLE" 30 \
  && pass "valid draft was created" || fail "draft was not created"
EXPERIMENT_ID="$(curl -sf "${API_URL}/v1/experiments" -H "Authorization: Bearer ${TOKEN}" | python3 -c 'import json,sys; x=json.load(sys.stdin)["experiments"]; print(next((e["id"] for e in x if e["title"] == "'"${TITLE}"'"), ""))')"
[ -n "$EXPERIMENT_ID" ] && pass "draft has a stable experiment id" || fail "could not identify created draft"
for authored in "$HYPOTHESIS" "$ACTION" "$CRITERION"; do
  snapshot_contains "$authored" && pass "draft preserves exact authored text" || fail "draft changed authored text"
done
snapshot_contains "Optional self-observation, not diagnosis or medical treatment." \
  && pass "draft keeps the self-observation framing" || fail "self-observation framing missing"
experiment_language_clean "draft"

# The deterministic stub's confidence is intentionally tentative, so the UI
# correctly omits it from the eligible picker. Exercise the same authenticated
# link contract through the API in that bounded case, then verify the user-facing
# evidence link and explanation in the browser.
if [ -n "$PATTERN_ID" ] && [ -n "$PATTERN_LABEL" ] && snapshot_contains "Link pattern ${PATTERN_LABEL}"; then
  playwright-cli click "$(ref_for "Link pattern ${PATTERN_LABEL}")" >/dev/null 2>&1
else
  DRAFT_REVISION="$(curl -sf "${API_URL}/v1/experiments/${EXPERIMENT_ID}" -H "Authorization: Bearer ${TOKEN}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["revision"])')"
  curl -sf -X POST "${API_URL}/v1/experiments/${EXPERIMENT_ID}/links" \
    -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
    -d "{\"revision\":${DRAFT_REVISION},\"node_id\":\"${PATTERN_ID}\"}" >/dev/null \
    && pass "stub Pattern linked through the bounded API contract" \
    || fail "could not link the stub Pattern"
  playwright-cli reload >/dev/null 2>&1
fi
wait_for_snapshot "Linked evidence" 30 \
  && pass "the mined Pattern was linked to the draft" || fail "Pattern was not linked"
LINK_REF="$(ref_for "Explain linked evidence ${PATTERN_LABEL}")"
[ -n "$LINK_REF" ] && playwright-cli click "$LINK_REF" >/dev/null 2>&1 \
  || fail "linked evidence explanation was not available"
wait_for_snapshot "How this was produced" 30 \
  && pass "linked evidence opens its explanation" || fail "linked evidence explanation did not open"
snapshot_contains "$PATTERN_LABEL" && pass "explanation names the linked Pattern" || fail "explanation omitted linked Pattern"
snapshot_contains "$PATTERN_ENTRY" && pass "explanation shows Pattern source words" || fail "Pattern source words missing"
console_clean "linked Pattern explanation"

# Return through the stable route after the explanation view; refs are always
# resolved from the fresh snapshot rather than carried across navigation.
playwright-cli goto "${WEB_URL}/experiment/${EXPERIMENT_ID}" >/dev/null 2>&1
# The hypothesis also exists on the creation form, so it is not a navigation
# boundary. The detail-only delete action proves the route has rendered.
wait_for_snapshot "Delete experiment" 30 || fail "experiment detail did not render"
EXPERIMENT_URL="${WEB_URL}/experiment/${EXPERIMENT_ID}"
playwright-cli click "$(ref_for_role button 'Start')" >/dev/null 2>&1
wait_for_experiment_state "active" 90 \
  && pass "experiment started" || fail "experiment did not start"
playwright-cli click "$(ref_for_role button 'Pause')" >/dev/null 2>&1
wait_for_experiment_state "paused" 90 \
  && pass "experiment paused" || fail "experiment did not pause"
playwright-cli click "$(ref_for_role button 'Resume')" >/dev/null 2>&1
wait_for_experiment_state "active" 90 \
  && pass "experiment resumed" || fail "experiment did not resume"

playwright-cli fill "$(ref_for_role textbox 'Check-in observation')" "$CHECKIN" >/dev/null 2>&1
playwright-cli snapshot >/dev/null 2>&1
playwright-cli click "$(ref_for_role button 'Save check-in')" >/dev/null 2>&1
wait_for_snapshot "Select as final check-in" 30 \
  && pass "check-in was saved and attached" || fail "check-in was not attached"
playwright-cli goto "${WEB_URL}/today" >/dev/null 2>&1
wait_for_snapshot "$CHECKIN" 30 \
  && pass "experiment check-in is also an ordinary Journal observation" \
  || fail "check-in did not appear in the Journal"
console_clean "Journal check-in"
playwright-cli goto "$EXPERIMENT_URL" >/dev/null 2>&1
wait_for_snapshot "Select as final check-in" 30 || fail "attached check-in missing after returning"
CHECKIN_REF="$(ref_for_role radio "${CHECKIN} Select as final check-in")"
[ -n "$CHECKIN_REF" ] && playwright-cli click "$CHECKIN_REF" >/dev/null 2>&1 || fail "could not select final check-in"
wait_for_snapshot "Selected final check-in" 10 || fail "final check-in selection did not persist"
playwright-cli click "$(ref_for_role radio 'Met')" >/dev/null 2>&1
playwright-cli snapshot >/dev/null 2>&1
COMPLETE_REF="$(ref_for_role button 'Complete experiment')"
[ -n "$COMPLETE_REF" ] && playwright-cli click "$COMPLETE_REF" >/dev/null 2>&1 || fail "completion action was not enabled"
wait_for_snapshot "Outcome" 30 \
  && pass "experiment completed with an explicit final check-in" || fail "experiment did not complete"
snapshot_contains "Met" && pass "qualitative assessment is displayed" || fail "assessment missing from outcome"
snapshot_contains "Final check-in selected by you. No score or interpretation." \
  && pass "outcome has no score or generated interpretation" \
  || fail "outcome framing changed"
experiment_language_clean "completed experiment"
console_clean "completed experiment"

step "Nothing crosses between accounts"
OTHER_EMAIL="e2e-other-$(date +%s)@example.com"
OTHER="$(curl -s -X POST "${API_URL}/v1/auth/signup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${OTHER_EMAIL}\",\"password\":\"${PASSWORD}\",\"device\":\"e2e\"}" \
  | grep -oE '"token":"[^"]+"' | cut -d'"' -f4)"
if [ -n "$OTHER" ]; then
  curl -s "${API_URL}/v1/agents/runs" -H "Authorization: Bearer ${OTHER}" \
    | grep -q '^\[\]$' \
    && pass "a new account sees none of another's agent runs" \
    || fail "agent runs leaked between accounts"
  curl -s "${API_URL}/v1/observations" -H "Authorization: Bearer ${OTHER}" \
    | grep -qF "$ENTRY" \
    && fail "entries leaked between accounts" \
    || pass "a new account sees none of another's entries"
  curl -s "${API_URL}/v1/experiments" -H "Authorization: Bearer ${OTHER}" \
    | grep -q "$TITLE" \
    && fail "experiments leaked between accounts" \
    || pass "a new account sees none of another's experiments"
  OTHER_PATTERNS="$(curl -sf "${API_URL}/v1/patterns" -H "Authorization: Bearer ${OTHER}")"
  if python3 -c 'import json,sys; p=json.load(sys.stdin); raise SystemExit(0 if isinstance(p,list) and not p else 1)' <<<"$OTHER_PATTERNS"; then
    pass "a new account sees no patterns from another account"
  else
    fail "patterns leaked between accounts"
  fi
else
  fail "could not create a second account"
fi

# Exercise the same account boundary through the real browser session, rather
# than relying only on a second bearer token. Sign out of account A, sign into B,
# and verify the current fixtures are absent from both its API and rendered UI.
playwright-cli goto "${WEB_URL}/settings" >/dev/null 2>&1
wait_for_snapshot "Sign out" 30 || fail "could not open account switching settings"
playwright-cli click "$(ref_for 'Sign out')" >/dev/null 2>&1
wait_for_snapshot "Welcome back." 30 || fail "browser did not sign out before account switch"
playwright-cli fill "$(ref_for 'Email address')" "$OTHER_EMAIL" >/dev/null 2>&1
playwright-cli fill "$(ref_for 'Password')" "$PASSWORD" >/dev/null 2>&1
playwright-cli click "$(ref_for 'Sign in')" >/dev/null 2>&1
wait_for_snapshot "Write what happened" 30 || fail "browser did not sign into the second account"
if wait_for_empty_observations "$OTHER" 30; then
  pass "second account API is settled with an empty journal"
else
  fail "second account journal did not settle empty"
fi
playwright-cli goto "${WEB_URL}/" >/dev/null 2>&1
if wait_for_snapshot "Nothing written yet" 30; then
  pass "second account UI is settled with an empty journal"
else
  fail "second account UI did not settle empty"
fi
snapshot_contains "$ENTRY" && fail "browser account switch leaked the first account's entry" \
  || pass "browser account switch hides the first account's entry"
snapshot_contains "$TITLE" && fail "browser account switch leaked the first account's experiment" \
  || pass "browser account switch hides the first account's experiment"

# Restore account A before continuing its deletion and rejection journeys.
playwright-cli goto "${WEB_URL}/settings" >/dev/null 2>&1
wait_for_snapshot "Sign out" 30 || fail "could not reopen second account settings"
playwright-cli click "$(ref_for 'Sign out')" >/dev/null 2>&1
wait_for_snapshot "Welcome back." 30 || fail "could not sign out of second account"
playwright-cli fill "$(ref_for 'Email address')" "$EMAIL" >/dev/null 2>&1
playwright-cli fill "$(ref_for 'Password')" "$PASSWORD" >/dev/null 2>&1
playwright-cli click "$(ref_for 'Sign in')" >/dev/null 2>&1
wait_for_snapshot "Write what happened" 30 || fail "could not restore first account"
TOKEN="$(playwright-cli localstorage-get tlon.token 2>&1 | grep -oE '[A-Za-z0-9_-]{40,}' | head -1)"

step "Returning to the first account and deleting the experiment"
playwright-cli goto "${EXPERIMENT_URL}" >/dev/null 2>&1
wait_for_snapshot "Outcome" 30 || fail "first account could not reopen completed experiment"
playwright-cli click "$(ref_for 'Delete experiment')" >/dev/null 2>&1
wait_for_snapshot "Delete experiment?" 30 || fail "delete confirmation did not open"
DELETE_REF="$(ref_for 'Confirm delete experiment')"
[ -n "$DELETE_REF" ] && playwright-cli click "$DELETE_REF" >/dev/null 2>&1 || fail "delete confirmation had no Delete action"
wait_for_snapshot "No experiments yet." 30 \
  && pass "deleted experiment is absent from the list" \
  || fail "deleted experiment still appears"
snapshot_contains "$TITLE" && fail "deleted experiment title remains visible" || pass "deleted experiment title is absent"
console_clean "experiment deletion and list"

step "Disagreeing with a reading"
# The app has called its inferences hypotheses from the start. This is the
# journey that makes the word mean something: a person opening a reading, saying
# it is wrong, and the system dropping it from everything derived from it.
NODE_ID="$(curl -s "${API_URL}/v1/graph?limit=50" -H "Authorization: Bearer ${TOKEN}" \
  | "${ROOT}/apps/backend/.venv/bin/python" -c \
    'import sys,json; d=json.load(sys.stdin); print(next((n["id"] for n in d["nodes"] if n["kind"]!="Observation"), ""))')"

if [ -z "$NODE_ID" ]; then
  fail "no inference to judge"
else
  playwright-cli goto "${WEB_URL}/node/${NODE_ID}" >/dev/null 2>&1
  wait_for_snapshot "Does this match how it was?" 30 \
    && pass "a reading can be argued with" \
    || fail "no way to agree or disagree with a reading"

  REJECT="$(ref_for 'Not really')"
  if [ -z "$REJECT" ]; then
    fail "no way to disagree"
  else
    playwright-cli click "$REJECT" >/dev/null 2>&1
    # The consequence is stated where the action is, not buried in settings —
    # that is what makes disagreeing worth the tap.
    wait_for_snapshot "no longer counted toward patterns" 20 \
      && pass "the consequence of disagreeing is stated" \
      || fail "consequence of rejection not shown"

    curl -s "${API_URL}/v1/self-model" -H "Authorization: Bearer ${TOKEN}" \
      | grep -q '"rejected":1' \
      && pass "the rejection is recorded" \
      || fail "rejection not recorded"

    # Rejecting must not delete. The record that the system once believed this is
    # the only way anyone can later ask why.
    curl -s "${API_URL}/v1/graph/nodes/${NODE_ID}/explain" -H "Authorization: Bearer ${TOKEN}" \
      | grep -q '"derived_from"' \
      && pass "a rejected reading keeps its provenance" \
      || fail "rejected reading lost its evidence"

    # Tapping the active choice again withdraws it: someone who disagreed in a
    # bad week must not be held to that either.
    playwright-cli click "$(ref_for 'Not really')" >/dev/null 2>&1
    sleep 2
    curl -s "${API_URL}/v1/self-model" -H "Authorization: Bearer ${TOKEN}" \
      | grep -q '"rejected":0' \
      && pass "a judgement can be withdrawn" \
      || fail "judgement could not be withdrawn"
  fi
  console_clean "the explanation screen"
fi

step "An ordered finding shows the entries it counted"
# The only claim in the app that puts two things in an order, and the one most
# easily misread as cause. Reaching one needs a month of dense writing, so the
# journal is seeded through the real API and its two readings are inserted the
# same way as the exact-label pattern above.
LAG_DAYS=()
while IFS= read -r day; do LAG_DAYS+=("$day"); done < <(python3 - <<'PY'
from datetime import UTC, datetime, timedelta
today = datetime.now(UTC).date()
for offset in range(32):
    print((today - timedelta(days=31 - offset)).isoformat())
PY
)
LAG_SOURCE_IDS=()
LAG_TARGET_IDS=()
for offset in $(seq 0 31); do
  OID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
  curl -sf -o /dev/null -X POST "${API_URL}/v1/observations" \
    -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
    -d "{\"id\":\"${OID}\",\"content\":\"a quiet day, ${LAG_DAYS[$offset]}\",\"source\":\"text\",\"captured_at\":\"${LAG_DAYS[$offset]}T12:00:00+00:00\",\"timezone\":\"UTC\"}" \
    || fail "could not seed lag journal entry ${offset}"
  case " 0 8 17 27 " in *" ${offset} "*) LAG_SOURCE_IDS+=("$OID") ;; esac
  case " 1 9 18 28 " in *" ${offset} "*) LAG_TARGET_IDS+=("$OID") ;; esac
done

DATABASE_URL="$DB_URL" uv run --project "${ROOT}/apps/backend" python - "$EMAIL" "${LAG_SOURCE_IDS[@]-}" -- "${LAG_TARGET_IDS[@]-}" <<'PYSEED'
import asyncio
import os
import sys
from uuid import uuid4
import asyncpg

async def main():
    email, *rest = sys.argv[1:]
    split = rest.index("--")
    sources, targets = rest[:split], rest[split + 1:]
    if len(sources) != 4 or len(targets) != 4:
        raise RuntimeError("lag journal did not seed four ordered pairs")

    pool = await asyncpg.create_pool(dsn=os.environ["DATABASE_URL"])
    async with pool.acquire() as conn:
        user_id = await conn.fetchval("SELECT id FROM users WHERE email = $1", email)
        if user_id is None:
            raise RuntimeError("could not resolve seeded account")
        for observation_ids, kind, label in (
            (sources, "Activity", "sleeping badly"),
            (targets, "Emotion", "foggy"),
        ):
            for observation_id in observation_ids:
                node_id = uuid4()
                await conn.execute("""
                    INSERT INTO graph_nodes
                        (id, user_id, kind, label, confidence, epistemic_status, extractor)
                    VALUES ($1, $2, $3, $4, 0.9, 'hypothesis', 'e2e-seed')
                """, node_id, user_id, kind, label)
                await conn.execute(
                    "INSERT INTO node_provenance (node_id, observation_id) VALUES ($1, $2)",
                    node_id, observation_id,
                )
    await pool.close()

asyncio.run(main())
PYSEED
if [ "$?" -ne 0 ]; then
  fail "could not seed the ordered journal"
else
  curl -sf -X POST "${API_URL}/v1/patterns/mine" -H "Authorization: Bearer ${TOKEN}" >/dev/null \
    || fail "re-mining after the ordered journal failed"
  LAG_JSON="$(curl -sf "${API_URL}/v1/patterns" -H "Authorization: Bearer ${TOKEN}")"
  LAG_ID="$(echo "$LAG_JSON" | python3 -c 'import json,sys; p=[x for x in json.load(sys.stdin) if x["detector"]=="lag"]; print(p[0]["id"] if p else "")')"
  LAG_LABEL="$(echo "$LAG_JSON" | python3 -c 'import json,sys; p=[x for x in json.load(sys.stdin) if x["detector"]=="lag"]; print(p[0]["label"] if p else "")')"

  if [ -z "$LAG_ID" ]; then
    fail "a month of ordered writing produced no ordered finding"
  else
    pass "the ordered finding is visible through the API"
    # It states an order and nothing more. This is the assertion the whole
    # detector exists to keep true.
    case "$(printf '%s' "$LAG_LABEL" | tr 'A-Z' 'a-z')" in
      *because*|*cause*|*trigger*|*"leads to"*|*makes*|*"due to"*)
        fail "the ordered finding claimed a cause: ${LAG_LABEL}" ;;
      *"came up 1 day before"*)
        pass "the label states order without cause" ;;
      *) fail "unexpected ordered label: ${LAG_LABEL}" ;;
    esac

    playwright-cli goto "${WEB_URL}/pattern/${LAG_ID}" >/dev/null 2>&1
    wait_for_snapshot "These entries were written" 30 \
      && pass "the ordered evidence screen opens" \
      || fail "the ordered evidence screen did not render"
    snapshot_contains "1 day later" \
      && pass "the gap between the two entries is named" \
      || fail "the screen did not name the gap"
    snapshot_contains "That is an order, not a" \
      && pass "the screen says an order is not a reason" \
      || fail "the screen did not disclaim causation"
    # Every occasion, not a representative one: four pairs were counted, so four
    # pairs have to be readable.
    OCCASIONS="$(grep -cF "1 day later" "$(latest_snapshot)" 2>/dev/null)"
    [ "$OCCASIONS" = "4" ] \
      && pass "all four counted occasions are shown" \
      || fail "expected 4 occasions on the screen, found ${OCCASIONS}"
    console_clean "the ordered evidence screen"
  fi
fi

step "Signing out"
# Sign-out lives in Settings now: it is not something you reach for while trying
# to write down a thought, so it left the journal along with the run log and the
# experiment engine.
playwright-cli goto "${WEB_URL}/settings" >/dev/null 2>&1
sleep 2
playwright-cli click "$(ref_for 'Sign out')" >/dev/null 2>&1
sleep 3
playwright-cli localstorage-get tlon.token 2>&1 | grep -q "not found" \
  && pass "token cleared from storage" \
  || fail "token survived sign-out"
playwright-cli snapshot >/dev/null 2>&1
snapshot_contains "Welcome back." \
  && pass "returned to the login screen" \
  || fail "did not return to login"

step "Browser console"
console_clean "the login screen"

printf '\n%s\n' "────────────────────────────────────────────"
if [ "$FAILURES" -eq 0 ]; then
  printf '\033[32mAll end-to-end checks passed.\033[0m\n'
  exit 0
fi
printf '\033[31m%s check(s) failed.\033[0m\n' "$FAILURES"
exit 1
