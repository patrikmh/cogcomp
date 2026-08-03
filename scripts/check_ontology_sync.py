#!/usr/bin/env python3
"""Verify the four definitions of graph schema v0.1 agree.

The ontology necessarily exists in four places, each doing a job the others cannot:

  migrations/*.sql             enforces it (CHECK constraints — the real backstop)
  tlon/graph/schema.py          the backend's enums
  packages/ontology/schema.json the language-neutral record
  packages/ontology/index.ts    the mobile app's types

Code generation could collapse these, but the SQL has to be hand-written to be
reviewable as a constraint, so a drift check is the honest alternative. Drift here is
silent and dangerous: a kind that exists in Python but not in SQL fails only at write
time, in production, on a real journal entry.

Exits non-zero on any disagreement.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "apps" / "backend" / "migrations"
PY = ROOT / "apps" / "backend" / "tlon" / "graph" / "schema.py"
JSON_FILE = ROOT / "packages" / "ontology" / "schema.json"
INFERENCE = ROOT / "apps" / "backend" / "tlon" / "domain" / "inference.py"
TS = ROOT / "packages" / "ontology" / "index.ts"

#: Vocabulary that must not appear anywhere. Tlön never diagnoses, and the cheapest
#: way to keep that true is to check that the words are simply absent.
FORBIDDEN = ["Disorder", "Symptom", "Diagnosis", "ScreeningScore", "Severity"]


def fail(message: str) -> None:
    print(f"  ✗ {message}")
    problems.append(message)


problems: list[str] = []


def sql_check_values(constraint: str) -> set[str]:
    """Pull the quoted values out of the *current* `CHECK (col IN (...))`.

    Every migration is scanned in order and the last definition wins, because a
    constraint can be dropped and re-added by a later migration and it is the
    latest one the database is actually enforcing. Reading only `0001_init.sql`
    was right while the vocabulary was closed; once a kind could be added later,
    it would have compared the code against a constraint that no longer existed
    and reported agreement that was not true.
    """
    found: set[str] | None = None
    for path in sorted(MIGRATIONS.glob("*.sql")):
        for match in re.finditer(
            rf"CONSTRAINT\s+{constraint}\s+CHECK\s*\((.*?)\)\s*(?:,|\n?\s*\)\s*;|\n\s*\))",
            path.read_text(),
            re.DOTALL,
        ):
            found = set(re.findall(r"'([A-Z_a-z]+)'", match.group(1)))

    if found is None:
        fail(f"could not find constraint {constraint} in any migration")
        return set()
    return found


def python_enum_values(name: str, path: Path = PY) -> set[str]:
    text = path.read_text()
    match = re.search(rf"class {name}\(StrEnum\):(.*?)(?=\n\nclass |\n\n#|\Z)", text, re.DOTALL)
    if not match:
        fail(f"could not find enum {name} in {path.name}")
        return set()
    return set(re.findall(r'=\s*"([A-Za-z_]+)"', match.group(1)))


def ts_const_values(name: str) -> set[str]:
    text = TS.read_text()
    match = re.search(rf"export const {name} = \[(.*?)\] as const;", text, re.DOTALL)
    if not match:
        fail(f"could not find const {name} in {TS.name}")
        return set()
    return set(re.findall(r'"([A-Z_a-z]+)"', match.group(1)))


def compare(label: str, sources: dict[str, set[str]]) -> None:
    print(f"\n{label}")
    reference_name, reference = next(iter(sources.items()))
    for name, values in sources.items():
        if values == reference:
            print(f"  ✓ {name}: {len(values)} kinds")
            continue
        missing = reference - values
        extra = values - reference
        detail = []
        if missing:
            detail.append(f"missing {sorted(missing)}")
        if extra:
            detail.append(f"unexpected {sorted(extra)}")
        fail(f"{label}: {name} disagrees with {reference_name} — {'; '.join(detail)}")


def main() -> int:
    ontology = json.loads(JSON_FILE.read_text())

    json_nodes = set(ontology["observedNodeKinds"]) | set(ontology["inferredNodeKinds"])
    json_edges = set(ontology["edgeKinds"])

    compare(
        "Node kinds",
        {
            "schema.json": json_nodes,
            "migrations": sql_check_values("graph_nodes_kind_known"),
            "schema.py": python_enum_values("NodeKind"),
            "index.ts": ts_const_values("OBSERVED_NODE_KINDS")
            | ts_const_values("INFERRED_NODE_KINDS"),
        },
    )

    compare(
        "Edge kinds",
        {
            "schema.json": json_edges,
            "migrations": sql_check_values("graph_edges_kind_known"),
            "schema.py": python_enum_values("EdgeKind"),
            "index.ts": ts_const_values("EDGE_KINDS"),
        },
    )

    compare(
        "Epistemic statuses",
        {
            "schema.json": set(ontology["epistemicStatus"]),
            "migrations": sql_check_values("graph_nodes_epistemic_status_known"),
            # EpistemicStatus is a domain concept, not a graph-schema one, so it
            # lives in inference.py rather than graph/schema.py.
            "inference.py": python_enum_values("EpistemicStatus", INFERENCE),
            "index.ts": ts_const_values("EPISTEMIC_STATUSES"),
        },
    )

    print("\nDiagnostic vocabulary is absent")
    for path in (*sorted(MIGRATIONS.glob("*.sql")), PY, JSON_FILE, TS):
        text = path.read_text()
        for word in FORBIDDEN:
            # schema.json lists them under `forbidden` on purpose — that is a
            # denylist, not a usable kind.
            if path is JSON_FILE and word in json.dumps(
                json.loads(text).get("forbidden", {})
            ):
                continue
            if re.search(rf'["\']{word}["\']', text):
                fail(f"{path.name} contains the diagnostic term {word!r}")
        print(f"  ✓ {path.name}")

    print("\nConfidence threshold agrees")
    ts_threshold = re.search(r"TENTATIVE_CONFIDENCE_THRESHOLD = ([\d.]+)", TS.read_text())
    py_threshold = re.search(
        r"TENTATIVE_THRESHOLD = ([\d.]+)",
        INFERENCE.read_text(),
    )
    json_threshold = ontology["confidence"]["tentativeBelow"]
    values = {
        "index.ts": float(ts_threshold.group(1)) if ts_threshold else None,
        "inference.py": float(py_threshold.group(1)) if py_threshold else None,
        "schema.json": float(json_threshold),
    }
    if len(set(values.values())) != 1:
        fail(f"tentative threshold differs across definitions: {values}")
    else:
        print(f"  ✓ all agree on {json_threshold}")

    if problems:
        print(f"\n{len(problems)} problem(s) found.")
        return 1

    print("\nAll ontology definitions agree.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
