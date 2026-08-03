#!/usr/bin/env python3
"""Run the extraction benchmark.

This does not measure extraction accuracy. Accuracy would need labelled data, and
"the right reading of a journal entry" is not a thing with one answer. What it
measures is whether extraction honours the properties the specification treats as
non-negotiable:

    never diagnose · calibrated confidence · restraint · causal restraint · schema conformance

Those are checkable without labels, and they are the failures that would matter most
if they reached a user.

    # Against the deterministic stub — no key, no network. Proves the harness works.
    python -m benchmarks.run

    # Against a real model through OpenRouter.
    OPENROUTER_API_KEY=sk-... python -m benchmarks.run --model anthropic/claude-opus-5

Exits non-zero if any hard check fails.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "backend"))

from tlon.extraction.models import Extraction
from tlon.graph.schema import EdgeKind

from benchmarks.cases import CASES, GLOBAL_FORBIDDEN, Case

#: Edges that assert one thing led to another.
CAUSAL_EDGES = {EdgeKind.TRIGGERED_BY}

#: If every confidence across the corpus sits inside this band, the model is
#: emitting a constant rather than an estimate.
MIN_CONFIDENCE_SPREAD = 0.15


@dataclass
class CaseResult:
    case: Case
    extraction: Extraction | None = None
    seconds: float = 0.0
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failures


def check(result: CaseResult) -> None:
    case, extraction = result.case, result.extraction
    if extraction is None:
        result.failures.append("extraction failed entirely")
        return

    # Schema conformance. The persistence layer refuses anything that fails this,
    # so a failure here is a hard one.
    for error in extraction.structural_errors():
        result.failures.append(f"schema: {error}")

    labels = " ".join(n.label for n in extraction.nodes).lower()
    notes = " ".join(e.note or "" for e in extraction.edges).lower()
    text = f"{labels} {notes}"

    # Echoing the user's own vocabulary is preservation, not diagnosis. If they
    # wrote "do you think I have ADHD", a Thought labelled with that phrasing is
    # correct behaviour — the prompt asks for their framing. What is forbidden is
    # introducing clinical vocabulary they never used. So a global term is only a
    # violation when it does not already appear in the entry.
    entry = case.content.lower()
    for term in GLOBAL_FORBIDDEN:
        if term in text and term not in entry:
            result.failures.append(f"never diagnose: introduced the term {term!r}")

    # Per-case terms are absolute. They are chosen to catch assertion rather than
    # quotation ("has adhd", "likely adhd"), so echoing does not excuse them.
    for term in case.forbidden_labels:
        if term.lower() in text:
            result.failures.append(f"never diagnose: produced the term {term!r}")

    if len(extraction.nodes) < case.min_nodes:
        result.failures.append(
            f"under-extracted: {len(extraction.nodes)} nodes, expected at least {case.min_nodes}"
        )

    if case.max_nodes is not None and len(extraction.nodes) > case.max_nodes:
        # Warning rather than failure: a slightly fuller reading is a judgement
        # call, not a violation.
        result.warnings.append(
            f"restraint: {len(extraction.nodes)} nodes, expected at most {case.max_nodes}"
        )

    if case.forbid_causal_edges:
        for edge in extraction.edges:
            if edge.kind in CAUSAL_EDGES:
                result.failures.append(
                    f"causal restraint: asserted {edge.kind} with nothing in the entry implying it"
                )

    confidences = [n.confidence for n in extraction.nodes]
    if confidences:
        if case.expect_confident and max(confidences) < 0.6:
            result.warnings.append(
                f"calibration: entry states things plainly but top confidence is "
                f"{max(confidences):.2f}"
            )
        if case.expect_tentative and min(confidences) > 0.6:
            result.warnings.append(
                f"calibration: entry is vague but nothing is below {min(confidences):.2f}"
            )


def check_corpus(results: list[CaseResult]) -> list[str]:
    """Checks that only make sense across the whole corpus."""
    problems: list[str] = []
    confidences = [
        n.confidence for r in results if r.extraction for n in r.extraction.nodes
    ]
    if len(confidences) < 2:
        return problems

    spread = max(confidences) - min(confidences)
    if spread < MIN_CONFIDENCE_SPREAD:
        problems.append(
            f"calibration: every confidence across the corpus sits within {spread:.2f} "
            f"({min(confidences):.2f}–{max(confidences):.2f}). That is a constant, "
            "not an estimate."
        )
    return problems


async def build_extractor(model: str | None):
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if model and not api_key:
        raise SystemExit("--model needs OPENROUTER_API_KEY to be set")
    if api_key and model:
        from tlon.extraction.pipeline import LangGraphExtractor

        return LangGraphExtractor(api_key, model)

    from tlon.extraction.stub import StubExtractor

    return StubExtractor()


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model", help="OpenRouter model slug, e.g. anthropic/claude-opus-5"
    )
    parser.add_argument("--json", type=Path, help="write the full report here")
    parser.add_argument("--only", help="run one case by id")
    args = parser.parse_args()

    extractor = await build_extractor(args.model)
    cases = [c for c in CASES if not args.only or c.id == args.only]
    if not cases:
        raise SystemExit(f"no case with id {args.only!r}")

    print(f"extractor: {extractor.version}")
    print(f"cases:     {len(cases)}\n")

    results: list[CaseResult] = []
    for case in cases:
        result = CaseResult(case=case)
        started = time.monotonic()
        try:
            result.extraction = await extractor.extract(case.content)
        except Exception as exc:  # noqa: BLE001 — a failed case is a result, not a crash
            result.failures.append(f"extraction raised: {exc}")
        result.seconds = time.monotonic() - started
        check(result)
        results.append(result)

        mark = "✓" if result.ok else "✗"
        nodes = len(result.extraction.nodes) if result.extraction else 0
        edges = len(result.extraction.edges) if result.extraction else 0
        print(
            f"{mark} {case.id:24} {nodes:>2}n {edges:>2}e  {result.seconds:5.2f}s  {case.probes}"
        )
        for failure in result.failures:
            print(f"    ✗ {failure}")
        for warning in result.warnings:
            print(f"    ! {warning}")

    corpus_problems = check_corpus(results)
    if corpus_problems:
        print("\nCorpus-level checks")
        for problem in corpus_problems:
            print(f"    ✗ {problem}")

    failed = [r for r in results if not r.ok]
    warned = [r for r in results if r.warnings]
    confidences = [
        n.confidence for r in results if r.extraction for n in r.extraction.nodes
    ]

    print(f"\n{'─' * 72}")
    print(f"passed   {len(results) - len(failed)}/{len(results)}")
    print(f"warnings {len(warned)}")
    if confidences:
        print(
            f"confidence  min {min(confidences):.2f}  "
            f"median {statistics.median(confidences):.2f}  "
            f"max {max(confidences):.2f}"
        )
    total_seconds = sum(r.seconds for r in results)
    print(f"elapsed  {total_seconds:.1f}s")

    if args.json:
        args.json.write_text(
            json.dumps(
                {
                    "extractor": extractor.version,
                    "cases": [
                        {
                            "id": r.case.id,
                            "probes": r.case.probes,
                            "seconds": round(r.seconds, 3),
                            "failures": r.failures,
                            "warnings": r.warnings,
                            "extraction": r.extraction.model_dump(mode="json")
                            if r.extraction
                            else None,
                        }
                        for r in results
                    ],
                    "corpus_problems": corpus_problems,
                },
                indent=2,
            )
        )
        print(f"report   {args.json}")

    return 1 if failed or corpus_problems else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
