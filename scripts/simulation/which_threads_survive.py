"""Three threads went in. Which of them come out, and on which screen?

Threads are traced through **provenance**, not through words. The first version
of this matched keywords against each reading's label and concluded that fear
about a child reached no screen at all. That was wrong, and wrong in a way worth
recording: the readings it could not find were `to be okay too`, `needing room
before answering the question`, `being straight with Ida rather than dodging`.
They never say "child" because a good reading abstracts away from the nouns of
the entry it came from — which is the app's whole virtue, and it defeated a
measurement built on string equality.

That is the same mistake the pattern layer makes. It is easy to make.

So: an entry belongs to a thread by its own words, and a reading belongs to
whatever threads its citing entries belong to.
"""

import json
import re
import subprocess
import sys

BASE = "http://localhost:8080"

THREADS = {
    "keeping away from people": r"\b(people|crowd|market|canteen|pub|dinner|lobby|stairs|team|thing at|party|empty|quiet|alone)",
    "not looking at money": r"\b(money|bank|salary|afford|sums|arithmetic|flat|balance|numbers?)",
    "frightened about a child": r"\b(child|baby|trying|fertility|clinic|kids?)",
}


def get(path: str, token: str):
    out = subprocess.run(
        ["curl", "-s", f"{BASE}{path}", "-H", f"Authorization: Bearer {token}"],
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(out) if out.strip() else None


def main() -> None:
    token = sys.argv[1]

    entries = (get("/v1/observations?limit=500", token) or {}).get("observations", [])
    belongs = {
        name: {e["id"] for e in entries if re.search(pattern, e["content"], re.I)}
        for name, pattern in THREADS.items()
    }

    nodes = [n for n in (get("/v1/graph?limit=600", token) or {})["nodes"] if n["kind"] != "Observation"]
    identity_kinds = {"Value", "Belief", "Need", "Activity"}
    offered = {c["id"] for c in (get("/v1/identity/candidates", token) or {}).get("candidates", [])}

    print(f"{len(entries)} entries, {len(nodes)} readings\n")
    print(f"{'thread':<28}{'entries':>8}{'readings':>10}{'identity':>10}")
    for name in THREADS:
        ids = belongs[name]
        drawn = []
        for node in nodes:
            explained = get(f"/v1/graph/nodes/{node['id']}/explain", token) or {}
            sources = {d["id"] for d in explained.get("derived_from", [])}
            if sources & ids:
                drawn.append(node)
        in_identity = [n for n in drawn if n["kind"] in identity_kinds and n["id"] in offered]
        print(f"{name:<28}{len(ids):>8}{len(drawn):>10}{len(in_identity):>10}")
        for n in in_identity[:4]:
            print(f"      {n['kind']:<9} {n['label'][:56]}")


if __name__ == "__main__":
    main()
