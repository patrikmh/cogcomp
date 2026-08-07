"""Does the app's arithmetic match the diary that was written?

Every entry was written at a known local time. This recomputes what each day and
each week should hold, in Europe/Stockholm, and asks the app for the same. A
mismatch here is a date bug — the class that files an entry under the wrong day
and quietly corrupts every count above it.
"""

import json
import subprocess
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

BASE = "http://localhost:8080"
TZ = ZoneInfo("Europe/Stockholm")


def get(path: str, token: str):
    out = subprocess.run(
        ["curl", "-s", f"{BASE}{path}", "-H", f"Authorization: Bearer {token}"],
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(out) if out.strip() else None


def main() -> None:
    token = sys.argv[1]
    # Every entry on the record, filed by the local day it happened on. Taken
    # from the record rather than from the script that wrote it: the invariant
    # worth checking is that the app agrees with itself about what a day is,
    # and a fixture that only knows its own entries goes stale the moment
    # anything else writes one.
    written = (get("/v1/observations?limit=500", token) or {}).get("observations", [])
    expected: Counter = Counter()
    for entry in written:
        when = datetime.fromisoformat(entry["captured_at"].replace("Z", "+00:00"))
        expected[when.astimezone(TZ).date().isoformat()] += 1

    print(f"wrote {sum(expected.values())} entries over {len(expected)} local days\n")

    mismatches = 0
    for day in sorted(expected):
        got = get(f"/v1/summary/{day}?tz=Europe/Stockholm", token) or {}
        count = got.get("entry_count", 0)
        mark = "  " if count == expected[day] else "!!"
        if count != expected[day]:
            mismatches += 1
        print(f"{mark} {day}  wrote {expected[day]}  app says {count}")

    # And the weeks above them.
    print()
    weeks: Counter = Counter()
    for day, n in expected.items():
        d = datetime.fromisoformat(day).date()
        weeks[(d - timedelta(days=d.weekday())).isoformat()] += n
    for monday in sorted(weeks):
        got = get(f"/v1/summary/week/{monday}?tz=Europe/Stockholm", token) or {}
        count = got.get("entry_count", 0)
        active = got.get("active_days", 0)
        days_in_week = sum(1 for d in expected if _monday(d) == monday)
        ok = count == weeks[monday] and active == days_in_week
        print(
            f"{'  ' if ok else '!!'} week of {monday}  wrote {weeks[monday]} over "
            f"{days_in_week} days  app says {count} over {active}"
        )
        if not ok:
            mismatches += 1

    print(f"\n{'ARITHMETIC HOLDS' if mismatches == 0 else f'{mismatches} MISMATCHES'}")


def _monday(day: str) -> str:
    d = datetime.fromisoformat(day).date()
    return (d - timedelta(days=d.weekday())).isoformat()


if __name__ == "__main__":
    main()
