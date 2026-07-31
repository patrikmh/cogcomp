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

snapshot_contains() {
  grep -qF "$1" "$(latest_snapshot)" 2>/dev/null
}

# A section heading is its own node in the snapshot, rendered as `...: <label>` at
# the end of a line. Matching the bare word would also hit the footnote, which
# names both section titles in prose.
snapshot_has_section() {
  grep -qE ": $1\$" "$(latest_snapshot)" 2>/dev/null
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

if curl -sf -o /dev/null "${API_URL}/health"; then
  pass "backend already running"
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
playwright-cli click "$(ref_for 'Save')" >/dev/null 2>&1
sleep 3
playwright-cli snapshot >/dev/null 2>&1
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

step "Tapping an inference shows where it came from"
# The footnote promises this. It is the concrete form of "every inference must be
# explainable", so it is the single most important thing in the app to verify.
GUESS_REF="$(ref_for 'I told Sara')"
# The first match is the entry itself; the inference card is the later one.
GUESS_REF="$(grep -F 'I told Sara' "$(latest_snapshot)" | tail -1 | grep -oE 'ref=e[0-9]+' | cut -d= -f2)"
playwright-cli click "$GUESS_REF" >/dev/null 2>&1
sleep 3
playwright-cli snapshot >/dev/null 2>&1
snapshot_contains "hypothesis drawn from your own words" \
  && pass "framed as a hypothesis, not a conclusion" \
  || fail "hypothesis framing missing on the explain screen"
snapshot_contains "$ENTRY" \
  && pass "shows the user's own words as the source" \
  || fail "source entry not shown"
snapshot_contains "extract-v0.1" \
  && pass "records which extractor produced it" \
  || fail "extractor not shown"
snapshot_contains "How this was produced" \
  && pass "provenance is surfaced, not hidden" \
  || fail "provenance block missing"

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

step "An empty day says so, without nudging"
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

step "Signing out"
playwright-cli goto "${WEB_URL}/" >/dev/null 2>&1
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
ERRORS="$(playwright-cli console 2>&1 | grep -oE 'Errors: [0-9]+' | grep -oE '[0-9]+' | head -1)"
[ "${ERRORS:-0}" = "0" ] && pass "no console errors" || fail "${ERRORS} console errors"

printf '\n%s\n' "────────────────────────────────────────────"
if [ "$FAILURES" -eq 0 ]; then
  printf '\033[32mAll end-to-end checks passed.\033[0m\n'
  exit 0
fi
printf '\033[31m%s check(s) failed.\033[0m\n' "$FAILURES"
exit 1
