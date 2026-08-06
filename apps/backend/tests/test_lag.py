"""Lag mining: ordered timing without a claim of cause."""

from datetime import date, timedelta
from uuid import UUID, uuid4

from tlon import lag
from tlon.graph.schema import NodeKind
from tlon.lag import MIN_MATCHES, describe, mine
from tlon.patterns import Candidate, MinedPattern

START = date(2026, 1, 5)
MATCH_DAYS = (0, 8, 17, 27)


class Journal:
    def __init__(self) -> None:
        self.candidates: list[Candidate] = []
        self.observed_days: set[date] = set()
        self._nodes: dict[tuple[NodeKind, str], UUID] = {}

    def write(
        self,
        day: int,
        kind: NodeKind,
        label: str,
        confidence: float = 0.8,
        zoned: bool = False,
    ) -> None:
        observed_on = START + timedelta(days=day)
        self.observed_days.add(observed_on)
        self.candidates.append(
            Candidate(
                node_id=self._nodes.setdefault((kind, label), uuid4()),
                kind=kind,
                label=label,
                confidence=confidence,
                observation_id=uuid4(),
                observed_on=observed_on,
                zoned=zoned,
            )
        )

    def blank(self, *days: int) -> None:
        self.observed_days.update(START + timedelta(days=day) for day in days)


def test_repeated_one_day_order_is_found():
    journal = Journal()
    for day in MATCH_DAYS:
        journal.write(day, NodeKind.ACTIVITY, "sleeping badly")
        journal.write(day + 1, NodeKind.EMOTION, "foggy")
    journal.blank(*range(32))

    findings = mine(journal.candidates, journal.observed_days)

    assert len(findings) == 1
    assert findings[0].source_label == "sleeping badly"
    assert findings[0].target_label == "foggy"
    assert findings[0].lag_days == 1
    assert findings[0].matches == 4


def test_fewer_than_four_matches_is_not_reported():
    journal = Journal()
    for day in (0, 8, 16):
        journal.write(day, NodeKind.ACTIVITY, "sleeping badly")
        journal.write(day + 1, NodeKind.EMOTION, "foggy")
    journal.blank(*range(24))

    assert MIN_MATCHES == 4
    assert mine(journal.candidates, journal.observed_days) == []


def test_missing_comparison_day_is_unknown_not_negative():
    journal = Journal()
    for day in MATCH_DAYS:
        journal.write(day, NodeKind.ACTIVITY, "sleeping badly")
        journal.write(day + 1, NodeKind.EMOTION, "foggy")
    journal.write(40, NodeKind.ACTIVITY, "sleeping badly")
    journal.blank(*range(32))

    findings = mine(journal.candidates, journal.observed_days)

    assert findings[0].matches == 4
    assert findings[0].precision == 1.0


def test_same_weekly_schedule_is_not_mistaken_for_precedence():
    journal = Journal()
    for day in (0, 7, 14, 21):
        journal.write(day, NodeKind.ACTIVITY, "late shift")
        journal.write(day + 1, NodeKind.EMOTION, "drained")
    journal.blank(*range(30))

    assert mine(journal.candidates, journal.observed_days) == []


def test_frequent_bystander_with_many_raw_matches_is_not_reported():
    journal = Journal()
    for day in range(24):
        journal.write(day, NodeKind.ACTIVITY, "work")
    for day in range(1, 24, 2):
        journal.write(day, NodeKind.EMOTION, "coffee")
    journal.blank(*range(25))

    assert mine(journal.candidates, journal.observed_days) == []


def test_same_day_pair_belongs_to_cooccurrence_not_lag():
    journal = Journal()
    for day in (0, 8, 16, 24):
        journal.write(day, NodeKind.ACTIVITY, "meeting")
        journal.write(day, NodeKind.EMOTION, "tense")
    journal.blank(*range(30))

    assert mine(journal.candidates, journal.observed_days) == []


