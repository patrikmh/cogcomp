"""Three threads went in. Which of them come out, and on which screen?

The fortnight was written to carry exactly three: keeping away from crowds,
refusing to look at money, and fear about having a child. This asks each layer
of the app, in turn, whether it can see them — because "does it work" is not the
question. The question is whether a person who lived this fortnight would
recognise themselves in what they are shown.
"""

import json
import re
import subprocess
import sys

BASE = "http://localhost:8080"

THREADS = {
    "keeping away from people": (
        "people",
        "crowd",
        "quiet",
        "alone",
        "apart",
        "gathering",
        "stairs",
        "empty",
        "closing time",
        "canteen",
        "desk",
        "kitchen",
        "pub",
        "dinner",
        "market",
        "lobby",
        "talk",
        "party",
        "invitation",
    ),
    "not looking at money": (
        "money",
        "bank",
        "salary",
        "afford",
        "number",
        "sums",
        "arithmetic",
        "cost",
        "flat",
        "balance",
    ),
    "frightened about a child": (
        "child",
        "kid",
        "baby",
        "trying",
        "fertility",
        "clinic",
        "pregnan",
        "father",
        "parent",
    ),
}


def get(path: str, token: str):
    out = subprocess.run(
        ["curl", "-s", f"{BASE}{path}", "-H", f"Authorization: Bearer {token}"],
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(out) if out.strip() else None


def hits(texts, words) -> list[str]:
    # Whole words only. "gathering" contains "her", and the first version of
    # this counted every crowd reading as evidence of fear about a child.
    pattern = re.compile(r"\b(" + "|".join(words) + r")", re.I)
    return [t for t in texts if pattern.search(t)]


def main() -> None:
    token = sys.argv[1]

    nodes = (get("/v1/graph?limit=500", token) or {}).get("nodes", [])
    readings = [n["label"] for n in nodes if n["kind"] != "Observation"]
    patterns = [p["label"] for p in (get("/v1/patterns", token) or [])]
    offered = [
        c["label"] for c in (get("/v1/identity/candidates", token) or {}).get("candidates", [])
    ]
    vocab = get("/v1/vocabulary/2026-07-27?tz=Europe/Stockholm&weeks=3", token) or {}
    words = [w for week in vocab.get("weeks", []) for w in week.get("words", [])]
    themes = get("/v1/themes", token)
    themes = themes if isinstance(themes, list) else (themes or {}).get("themes", [])
    regions = [t["label"] for t in themes]

    layers = [
        ("readings drawn", readings),
        ("patterns found", patterns),
        ("identity offered", offered),
        ("your own words", words),
        ("regions formed", regions),
    ]

    for thread, wordlist in THREADS.items():
        print(f"\n── {thread}")
        for name, texts in layers:
            found = hits(texts, wordlist)
            mark = "yes" if found else "NO "
            print(f"   {mark}  {name:<18} {len(found):>3}   {found[0][:52] if found else ''}")


if __name__ == "__main__":
    main()
