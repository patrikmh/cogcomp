#!/usr/bin/env bash
#
# End-to-end test for the desktop web client (apps/web).
#
# scripts/e2e.sh drives the mobile build in a real browser. This drives the
# other first-class client — the one with no browser coverage at all until now.
# Same discipline: disposable database, deterministic stubs, a journey a person
# actually takes, and a console-error guard on every page.
#
# Prerequisites:
#   - Postgres running (infrastructure/docker-compose.yml)
#   - nothing already bound to 8080 or 5173
#
# Usage: scripts/e2e-web.sh

set -uo pipefail
export TZ=UTC

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT=8080
WEB_PORT=5173
API_URL="http://localhost:${API_PORT}"
WEB_URL="http://localhost:${WEB_PORT}"
E2E_DATABASE_URL="${E2E_DATABASE_URL:-postgres://tlon:tlon@127.0.0.1:5433/tlon_web_e2e_$$}"

if ! E2E_DATABASE_URL="$E2E_DATABASE_URL" python3 - <<'PYDB'
from urllib.parse import unquote, urlparse
import os, re

url = urlparse(os.environ["E2E_DATABASE_URL"])
if url.scheme not in {"postgres", "postgresql"} or url.hostname not in {"localhost", "127.0.0.1", "::1"}:
    raise SystemExit("E2E_DATABASE_URL must be a local PostgreSQL URL")
database = unquote(url.path.lstrip("/"))
if not re.fullmatch(r"tlon_web_e2e_[a-z0-9_]+", database):
    raise SystemExit("E2E_DATABASE_URL database must match tlon_web_e2e_*")
PYDB
then
  exit 1
fi
export E2E_DATABASE_URL
export AGENTS_ENABLED=false
export FALKOR_HOST=127.0.0.1
export FALKOR_PORT=6379

LOGS="$(mktemp -d)"
PASSES=0
FAILS=0

