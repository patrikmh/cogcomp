#!/usr/bin/env bash
#
# Recreate the demo account, with enough material that every screen has something
# to show.
#
# The end-to-end suite runs against the development database and clears it, so a
# hand-made account does not survive a test run. Rebuilding it by hand each time
# is slow and tends to produce a different shape of data every time, which makes
# "does this screen look right" impossible to answer consistently.
#
# Safe to run repeatedly: if the account already exists it signs in instead.
#
# Usage: scripts/seed_demo.sh [email] [password]

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="${API_URL:-http://localhost:8080}"
EMAIL="${1:-patrik@example.com}"
PASSWORD="${2:-a sufficiently long passphrase}"
PY="${ROOT}/apps/backend/.venv/bin/python"

if ! curl -sf -o /dev/null "${API}/health"; then
  echo "no backend at ${API} — start it first" >&2
  exit 1
fi

json() { "$PY" -c "import sys,json;print(json.load(sys.stdin).get('$1',''))"; }

RESP="$(curl -s -X POST "${API}/v1/auth/signup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"device\":\"seed\"}")"
if ! grep -q '"token"' <<<"$RESP"; then
  RESP="$(curl -s -X POST "${API}/v1/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"device\":\"seed\"}")"
fi

TOKEN="$(json token <<<"$RESP")"
if [ -z "$TOKEN" ]; then
  echo "could not sign in as ${EMAIL}: $(head -c 200 <<<"$RESP")" >&2
  exit 1
fi

# Spread over the past week, and deliberately repetitive: sleep and Mondays recur
# so that pattern mining has something real to find rather than returning empty
# on every demo.
ENTRIES=(
  "Mondays feel heavy before they even start"
  "Slept badly again, third night running"
  "Called my sister and felt lighter after"
  "The meeting ran long and I lost the whole afternoon"
  "Keep putting off the dentist appointment"
  "Walked by the water and that helped"
  "Snapped at a colleague over nothing"
  "Read for an hour before bed and slept better"
  "Dreading Monday again, same as last week"
  "Slept badly, keep waking at four"
)

created=0
for i in "${!ENTRIES[@]}"; do
  id="$("$PY" -c 'import uuid;print(uuid.uuid4())')"
  when="$(date -u -v-"${i}"d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "-${i} days" +%Y-%m-%dT%H:%M:%SZ)"
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${API}/v1/observations" \
    -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
    --data-binary "{\"id\":\"${id}\",\"content\":\"${ENTRIES[$i]}\",\"source\":\"text\",\"captured_at\":\"${when}\"}")"
  [ "$code" = "201" ] && created=$((created + 1))
  # Extraction is a separate call on purpose — the API does not infer behind your
  # back — so the seed has to ask for it too.
  curl -s -o /dev/null -X POST "${API}/v1/observations/${id}/extract" \
    -H "Authorization: Bearer ${TOKEN}"
done

# Consolidation then pattern mining, in that order, so recurrence is counted
# after duplicates have been merged.
curl -s -o /dev/null -X POST "${API}/v1/agents/run" -H "Authorization: Bearer ${TOKEN}"

NODES="$(curl -s "${API}/v1/graph?limit=200" -H "Authorization: Bearer ${TOKEN}" \
  | "$PY" -c 'import sys,json;d=json.load(sys.stdin);print(len(d["nodes"]))')"
PATTERNS="$(curl -s "${API}/v1/patterns" -H "Authorization: Bearer ${TOKEN}" \
  | "$PY" -c 'import sys,json;print(len(json.load(sys.stdin)))')"

printf '\n\033[32mSeeded\033[0m %s\n' "$EMAIL"
printf '  password : %s\n' "$PASSWORD"
printf '  entries  : %s\n' "$created"
printf '  nodes    : %s\n' "$NODES"
printf '  patterns : %s\n' "$PATTERNS"