def test_fixed_interval_phase_is_not_mistaken_for_precedence():
    journal = Journal()
    for day in (0, 8, 16, 24):
        journal.write(day, NodeKind.ACTIVITY, "night shift")
        journal.write(day + 1, NodeKind.EMOTION, "drained")
    journal.blank(*range(32))

    assert mine(journal.candidates, journal.observed_days) == []


def test_strong_same_day_pair_is_left_to_cooccurrence():
    journal = Journal()
    for day in (0, 6, 13, 21, 30):
        journal.write(day, NodeKind.EMOTION, "dread")
        journal.write(day, NodeKind.PLACE, "the office")
    # The next shared occurrence also creates four apparent one-cycle-ahead
    # matches. They are not evidence that dread precedes the office.
    journal.blank(*range(32))

    assert mine(journal.candidates, journal.observed_days) == []


def test_bidirectional_alternation_is_suppressed_as_ambiguous():
    journal = Journal()
    for day in range(31):
        label = "wired" if day % 2 == 0 else "tired"
        journal.write(day, NodeKind.EMOTION, label)

    assert mine(journal.candidates, journal.observed_days) == []


def test_weak_inputs_are_not_laundered_by_repetition():
    journal = Journal()
    for day in MATCH_DAYS:
        journal.write(day, NodeKind.ACTIVITY, "sleeping badly", confidence=0.2)
        journal.write(day + 1, NodeKind.EMOTION, "foggy")
    journal.blank(*range(32))

    assert mine(journal.candidates, journal.observed_days) == []


def test_description_states_order_without_cause():
    journal = Journal()
    for day in MATCH_DAYS:
        journal.write(day, NodeKind.ACTIVITY, "sleeping badly")
        journal.write(day + 1, NodeKind.EMOTION, "foggy")
    journal.blank(*range(32))

    text = describe(mine(journal.candidates, journal.observed_days)[0]).lower()

    assert text == "sleeping badly came up 1 day before foggy · 4 of 4 times (utc)"
    for causal_word in ("because", "cause", "trigger", "leads to", "makes", "due to"):
        assert causal_word not in text


def test_the_utc_hedge_goes_away_once_both_sides_know_their_timezone():
    journal = Journal()
    for day in MATCH_DAYS:
        journal.write(day, NodeKind.ACTIVITY, "sleeping badly", zoned=True)
        journal.write(day + 1, NodeKind.EMOTION, "foggy", zoned=True)
    journal.blank(*range(32))

    text = describe(mine(journal.candidates, journal.observed_days)[0])

    assert text == "sleeping badly came up 1 day before foggy · 4 of 4 times"


def test_an_unzoned_side_keeps_the_hedge():
    # A gap is only as local as its vaguer end: if either thing was written
    # before the app recorded a zone, the day count is still the server's.
    journal = Journal()
    for day in MATCH_DAYS:
        journal.write(day, NodeKind.ACTIVITY, "sleeping badly", zoned=True)
        journal.write(day + 1, NodeKind.EMOTION, "foggy")
    journal.blank(*range(32))

    text = describe(mine(journal.candidates, journal.observed_days)[0])

    assert text.endswith("· 4 of 4 times (UTC)")


def test_to_pattern_preserves_lag_claim_and_pair_count():
    journal = Journal()
    for day in MATCH_DAYS:
        journal.write(day, NodeKind.ACTIVITY, "sleeping badly")
        journal.write(day + 1, NodeKind.EMOTION, "foggy")
    journal.blank(*range(32))
    finding = mine(journal.candidates, journal.observed_days)[0]

    pattern = lag.to_pattern(finding)

    assert isinstance(pattern, MinedPattern)
    assert pattern.kind is NodeKind.PATTERN
    assert pattern.label == describe(finding)
    assert pattern.key == finding.key
    assert pattern.occurrences == finding.matches == 4
    assert len(pattern.observation_ids) == 8
    assert set(pattern.observation_ids) == {
        candidate.observation_id for candidate in journal.candidates
    }
    assert set(pattern.node_ids) == {finding.source_node_id, finding.target_node_id}
    assert pattern.distinct_days == 4
    assert pattern.confidence == finding.confidence
