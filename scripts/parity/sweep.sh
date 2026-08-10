#!/usr/bin/env bash
#
# The live half of the parity harness: shape and copy, every route, both sides.
#
# This existed as ad-hoc shell for a while and produced three false readings in
# one pass — a route measured mid-load, a baseline left over from the previous
# route, and a screen that had been navigated somewhere else before capture. All
# three looked exactly like app faults. So the waiting, the per-route isolation
# and the reset are the point of this file, not incidental to it.
#
#   scripts/parity/sweep.sh '<design>/tlon.html'   # design served separately
#
# Expects: the app on :5173 signed in, the design on :5199/proto.html, and
# playwright-cli sessions `verify` (app) and `pstyle` (design).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="${APP_URL:-http://localhost:5173}"
DESIGN="${DESIGN_URL:-http://localhost:5199/proto.html}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ROUTES=(${ROUTES:-"" journal today week search patterns identity experiments agents graph explore settings talk first words})

# Wait for the route to stop changing rather than for a number of seconds. A
# fixed sleep is either too short — which reads as the app missing everything
# that had not arrived — or too long on every route to cover the slowest one.
settle() {
  local session="$1" last="" now="" stable=0
  for _ in $(seq 1 40); do
    now=$(playwright-cli -s="$session" eval \
      '() => { const v=document.querySelector("#view")||document.body; const busy=v.querySelector(".empty")?.textContent==="…"; return busy ? "loading" : String(v.textContent||"").length }' \
      2>/dev/null | sed -n '2p' | tr -d '"')
    if [ -n "$now" ] && [ "$now" != "loading" ] && [ "$now" = "$last" ]; then
      stable=$((stable + 1))
      [ "$stable" -ge 2 ] && return 0
    else
      stable=0
    fi
    last="$now"
    sleep 0.4
  done
  return 1
}

capture() {  # session, script, outfile
  playwright-cli -s="$1" eval "$(cat "$2")" 2>&1 |
    sed -n '2,800p' | tr -d '"' | tr '\\' '\n' | sed 's/^n//' |
    grep -v '^###\|^- Page\|^$' > "$3"
}

# Load the bundle fresh once. Every route after this is a hash change, and a
# hash change does not re-execute modules — so a sweep run after any source edit
# measures the code as it was when the tab was opened. That read as a missing
# second-side bar on a pattern that had one, which is indistinguishable from the
# app having lost it.
playwright-cli -s=verify goto "$APP/#/" >/dev/null 2>&1
playwright-cli -s=verify reload >/dev/null 2>&1
settle verify || true
playwright-cli -s=pstyle goto "$DESIGN#/" >/dev/null 2>&1
playwright-cli -s=pstyle reload >/dev/null 2>&1
settle pstyle || true

printf '%-12s %10s %5s %5s\n' route structure ids copy
for route in "${ROUTES[@]}"; do
  # Fresh files per route: a stale baseline reads as a perfect score on one
  # route and a catastrophe on the next.
  a_shape="$WORK/a.shape"; p_shape="$WORK/p.shape"
  a_copy="$WORK/a.copy";   p_copy="$WORK/p.copy"
  rm -f "$a_shape" "$p_shape" "$a_copy" "$p_copy"

  playwright-cli -s=verify goto "$APP/#/$route" >/dev/null 2>&1
  settle verify || echo "  (app /$route never settled)" >&2
  capture verify "$HERE/shape.js" "$WORK/a.raw"
  capture verify "$HERE/copy.js" "$a_copy"

  playwright-cli -s=pstyle goto "$DESIGN#/$route" >/dev/null 2>&1
  settle pstyle || true
  capture pstyle "$HERE/shape.js" "$WORK/p.raw"
  capture pstyle "$HERE/copy.js" "$p_copy"

  for side in a p; do
    sed -n "1,/^--- ids ---/p" "$WORK/$side.raw" | grep -v '^---' | sort -u > "$WORK/$side.shape"
    sed -n "/^--- ids ---/,\$p" "$WORK/$side.raw" | grep '^#' | sort -u > "$WORK/$side.ids"
  done

  printf '%-12s %10s %5s %5s\n' "/$route" \
    "$(comm -23 "$p_shape" "$a_shape" | wc -l | tr -d ' ')" \
    "$(comm -23 "$WORK/p.ids" "$WORK/a.ids" | wc -l | tr -d ' ')" \
    "$(comm -23 <(sort -u "$p_copy") <(sort -u "$a_copy") | wc -l | tr -d ' ')"

  # A count says a route is worth looking at; it never says what to do. DETAIL
  # prints the lines, which is the difference between a score and a finding.
  if [ -n "${DETAIL:-}" ]; then
    comm -23 "$p_shape" "$a_shape" | sed 's/^/      shape  /'
    comm -23 "$WORK/p.ids" "$WORK/a.ids" | sed 's/^/      id     /'
    comm -23 <(sort -u "$p_copy") <(sort -u "$a_copy") | cut -c1-96 | sed 's/^/      copy   /'
  fi
done
