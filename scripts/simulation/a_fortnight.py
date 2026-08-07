"""Two weeks of one person's journal, written as they would write it.

The point is not to trip the detectors. It is to write a fortnight that a
reader would summarise as *avoids crowds, will not look at money, frightened
about children* — and then ask whether the app arrives at the same reading from
the entries alone. Anything it finds that a person would not, or misses that a
person would not, is the finding.

Nothing here names the three threads. A journal that said "I am avoiding
crowds" would be testing the extractor's ability to copy a label.
"""

import json
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone

BASE = "http://localhost:8080"
TZ = "Europe/Stockholm"

# (days_ago, hour, minute, text)
ENTRIES = [
    # ---- week one
    (13, 8, 12, "Slept badly. Lay there doing the sums about the flat again until it got light."),
    (13, 19, 40, "Was going to go to Anna's thing but there were going to be twenty people so I said I was ill."),
    (12, 9, 5, "Walked the long way to the shop to avoid the market. Took twenty minutes longer and I did not mind."),
    (12, 22, 15, "Ida asked when we are going to start trying. I changed the subject and then felt bad about it for an hour."),
    (11, 7, 55, "Woke before the alarm. Made coffee and sat with it before opening anything."),
    (11, 18, 30, "Left the office before the standing meeting. Told myself it was because I had nothing to add."),
    (10, 21, 10, "Opened the banking app and closed it again without looking at the balance."),
    (10, 12, 0, "Ate lunch at my desk rather than the canteen. It is quieter and I do not have to talk."),
    (9, 20, 45, "Ida's sister brought the baby round. I held her and she was fine and I was not."),
    (8, 8, 30, "Cancelled the dinner. Six people is too many people right now."),
    (8, 23, 5, "Cannot stop thinking about whether we can afford a child and then refusing to actually work it out."),
    (7, 10, 20, "Ran along the water instead of the park because the park has the Sunday crowd."),
    # ---- week two
    (6, 8, 0, "Slept badly again. Same sums, same not-finishing them."),
    (6, 19, 15, "Said no to the pub. Third time this month. Nobody has asked why yet."),
    (5, 9, 40, "Walked to the far shop again. The quiet one."),
    (5, 21, 50, "Ida left the folder about the fertility clinic on the table. I put a magazine on top of it."),
    (4, 7, 45, "Woke before the alarm and sat with the coffee before opening anything."),
    (4, 13, 30, "Skipped the team lunch. Told them I had a call."),
    (3, 22, 40, "Looked at the salary line for about four seconds and then closed the laptop."),
    (3, 18, 0, "Took the stairs to avoid the lobby at five when everyone leaves at once."),
    (2, 20, 30, "Ida asked again, gently. I said soon. I do not know what I meant by it."),
    (2, 9, 15, "The cafe was full so I walked home with the coffee instead."),
    (1, 8, 5, "Slept badly. Woke up doing the arithmetic about the flat and the child at the same time."),
    (1, 17, 45, "Went to the shop at closing time so it would be empty."),
    (0, 9, 50, "Woke before the alarm. Sat with the coffee. Did not open the banking app."),
    (0, 21, 20, "Ida's friends came over. I stayed in the kitchen and did the washing up twice."),
]


def call(method: str, path: str, token: str, body=None):
    cmd = ["curl", "-s", "-X", method, f"{BASE}{path}", "-H", f"Authorization: Bearer {token}"]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    try:
        return json.loads(out) if out.strip() else None
    except json.JSONDecodeError:
        return {"raw": out[:200]}


def main() -> None:
    token = sys.argv[1]
    now = datetime.now(timezone.utc)
    written = 0
    for days_ago, hour, minute, text in ENTRIES:
        day = (now - timedelta(days=days_ago)).replace(
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
                "captured_at": day.isoformat().replace("+00:00", "Z"),
                "timezone": TZ,
                "source": "text",
            },
        )
        if not made or "id" not in made:
            print("FAILED to write:", text[:40], made)
            continue
        written += 1
        call("POST", f"/v1/observations/{entry_id}/extract", token)
        print(f"{days_ago:>3}d {hour:02d}:{minute:02d}  {text[:58]}")
    print(f"\n{written} of {len(ENTRIES)} entries written and extracted")


if __name__ == "__main__":
    main()
