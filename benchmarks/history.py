"""A synthetic life, with known answers.

The replay benchmark needs something the extraction benchmark does not: ground
truth about *time*. Whether a pattern is correct is a matter of opinion, but
whether the system noticed a thread that ran for six weeks, how long it took, and
whether it kept changing its mind about it are not — provided we know what was
planted.

So this is not a corpus of realistic journal entries. It is a set of threads with
declared shapes, chosen because each one probes a different failure:

- **steady** — the easy case. If this is missed, nothing else matters.
- **lapsing** — runs, stops, and comes back. Tests whether a returning pattern is
  recognised as the same one rather than announced twice.
- **late** — starts halfway through. Tests that a pattern is found promptly once
  it exists, rather than being drowned by months of unrelated history.
- **sparse** — genuinely recurring but thin. Sits near the reporting threshold on
  purpose: this is where a detector either under-reports or starts inventing.
- **weekly** — only ever on the same weekday. Invisible to exact-label counting,
  which is the point: it is the ground truth for the periodicity detector that
  does not exist yet, and it should show up as a *missed* thread until it does.
- **noise** — mentioned once or twice, never a pattern. Any detector that reports
  these is manufacturing findings, which is the failure that matters most.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Thread:
    """One recurring thing, and the days it was written about."""

    label: str
    kind: str
    days: tuple[int, ...]
    #: What we expect the system to do with it. `True` means a detector should
    #: eventually report it; `False` means reporting it is a false positive.
    expected: bool
    #: Why this thread is in the corpus, so a failure report can say what broke.
    probes: str
    #: Confidence of each inference. Low values are how a thread stays real but
    #: unreportable — recurrence must not launder weak evidence into a claim.
    confidence: float = 0.8
    #: The label of another thread whose entry this one shares. Threads otherwise
    #: get an entry each, which means they never co-occur — associations only
    #: exist where two things are written in the same breath, so testing for them
    #: requires saying so explicitly.
    shares_entry_with: str | None = None


HORIZON_DAYS = 120


def _weekdays(start: int, end: int, weekday: int) -> tuple[int, ...]:
    """Every day in the range falling on one weekday. Day 0 is a Monday."""
    return tuple(day for day in range(start, end) if day % 7 == weekday)


THREADS: tuple[Thread, ...] = (
    Thread(
        label="dread",
        kind="Emotion",
        days=tuple(range(0, HORIZON_DAYS, 3)),
        expected=True,
        probes="steady: the baseline. Missing this means the detector is broken.",
    ),
    Thread(
        label="sunday scaries",
        kind="Emotion",
        # Six weeks on, five weeks silent, then back.
        days=tuple(range(0, 42, 4)) + tuple(range(77, HORIZON_DAYS, 4)),
        expected=True,
        probes="lapsing: must return as the same pattern, not a second discovery.",
    ),
    Thread(
        label="running",
        kind="Activity",
        days=tuple(range(60, HORIZON_DAYS, 2)),
        expected=True,
        probes="late: must be found soon after it starts, not diluted by history.",
    ),
    Thread(
        label="my sister",
        kind="Person",
        days=(5, 31, 58, 96),
        expected=True,
        probes="sparse: real but thin. Under-reporting here is safer than over.",
    ),
    Thread(
        label="drained",
        kind="Emotion",
        days=_weekdays(0, HORIZON_DAYS, 3),
        expected=True,
        probes="weekly: only ever a Thursday. Exact-label counting cannot see the "
        "shape, only the recurrence — the periodicity detector is what this is for.",
    ),
    Thread(
        label="the dentist",
        kind="Event",
        days=(12, 44),
        expected=False,
        probes="noise: twice is a coincidence. Reporting it cheapens the word pattern.",
    ),
    Thread(
        label="unsure",
        kind="Emotion",
        days=(3, 17, 29, 51, 88),
        expected=False,
        confidence=0.2,
        probes="weak evidence, often. Recurrence must not launder low confidence "
        "into a claim the person is asked to take seriously.",
    ),
    Thread(
        label="the corner shop",
        kind="Place",
        days=(9,),
        expected=False,
        probes="mentioned once. Nothing to say about it.",
    ),
    # ---- Association ground truth. -------------------------------------------
    # These exist to be found *as pairs*; whether they are also recurrences on
    # their own is beside the point.
    Thread(
        label="the office",
        kind="Place",
        # In four of every five entries where dread appears, and nowhere else.
        # A person writing these would have no way of noticing the ratio.
        days=tuple(day for i, day in enumerate(range(0, HORIZON_DAYS, 3)) if i % 5),
        expected=True,
        shares_entry_with="dread",
        probes="genuine association: written in the same breath as dread far more "
        "often than either rate alone predicts. The whole reason this detector "
        "exists — nobody tracks this about themselves.",
    ),
    Thread(
        label="coffee",
        kind="Activity",
        # Written about constantly, and sometimes alongside dread. Common, not
        # associated: raw co-occurrence counting would rank this pair near the
        # top, and lift is what throws it out.
        days=tuple(range(0, HORIZON_DAYS, 2)),
        # A real recurrence in its own right — written about every other day for
        # four months — so the pattern detector is right to report it. It is the
        # *pair* with dread that must not be claimed. The two ground truths are
        # separate on purpose: a thread can be a true pattern and a false
        # association at the same time, and conflating them would let a detector
        # pass by being wrong in the other one's direction.
        expected=True,
        shares_entry_with="dread",
        probes="frequent bystander: shares entries with dread often, but only as "
        "often as its own rate predicts. Pairing them would mean the detector is "
        "counting rather than measuring.",
    ),
)

#: Pairs that must be reported, keyed by the two labels.
EXPECTED_PAIRS: frozenset[frozenset[str]] = frozenset(
    {frozenset({"dread", "the office"})}
)

#: Pairs that must never be reported.
FORBIDDEN_PAIRS: frozenset[frozenset[str]] = frozenset({frozenset({"dread", "coffee"})})

#: Threads a detector is supposed to find, keyed the way patterns key themselves.
EXPECTED: dict[str, Thread] = {
    f"{thread.kind}:{thread.label}": thread for thread in THREADS if thread.expected
}

#: Threads that must never be reported.
FORBIDDEN: frozenset[str] = frozenset(
    f"{thread.kind}:{thread.label}" for thread in THREADS if not thread.expected
)


def entries_on(day: int) -> list[Thread]:
    """Everything written on one day of the synthetic history."""
    return [thread for thread in THREADS if day in thread.days]
