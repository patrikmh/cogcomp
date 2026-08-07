"""Three more weeks of the same person, so the detectors have enough to speak.

Five of the six detectors need three to four distinct weeks before they will
claim anything — periodicity wants four, lag and same-day want three, the
stated-against-recorded one wants ten observed days. On a fortnight they can
only abstain, which is correct and also invisible: the screen says nothing came
back often enough, and never that most of it needs about a month.

This extends the diary backwards to five weeks so the question can actually be
put to them. Same person, same three threads, and — as a real diary would —
some phrases repeat verbatim while others say the same thing differently.
"""

import json
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone

BASE = "http://localhost:8080"
TZ = "Europe/Stockholm"

# Weeks three, four and five, counted back from today.
ENTRIES = [
    (34, 8, 10, "Slept badly. The sums again, and no answer at the end of them."),
    (34, 18, 50, "Said no to the pub. I do not have a reason that would sound like one."),
    (33, 9, 30, "Walked the long way to the shop to avoid the market."),
    (32, 7, 50, "Woke before the alarm. Made coffee and sat with it before opening anything."),
    (32, 21, 5, "Ida asked about the clinic appointment. I said I would look at the dates."),
    (31, 12, 10, "Ate lunch at my desk rather than the canteen."),
    (30, 22, 30, "Opened the banking app and closed it again without looking at the balance."),
    (29, 17, 40, "Took the stairs to avoid the lobby at five."),
    (28, 8, 5, "Slept badly. Woke doing the arithmetic about the flat."),
    (27, 19, 20, "Cancelled the dinner. Too many people."),
    (27, 9, 0, "Woke before the alarm. Sat with the coffee before opening anything."),
    (26, 13, 15, "Skipped the team lunch. Said I had a call."),
    (25, 21, 45, "Ida's sister sent a photo of the baby. I looked at it for a long time."),
    (24, 8, 20, "Slept badly again. Same sums."),
    (23, 18, 10, "Went to the shop at closing time so it would be empty."),
    (22, 9, 45, "Walked the long way to the shop to avoid the market."),
    (21, 22, 15, "Looked at the salary line and closed the laptop."),
    (20, 7, 40, "Woke before the alarm. Made coffee and sat with it before opening anything."),
    (20, 20, 0, "Said no to the pub. Second time this month."),
    (19, 12, 30, "Ate lunch at my desk rather than the canteen."),
    (18, 21, 30, "Ida asked when we are going to start trying. I said soon."),
    (17, 8, 15, "Slept badly. The arithmetic about the flat and the child at once."),
    (16, 17, 55, "Took the stairs to avoid the lobby at five."),
    (15, 9, 10, "Woke before the alarm. Sat with the coffee."),
    (14, 19, 0, "Cancelled the dinner. Too many people."),
]


def call(method: str, path: str, token: str, body=None):
    cmd = ["curl", "-s", "-X", method, f"{BASE}{path}", "-H", f"Authorization: Bearer {token}"]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    try:
        return json.loads(out) if out.strip() else None
    except json.JSONDecodeError:
        return None


def main() -> None:
    token = sys.argv[1]
    now = datetime.now(timezone.utc)
    written = 0
    for days_ago, hour, minute, text in ENTRIES:
        when = (now - timedelta(days=days_ago)).replace(
            hour=hour, minute=minute, second=0, microsecond=0
        )
        entry_id = str(uuid.uuid4())
        made = call(
            "POST",
            "/v1/observations",
            token,
            {
                "id": entry_id,
                "content": text,
                "captured_at": when.isoformat().replace("+00:00", "Z"),
                "timezone": TZ,
                "source": "text",
            },
        )
        if not made or "id" not in made:
            print("failed:", text[:40])
            continue
        written += 1
        call("POST", f"/v1/observations/{entry_id}/extract", token)
    print(f"{written} more entries written and extracted")


if __name__ == "__main__":
    main()
