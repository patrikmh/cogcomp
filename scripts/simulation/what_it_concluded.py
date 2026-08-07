"""What the app concluded, laid out so a person can check it against the diary."""

import json
import subprocess
import sys
from collections import Counter

BASE = "http://localhost:8080"


def get(path: str, token: str):
    out = subprocess.run(
        ["curl", "-s", f"{BASE}{path}", "-H", f"Authorization: Bearer {token}"],
        capture_output=True,
        text=True,
    ).stdout
    try:
        return json.loads(out) if out.strip() else None
    except json.JSONDecodeError:
        return {"raw": out[:200]}


def main() -> None:
    token = sys.argv[1]

    print("=== PATTERNS")
    for p in get("/v1/patterns", token) or []:
        print(f"  [{p['detector']:<22}] {p['distinct_days']}/{p['occurrences']}  {p['label'][:66]}")

    print("\n=== READINGS, by kind")
    nodes = (get("/v1/graph?limit=400", token) or {}).get("nodes", [])
    kinds = Counter(n["kind"] for n in nodes)
    print("  " + ", ".join(f"{k} {v}" for k, v in kinds.most_common()))

    print("\n=== THE SUREST READINGS")
    inferred = [n for n in nodes if n["kind"] != "Observation"]
    for n in sorted(inferred, key=lambda n: -(n.get("confidence") or 0))[:16]:
        print(f"  {n.get('confidence', 0):.2f}  {n['kind']:<10} {n['label'][:60]}")

    print("\n=== IDENTITY, offered")
    for c in (get("/v1/identity/candidates", token) or {}).get("candidates", [])[:14]:
        print(f"  {c.get('confidence', 0):.2f}  {c['kind']:<10} {c['label'][:60]}")

    print("\n=== REGIONS")
    themes = get("/v1/themes", token)
    themes = themes if isinstance(themes, list) else (themes or {}).get("themes", [])
    for t in themes:
        print(f"  {t['member_count']} members: {t['label'][:70]}")
    if not themes:
        print("  (none)")


if __name__ == "__main__":
    main()