pass() { PASSES=$((PASSES + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { FAILS=$((FAILS + 1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

latest_snapshot() {
  ls -t "${ROOT}/.playwright-cli"/page-*.yml 2>/dev/null | head -1
}

snapshot_contains() {
  grep -qF "$1" "$(latest_snapshot)" 2>/dev/null
}

wait_for_snapshot() {
  local text="$1" attempts="${2:-45}"
  for _ in $(seq 1 "$attempts"); do
    playwright-cli snapshot >/dev/null 2>&1
    if snapshot_contains "$text"; then return 0; fi
    sleep 1
  done
  return 1
}

ref_for() {
  grep -F "$1" "$(latest_snapshot)" 2>/dev/null | grep -oE 'ref=e[0-9]+' | head -1 | cut -d= -f2
}

ref_for_role() {
  local role="$1" label="$2"
  grep -F "${role} \"${label}\"" "$(latest_snapshot)" 2>/dev/null | grep -oE 'ref=e[0-9]+' | head -1 | cut -d= -f2
}

ref_for_tappable() {
  local label="$1" snapshot line
  snapshot="$(latest_snapshot)"
  line="$(grep -nF "$label" "$snapshot" 2>/dev/null | tail -1 | cut -d: -f1)"
  [ -n "$line" ] || return 1
  sed -n "1,${line}p" "$snapshot" | grep -oE 'ref=e[0-9]+' | tail -1 | cut -d= -f2
}

# Waits until a marker has LEFT the screen. Used where the interesting event is
# an absence arriving late — readings drawn behind a save clear the empty marker
# only after extraction resolves and the client refetches.
wait_for_snapshot_absent() {
  local text="$1" attempts="${2:-45}"
  for _ in $(seq 1 "$attempts"); do
    playwright-cli snapshot >/dev/null 2>&1
    if ! snapshot_contains "$text"; then return 0; fi
    sleep 1
  done
  return 1
}

console_clean() {
  local where="$1" allow="${2:-}" log errors
  playwright-cli console >/dev/null 2>&1
  log="$(ls -t "${ROOT}/.playwright-cli"/console-*.log 2>/dev/null | head -1)"
  if [ -z "$log" ] || [ ! -s "$log" ]; then
    fail "no console log was written for ${where}"
    return
  fi
  # Not anchored to line start: some logs prefix the level with an elapsed-time
  # stamp ([  475ms] [ERROR] ...), which an anchored grep silently misses.
  if [ -n "$allow" ]; then
    errors="$(grep '\[ERROR\]' "$log" | grep -vcF "$allow")"
    shown="$(grep '\[ERROR\]' "$log" | grep -vF "$allow" | head -3 | cut -c1-160)"
  else
    errors="$(grep -c '\[ERROR\]' "$log")"
    shown="$(grep '\[ERROR\]' "$log" | head -3 | cut -c1-160)"
  fi
  if [ "$errors" = "0" ]; then
    pass "no console errors on ${where}"
  else
    fail "${errors} console error(s) on ${where}"
    printf '%s\n' "$shown"
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

create_database() {
  "${ROOT}/apps/backend/.venv/bin/python" - "$E2E_DATABASE_URL" <<'PYDB'
import asyncio, sys
from urllib.parse import urlparse
import asyncpg

url = urlparse(sys.argv[1])
async def main():
    conn = await asyncpg.connect(
        host=url.hostname, port=url.port, user=url.username,
        password=url.password, database="postgres",
    )
    await conn.execute(f'DROP DATABASE IF EXISTS "{url.path.lstrip("/")}" WITH (FORCE)')
    await conn.execute(f'CREATE DATABASE "{url.path.lstrip("/")}"')
    await conn.close()

asyncio.run(main())
PYDB
}

cleanup() {
  if [ -n "${API_PID:-}" ]; then kill "$API_PID" 2>/dev/null; fi
  if [ -n "${WEB_PID:-}" ]; then kill "$WEB_PID" 2>/dev/null; fi
  playwright-cli close-all >/dev/null 2>&1 || true
  [ "${DATABASE_CREATED:-0}" = "1" ] && \
    "${ROOT}/apps/backend/.venv/bin/python" - "$E2E_DATABASE_URL" <<'PYDROP'
import asyncio, sys
from urllib.parse import urlparse
import asyncpg

url = urlparse(sys.argv[1])
async def main():
    conn = await asyncpg.connect(
        host=url.hostname, port=url.port, user=url.username,
        password=url.password, database="postgres",
    )
    await conn.execute(f'DROP DATABASE IF EXISTS "{url.path.lstrip("/")}" WITH (FORCE)')
    await conn.close()

asyncio.run(main())
PYDROP
  return 0
}
trap cleanup EXIT

step "Starting services"
playwright-cli close-all >/dev/null 2>&1 || true
for port in "$API_PORT" "$WEB_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "a service is already listening on port ${port}; refusing shared E2E services" >&2
    exit 1
  fi
done

# Cleared for the same reason the mobile suite clears them: deterministic stubs,
# no paid API, no network flake. The live model is covered by benchmarks/.
export OPENROUTER_API_KEY=""
export TRANSCRIPTION_API_KEY=""
export ELEVENLABS_API_KEY=""

if ! create_database; then
  echo "could not create disposable E2E database" >&2
  exit 1
fi
DATABASE_CREATED=1

(cd "${ROOT}/apps/backend" && exec env DATABASE_URL="${E2E_DATABASE_URL}" AGENTS_ENABLED=false \
  FALKOR_HOST=127.0.0.1 FALKOR_PORT=6379 .venv/bin/python -m uvicorn tlon.main:app \
  --host 127.0.0.1 --port "${API_PORT}") >"${LOGS}/api.log" 2>&1 &
API_PID=$!
wait_for "${API_URL}/health" "backend" || { cat "${LOGS}/api.log"; exit 1; }
pass "backend started"

# The desktop client is same-origin in dev: Vite proxies /v1 to 8080 (its config
# pins that port), so VITE_API_URL stays unset rather than pointed elsewhere.
(cd "${ROOT}/apps/web" && exec npm run dev -- --port "${WEB_PORT}") >"${LOGS}/web.log" 2>&1 &
WEB_PID=$!
wait_for "${WEB_URL}" "web" 90 || { tail -20 "${LOGS}/web.log"; exit 1; }
pass "web started"

step "Signed-out users are sent to the login screen"
playwright-cli open "${WEB_URL}" >/dev/null 2>&1
if wait_for_snapshot "SIGN IN" 45 || wait_for_snapshot "Welcome back" 20; then
  pass "login screen rendered"
else
  fail "did not land on the login screen"
fi

step "Creating an account through the form"
playwright-cli goto "${WEB_URL}/#/login" >/dev/null 2>&1
wait_for_snapshot "SIGN IN" 30 || true
playwright-cli click "$(ref_for 'CREATE AN ACCOUNT')" >/dev/null 2>&1
EMAIL="web-e2e-$(date +%s)@example.com"
PASSWORD="quiet harbor lantern light"
wait_for_snapshot "Twelve characters or more" 20 || true
playwright-cli fill "$(ref_for 'Email')" "$EMAIL" >/dev/null 2>&1
playwright-cli fill "$(ref_for_role 'textbox' 'Password · twelve characters or more')" "$PASSWORD" >/dev/null 2>&1 || \
  playwright-cli fill "$(ref_for 'Password')" "$PASSWORD" >/dev/null 2>&1
playwright-cli click "$(ref_for 'CREATE ACCOUNT')" >/dev/null 2>&1
if wait_for_snapshot "Headspace" 45; then
  pass "signup lands inside the app"
else
  fail "signup did not reach the app"
fi
# The desktop client opens on Headspace; the journey continues from the journal.
playwright-cli goto "${WEB_URL}/#/journal" >/dev/null 2>&1
wait_for_snapshot "Write what happened" 30 || true
TOKEN="$(playwright-cli localstorage-get tlon.token 2>&1 | grep -oE '[A-Za-z0-9_-]{40,}' | head -1)"
[ -n "$TOKEN" ] && pass "session persisted to storage" || fail "no token stored"
console_clean "journal after signup"

step "Writing an entry"
ENTRY="Promised myself a walk at lunch and actually took it; the afternoon went easier."
COMPOSER="$(ref_for 'Journal entry')"
[ -n "$COMPOSER" ] || COMPOSER="$(ref_for_tappable 'Write what happened')"
playwright-cli fill "$COMPOSER" "$ENTRY" >/dev/null 2>&1
# The send control only exists once there is something to send, and snapshot
# refs can die when the composer re-renders — so both the fill above and the
# click here go through role locators rather than refs.
playwright-cli run-code "async page => { await page.getByRole('button', { name: 'Send journal entry' }).click(); }" >/dev/null 2>&1
if wait_for_snapshot "$ENTRY" 45 && wait_for_snapshot "Latest · saved" 30; then
  pass "the entry is kept and marked saved"
else
  fail "the saved entry did not render"
fi

step "Readings are drawn without anyone asking twice"
# The client extracts on save and refetches when extraction RESOLVES. The stub
# emits Thoughts only, so what matters here is that the empty marker goes away —
# the graph grew, whatever shape it grew in.
if wait_for_snapshot_absent "nothing drawn from this yet" 60; then
  pass "readings appear behind the save"
else
  fail "\"nothing drawn\" never cleared after extraction"
fi
console_clean "journal after extraction"

step "The explain screen keeps its promises"
OBS_ID="$(curl -s "${API_URL}/v1/observations" -H "Authorization: Bearer ${TOKEN}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["observations"][0]["id"])')"
playwright-cli goto "${WEB_URL}/#/node/${OBS_ID}" >/dev/null 2>&1
wait_for_snapshot "Where this came from" 45 \
  && pass "observation opens on the provenance screen" \
  || fail "provenance screen did not render"
wait_for_snapshot "makes no claim" 20 \
  && pass "an observation claims nothing" \
  || fail "observation framing missing"
console_clean "node screen"

step "A reading can be judged, and the judgement taken back"
THOUGHT_ID="$(curl -s "${API_URL}/v1/graph?limit=200" -H "Authorization: Bearer ${TOKEN}" \
  | python3 -c 'import json,sys; g=json.load(sys.stdin); n=[x for x in g.get("nodes", []) if x.get("kind")=="Thought"]; print(n[0]["id"] if n else "")')"
if [ -z "$THOUGHT_ID" ]; then
  fail "no extracted reading found to judge"
else
  playwright-cli goto "${WEB_URL}/#/node/${THOUGHT_ID}" >/dev/null 2>&1
  wait_for_snapshot "NOT REALLY" 45 \
    && pass "the verdict controls render on a reading" \
    || fail "verdict controls missing"
  playwright-cli click "$(ref_for 'NOT REALLY')" >/dev/null 2>&1
  wait_for_snapshot "no longer feeding patterns" 30 \
    && pass "rejection states exactly what it stops" \
    || fail "rejection did not take effect"
  # Tapping the active choice withdraws it — a verdict given in a bad week
  # must be retakeable.
  playwright-cli click "$(ref_for 'NOT REALLY')" >/dev/null 2>&1
  wait_for_snapshot "stops this feeding" 30 \
    && pass "the rejection is withdrawable" \
    || fail "withdrawing the rejection failed"
fi
console_clean "verdict screen"

step "Patterns refuses to invent anything from one entry"
playwright-cli goto "${WEB_URL}/#/patterns" >/dev/null 2>&1
wait_for_snapshot "What keeps returning" 45 \
  && pass "patterns screen renders" \
  || fail "patterns screen did not render"
snapshot_contains "Nothing has come back often enough" \
  && pass "too little material produces no pattern" \
  || fail "invented a pattern from one entry"
playwright-cli click "$(ref_for 'LOOK AGAIN')" >/dev/null 2>&1
sleep 3
snapshot_contains "What keeps returning" \
  && pass "mining runs on demand" \
  || fail "look again broke the screen"
console_clean "patterns screen"

step "Findings can be switched off without losing anything"
playwright-cli goto "${WEB_URL}/#/settings" >/dev/null 2>&1
wait_for_snapshot "Patterns and regions" 45 || true
# The knob is the control and carries the accessible name; the visible label is
# a separate text node without a ref of its own.
SWITCH="$(ref_for_role 'switch' 'Patterns and regions')"
[ -n "$SWITCH" ] && playwright-cli click "$SWITCH" >/dev/null 2>&1
sleep 2
# With findings off the desktop client does not render a turned-off page — the
# route itself sends you back to the map. The conclusions screens simply stop
# existing until asked for again.
playwright-cli goto "${WEB_URL}/#/patterns" >/dev/null 2>&1
sleep 3
if playwright-cli eval "() => location.hash.startsWith('#/patterns') ? 'stayed' : 'redirected'" 2>/dev/null | grep -q 'redirected'; then
  pass "conclusions routes close when findings are off"
else
  fail "patterns stayed reachable with findings off"
fi

step "Switching findings back on restores them"
playwright-cli goto "${WEB_URL}/#/settings" >/dev/null 2>&1
wait_for_snapshot "Patterns and regions" 30 || true
SWITCH="$(ref_for_role 'switch' 'Patterns and regions')"
[ -n "$SWITCH" ] && playwright-cli click "$SWITCH" >/dev/null 2>&1
sleep 2
playwright-cli goto "${WEB_URL}/#/patterns" >/dev/null 2>&1
wait_for_snapshot "What keeps returning" 45 \
  && pass "findings come back on request" \
  || fail "re-enabling findings failed"
console_clean "patterns settings"

step "An experiment can be written and started"
playwright-cli goto "${WEB_URL}/#/experiments" >/dev/null 2>&1
wait_for_snapshot "WRITE AN EXPERIMENT" 45 \
  && pass "the trials screen renders" \
  || fail "experiments screen did not render"
playwright-cli click "$(ref_for 'WRITE AN EXPERIMENT')" >/dev/null 2>&1
wait_for_snapshot "draft" 45 \
  && pass "a draft is created and opened" \
  || fail "creating an experiment failed"
snapshot_contains "you decide what it means" \
  && pass "the verdict stays with the person" \
  || fail "interpretation language appeared on the trial"
START="$(ref_for 'START')"
[ -n "$START" ] && playwright-cli click "$START" >/dev/null 2>&1
sleep 3
playwright-cli snapshot >/dev/null 2>&1
if snapshot_contains "PAUSE" || snapshot_contains "active"; then
  pass "the trial started"
else
  fail "starting the trial failed"
fi
console_clean "experiment detail"

step "Search finds what was written"
playwright-cli goto "${WEB_URL}/#/search" >/dev/null 2>&1
wait_for_snapshot "A word you remember writing" 45 \
  && pass "search renders its field" \
  || fail "search screen did not render"
# The screen filters as you type, and the result line is uppercased by CSS —
# so the assertion reads the DOM case-insensitively rather than the snapshot.
playwright-cli run-code "async page => { await page.getByPlaceholder('A word you remember writing').fill('walk'); }" >/dev/null 2>&1
sleep 2
if playwright-cli eval "() => /acts contain/i.test(document.querySelector('main')?.innerText || '') ? 'hit' : 'miss'" 2>/dev/null | grep -q 'hit'; then
  pass "search answers over the person's own words"
else
  fail "search did not return the written entry"
fi
console_clean "search screen"

step "Talk answers a typed turn and keeps the loop alive"
playwright-cli goto "${WEB_URL}/#/talk" >/dev/null 2>&1
wait_for_snapshot "What stays from this conversation" 45 \
  && pass "the talk disclosure renders first" \
  || fail "talk screen did not render"
TURN="I finally sent the message I had been putting off all week."
playwright-cli fill "$(ref_for_role 'textbox' 'Say what happened')" "$TURN" >/dev/null 2>&1 || \
  playwright-cli fill "$(ref_for 'Say what happened')" "$TURN" >/dev/null 2>&1
playwright-cli press Enter >/dev/null 2>&1
# The person's own words must appear — only their turns become observations.
wait_for_snapshot "$TURN" 30 \
  && pass "the turn is kept verbatim" \
  || fail "the typed turn did not render"
# The stub agent replies locally; the loop is alive again when the input does
# not stay disabled waiting for a reply that already came.
if wait_for_snapshot_absent "thinking" 90; then
  pass "the agent answered and the input came back"
else
  fail "the reply never completed"
fi
CLOSE="$(ref_for 'close · keeps your turns')"
[ -n "$CLOSE" ] && playwright-cli click "$CLOSE" >/dev/null 2>&1
sleep 3
# The voice credential is stripped for determinism, so the agent's reply cannot
# be spoken and /v1/voice/speak correctly answers 503. The app surfaces that as
# a failed resource load — punished here it would be punishing honesty.
console_clean "talk screen" "voice/speak"

step "Every remaining screen renders with the journey's data"
playwright-cli goto "${WEB_URL}/#/today" >/dev/null 2>&1
wait_for_snapshot "The acts" 45 \
  && pass "Today renders the written day" \
  || fail "Today screen did not render"
console_clean "today screen"

playwright-cli goto "${WEB_URL}/#/week" >/dev/null 2>&1
wait_for_snapshot "Writing on" 45 \
  && pass "Week counts the writing days" \
  || fail "Week screen did not render"
console_clean "week screen"

playwright-cli goto "${WEB_URL}/#/identity" >/dev/null 2>&1
wait_for_snapshot "Drawn from everything you kept" 45 \
  && pass "Identity renders its composition" \
  || fail "Identity screen did not render"
console_clean "identity screen"

playwright-cli goto "${WEB_URL}/#/experiments" >/dev/null 2>&1
wait_for_snapshot "Things you decided to try" 45 \
  && pass "Experiments renders without a score in sight" \
  || fail "Experiments screen did not render"
console_clean "experiments screen"

playwright-cli goto "${WEB_URL}/#/graph" >/dev/null 2>&1
wait_for_snapshot "nodes" 45 \
  && pass "the graph projection renders its nodes" \
  || fail "Graph screen did not render"
console_clean "graph screen"

printf '\n────────────────────────────────────────\n'
if [ "$FAILS" = "0" ]; then
  printf '\033[32mAll web end-to-end checks passed.\033[0m\n'
  exit 0
fi
printf '\033[31m%s check(s) failed.\033[0m\n' "$FAILS"
exit 1
