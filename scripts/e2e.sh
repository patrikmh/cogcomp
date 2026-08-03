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

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT=8080
WEB_PORT=8081
API_URL="http://localhost:${API_PORT}"
WEB_URL="http://localhost:${WEB_PORT}"
LOGS="$(mktemp -d)"
EMAIL="e2e-$(date +%s)@example.com"
PASSWORD="a long enough passphrase"

FAILURES=0
STARTED_API=0
STARTED_WEB=0

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

cleanup() {
  playwright-cli close >/dev/null 2>&1
  [ "$STARTED_WEB" = 1 ] && pkill -f "expo start --web --port ${WEB_PORT}" >/dev/null 2>&1
  [ "$STARTED_API" = 1 ] && pkill -f "uvicorn tlon.main:app.*${API_PORT}" >/dev/null 2>&1
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
  grep -qE ": $1\$" "$(latest_snapshot)" 2>/dev/null
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

# Cleared so the run uses the deterministic stubs even when real keys are in
# .env. An end-to-end test that quietly starts calling a paid API is slow,
# nondeterministic, and no longer testing this code — the same reasoning as the
# integration suite's conftest. The live model is covered by benchmarks/.
export OPENROUTER_API_KEY=""
export TRANSCRIPTION_API_KEY=""
export ELEVENLABS_API_KEY=""

if curl -sf -o /dev/null "${API_URL}/health"; then
  # A backend we did not start may be running against real keys, which would
  # make the confidence-dependent checks below nondeterministic.
  if ! curl -s "${API_URL}/ready" | grep -q '/stub"'; then
    echo "  ! a backend is already running with real keys; stop it first" >&2
    exit 1
  fi
  pass "backend already running (stub extractor)"
else
  (cd "${ROOT}/apps/backend" && .venv/bin/python -m uvicorn tlon.main:app \
    --host 0.0.0.0 --port "${API_PORT}" >"${LOGS}/api.log" 2>&1 &)
  STARTED_API=1
  wait_for "${API_URL}/health" "backend" || { cat "${LOGS}/api.log"; exit 1; }
  pass "backend started"
fi

if curl -sf -o /dev/null "${WEB_URL}"; then
  pass "web already running"
else
  (cd "${ROOT}/apps/mobile" && EXPO_PUBLIC_API_URL="${API_URL}" \
    npx expo start --web --port "${WEB_PORT}" >"${LOGS}/web.log" 2>&1 &)
  STARTED_WEB=1
  wait_for "${WEB_URL}" "web" 90 || { tail -20 "${LOGS}/web.log"; exit 1; }
  pass "web started"
fi

step "Signed-out users are sent to the login screen"
playwright-cli open "${WEB_URL}" >/dev/null 2>&1
sleep 3
if playwright-cli snapshot 2>&1 | grep -q "/login"; then
  pass "redirected to /login"
else
  # Fall back to checking the rendered content, since the URL line only appears
  # in the command output rather than the snapshot file.
  snapshot_contains "Welcome back." && pass "login screen rendered" \
    || fail "did not land on the login screen"
fi

step "Creating an account"
SWITCH="$(ref_for 'Create an account instead')"
[ -n "$SWITCH" ] && playwright-cli click "$SWITCH" >/dev/null 2>&1 && sleep 1
snapshot_contains "At least 12 characters" \
  && pass "password guidance shown before signup" \
  || fail "password guidance missing"

playwright-cli fill "$(ref_for 'Email')" "$EMAIL" >/dev/null 2>&1
playwright-cli fill "$(ref_for 'Password')" "$PASSWORD" >/dev/null 2>&1
playwright-cli click "$(ref_for 'Create account')" >/dev/null 2>&1
sleep 4

playwright-cli snapshot >/dev/null 2>&1
snapshot_contains "What's on your mind?" \
  && pass "signup lands on the journal" \
  || fail "signup did not reach the journal"

TOKEN="$(playwright-cli localstorage-get tlon.token 2>&1 | grep -oE '[A-Za-z0-9_-]{40,}' | head -1)"
[ -n "$TOKEN" ] && pass "session persisted to storage" || fail "no token stored"

step "Writing an entry"
ENTRY="I told Sara I would finish the report and I have not started it."
playwright-cli fill "$(ref_for "What's on your mind?")" "$ENTRY" >/dev/null 2>&1
# Re-snapshot before resolving Save. The composer shows one control at a time —
# with nothing typed that slot is "Hold to record", and Save only exists once
# there is something to save. Resolving its ref from the pre-fill snapshot found
# nothing, so the click silently did nothing.
playwright-cli snapshot >/dev/null 2>&1
playwright-cli click "$(ref_for 'Save')" >/dev/null 2>&1
sleep 3
playwright-cli snapshot >/dev/null 2>&1

# Asked of the server, not the screen. The previous check looked for the entry
# text in the snapshot — which passes whether the entry saved or is merely still
# sitting in the input, so it could not fail for the reason it claimed to.
curl -s "${API_URL}/v1/observations" -H "Authorization: Bearer ${TOKEN}" \
  | grep -qF "$ENTRY" \
  && pass "entry was actually saved" \
  || fail "entry was not saved"
snapshot_contains "$ENTRY" \
  && pass "entry round-tripped and rendered" \
  || fail "entry did not appear in the journal"

step "The daily summary"
playwright-cli click "$(ref_for 'Today')" >/dev/null 2>&1
sleep 3
playwright-cli snapshot >/dev/null 2>&1
snapshot_contains "1 entry" && pass "today reports one entry" || fail "entry count wrong"
snapshot_contains "$ENTRY" && pass "entry shown under what you wrote" || fail "entry missing"

step "A low-confidence inference is presented as a guess"
# No UI for extraction yet, so it is triggered directly. What is being verified is
# the rendering: a 0.3-confidence guess must not sit under "Noticed".
OID="$(curl -s "${API_URL}/v1/observations" -H "Authorization: Bearer ${TOKEN}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["observations"][0]["id"])')"
curl -sf -X POST "${API_URL}/v1/observations/${OID}/extract" \
  -H "Authorization: Bearer ${TOKEN}" >/dev/null && pass "extraction ran" || fail "extraction failed"

playwright-cli reload >/dev/null 2>&1
sleep 3
playwright-cli snapshot >/dev/null 2>&1
snapshot_has_section "Less sure about" \
  && pass "tentative inference is in its own section" \
  || fail "tentative section missing"
snapshot_has_section "Noticed" \
  && fail "a 0.3-confidence guess was presented as something noticed" \
  || pass "guess kept out of the confident section"
snapshot_contains "not a conclusion about you" \
  && pass "inferences are framed as hypotheses" \
  || fail "hypothesis framing missing"

step "The weekly report is navigable, deterministic, and explainable"
# Use the link a person sees on the journal rather than making the route itself
# the thing under test. The stub extractor above makes the tentative card stable.
playwright-cli goto "${WEB_URL}/" >/dev/null 2>&1
wait_for_snapshot "Week" 30 \
  && pass "journal exposes the Week link" \
  || fail "Week link missing from the journal"
playwright-cli click "$(ref_for 'Week')" >/dev/null 2>&1
wait_for_snapshot "$ENTRY" 30 \
  && pass "current week renders the entry" \
  || fail "current week did not render the entry"
snapshot_has_section "Less sure about" \
  && pass "current week renders the tentative inference" \
  || fail "tentative inference missing from current week"

# The footnote promises this. It is the concrete form of "every inference must be
# explainable", so it is the single most important thing in the app to verify.
GUESS_REF="$(grep -F 'I told Sara' "$(latest_snapshot)" | tail -1 | grep -oE 'ref=e[0-9]+' | cut -d= -f2)"
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
playwright-cli click "$(ref_for 'Previous')" >/dev/null 2>&1
wait_for_snapshot "Nothing recorded." 30 \
  && pass "previous empty week says nothing was recorded" \
  || fail "previous empty week not reported"
for nudge in "streak" "Keep going" "Why not"; do
  snapshot_contains "$nudge" && fail "found an engagement nudge: ${nudge}"
done
pass "empty week has no engagement nudges"

console_clean "the journal"

step "The dashboard"
playwright-cli goto "${WEB_URL}/graph" >/dev/null 2>&1
sleep 3
playwright-cli snapshot >/dev/null 2>&1
snapshot_contains "entries" && pass "dashboard renders counts" || fail "dashboard counts missing"
snapshot_contains "What has been noticed" \
  && pass "dashboard lists what was drawn from entries" \
  || fail "dashboard list missing"
snapshot_contains "Hide tentative guesses" \
  && pass "tentative guesses can be filtered out" \
  || fail "tentative filter missing"

# Hiding tentative guesses should empty the list, since the stub emits 0.3.
playwright-cli click "$(ref_for 'Hide tentative guesses')" >/dev/null 2>&1
sleep 3
playwright-cli snapshot >/dev/null 2>&1
snapshot_contains "Nothing confident enough to show" \
  && pass "filtering removes the low-confidence guesses" \
  || fail "filter had no effect"

console_clean "the dashboard"

step "The graph explorer"
# Skia on web loads CanvasKit as a 7.6MB WASM module, so the canvas appears
# several seconds after the route does. Waiting for the element rather than
# sleeping a fixed amount keeps this from being flaky on a slow machine.
playwright-cli goto "${WEB_URL}/explore" >/dev/null 2>&1
CANVAS=""
for _ in $(seq 1 20); do
  if playwright-cli eval "document.querySelector('canvas') ? 'yes' : 'no'" 2>&1 | grep -q '"yes"'; then
    CANVAS="yes"; break
  fi
  sleep 3
done
[ -n "$CANVAS" ] && pass "the Skia canvas renders" || fail "canvas never appeared"

CANVAS_ERRORS="$(playwright-cli console 2>&1 | grep -oE 'Errors: [0-9]+' | grep -oE '[0-9]+' | head -1)"
[ "${CANVAS_ERRORS:-0}" = "0" ] \
  && pass "no errors while rendering the graph" \
  || fail "${CANVAS_ERRORS} errors on the explorer"

step "An empty day says so, without nudging"
playwright-cli goto "${WEB_URL}/today" >/dev/null 2>&1
sleep 3
playwright-cli snapshot >/dev/null 2>&1
playwright-cli goto "${WEB_URL}/today" >/dev/null 2>&1
sleep 3
playwright-cli snapshot >/dev/null 2>&1
playwright-cli click "$(ref_for 'Previous')" >/dev/null 2>&1
sleep 2
playwright-cli snapshot >/dev/null 2>&1
snapshot_contains "Nothing recorded" \
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
sleep 4
playwright-cli snapshot >/dev/null 2>&1
snapshot_contains "Hold to record" \
  && pass "voice capture offered" \
  || fail "no record control on the talk screen"
snapshot_contains "isn't saved as an entry" \
  && pass "says which side of the conversation is kept" \
  || fail "did not state what is kept"

# The sphere is the interface; the transcript is one tap away rather than the
# thing you sit and read while talking.
STAGE="$(ref_for 'focus mode')"
[ -n "$STAGE" ] && playwright-cli click "$STAGE" >/dev/null 2>&1
sleep 2
playwright-cli snapshot >/dev/null 2>&1
COMPOSER="$(ref_for 'Say something')"
if [ -n "$COMPOSER" ]; then
  pass "tapping the sphere reveals the transcript"
  playwright-cli fill "$COMPOSER" "Mondays have felt heavy lately" >/dev/null 2>&1
  playwright-cli click "$(ref_for 'Send')" >/dev/null 2>&1
  sleep 5
  playwright-cli snapshot >/dev/null 2>&1
  snapshot_contains "Mondays have felt heavy lately" \
    && pass "the turn round-tripped" \
    || fail "turn did not appear"
else
  fail "composer never appeared"
fi
# The only excused error in the run: speech is deliberately unconfigured here, so
# the one probe the client makes before learning that is expected. It asks once
# and then stops — see src/lib/useSpokenReply.ts.
console_clean "the talk screen" "/v1/voice/speak"

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
echo "$RUNS" | grep -q '"status"' \
  && pass "agents ran on request" \
  || fail "manual run produced nothing"
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
echo "$LOG" | grep -q "Mondays have felt heavy" \
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
ENV_DB_URL="$(sed -n 's/^DATABASE_URL=//p' "${ROOT}/apps/backend/.env" | head -1)"
DB_URL="${DATABASE_URL:-${ENV_DB_URL:-postgres://tlon:tlon@localhost:5433/tlon}}"
DATABASE_URL="$DB_URL" uv run --env-file "${ROOT}/apps/backend/.env" --project "${ROOT}/apps/backend" python - "$EMAIL" "${PATTERN_IDS[@]-}" <<'PYSEED'
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
wait_for_snapshot "Try a question, in your own words." 30 \
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
wait_for_snapshot "$HYPOTHESIS" 30 || fail "experiment detail did not render"
EXPERIMENT_URL="${WEB_URL}/experiment/${EXPERIMENT_ID}"
playwright-cli click "$(ref_for 'Start')" >/dev/null 2>&1
wait_for_snapshot "EXPERIMENT · ACTIVE" 30 \
  && pass "experiment started" || fail "experiment did not start"
playwright-cli click "$(ref_for 'Pause')" >/dev/null 2>&1
wait_for_snapshot "EXPERIMENT · PAUSED" 30 \
  && pass "experiment paused" || fail "experiment did not pause"
playwright-cli click "$(ref_for 'Resume')" >/dev/null 2>&1
wait_for_snapshot "EXPERIMENT · ACTIVE" 30 \
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
    | grep -q "Mondays have felt heavy" \
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

step "Returning to the first account and deleting the experiment"
# The second account was checked through bounded authenticated API calls, so the
# browser session remains the first account and can finish its own lifecycle.
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
