"""Co-occurrence mining. Pure logic, no database.

The first detector that claims something a person could not have counted
themselves, so most of these tests are about the ways that claim could be wrong:
a ratio computed from too little, a pair that is common rather than associated,
and any hint of cause in what it emits.
"""

from datetime import date, timedelta
from uuid import UUID, uuid4

from tlon.cooccurrence import (
    MIN_LIFT,
    MIN_PAIR_OBSERVATIONS,
    CoOccurrence,
    describe,
    mine,
)
from tlon.graph.schema import NodeKind
from tlon.patterns import Candidate

START = date(2026, 3, 1)


class Entries:
    """A small corpus, written one entry at a time.

    Co-occurrence is a statement about entries rather than about labels, so the
    tests read better if the fixture is shaped like entries too.
    """

    def __init__(self) -> None:
        self.candidates: list[Candidate] = []
        self._day = 0
        self._nodes: dict[tuple[str, str], UUID] = {}

    def entry(self, *labels: str, day: int | None = None, confidence: float = 0.8) -> UUID:
        """One entry mentioning each label.

        A label is `Kind:text@confidence`; the kind defaults to Emotion and the
        confidence to the entry's, so most tests can just write `"dread"`.
        """
        observation_id = uuid4()
        offset = self._day if day is None else day
        self._day = offset + 1
        for label in labels:
            head, _, strength = label.partition("@")
            kind, _, text = head.rpartition(":")
            key = (kind or "Emotion", text)
            self.candidates.append(
                Candidate(
                    node_id=self._nodes.setdefault(key, uuid4()),
                    kind=NodeKind(key[0]),
                    label=text,
                    confidence=float(strength) if strength else confidence,
                    observation_id=observation_id,
                    observed_on=START + timedelta(days=offset),
                )
            )
        return observation_id

    def filler(self, count: int, label: str = "nothing much") -> None:
        """Unrelated entries, so rates have a denominator to be measured against."""
        for _ in range(count):
            self.entry(label)


def pairs(entries: Entries) -> set[frozenset[str]]:
    return {frozenset((pair.a_label, pair.b_label)) for pair in mine(entries.candidates)}


class TestSupport:
    def test_one_shared_entry_is_not_an_association(self):
        entries = Entries()
        entries.entry("dread", "Person:my sister")
        entries.filler(20)
        assert mine(entries.candidates) == []

    def test_two_shared_entries_are_not_an_association(self):
        # Two is where lift starts producing enormous, meaningless ratios.
        entries = Entries()
        for _ in range(2):
            entries.entry("dread", "Person:my sister")
        entries.filler(20)
        assert mine(entries.candidates) == []

    def test_the_support_floor_is_what_the_constant_says(self):
        entries = Entries()
        for _ in range(MIN_PAIR_OBSERVATIONS):
            entries.entry("dread", "Person:my sister")
        entries.filler(20)
        assert len(mine(entries.candidates)) == 1

    def test_repetition_within_one_day_is_not_an_association(self):
        entries = Entries()
        for _ in range(5):
            entries.entry("dread", "Person:my sister", day=0)
        entries.filler(20)
        assert mine(entries.candidates) == []

    def test_an_empty_corpus_claims_nothing(self):
        assert mine([]) == []


class TestLift:
    def test_things_that_travel_together_are_found(self):
        entries = Entries()
        for _ in range(4):
            entries.entry("dread", "Person:my sister")
        entries.filler(15)
        assert pairs(entries) == {frozenset(("dread", "my sister"))}

    def test_two_common_things_sharing_entries_by_chance_are_not(self):
        # Both in most entries, so they share constantly and mean nothing by it.
        # Counting raw co-occurrence would rank this pair top; lift discards it.
        entries = Entries()
        for _ in range(20):
            entries.entry("tired", "Activity:work")
        for _ in range(2):
            entries.entry("tired")
            entries.entry("Activity:work")
        assert mine(entries.candidates) == []

    def test_the_reported_lift_is_the_measured_ratio(self):
        entries = Entries()
        for _ in range(3):
            entries.entry("dread", "Person:my sister")
        entries.filler(21)
        # 24 entries; both labels appear in exactly the 3 shared ones.
        # (3 * 24) / (3 * 3) = 8.
        assert mine(entries.candidates)[0].lift == 8.0

    def test_a_weak_association_is_not_reported(self):
        pair = mine(_barely_associated().candidates)
        assert pair == [] or pair[0].lift >= MIN_LIFT


def _barely_associated() -> Entries:
    """Two frequent labels overlapping about as often as chance predicts."""
    entries = Entries()
    for _ in range(6):
        entries.entry("dread", "Person:my sister")
    for _ in range(6):
        entries.entry("dread")
    for _ in range(6):
        entries.entry("Person:my sister")
    return entries


class TestWhatItRefusesToSay:
    def test_it_does_not_pair_a_thing_with_itself(self):
        entries = Entries()
        for _ in range(5):
            entries.entry("dread")
        assert mine(entries.candidates) == []

    def test_unpatternable_kinds_are_left_out(self):
        # Thoughts and Events are excluded from recurrence for reasons that apply
        # just as much here: a Thought repeating verbatim is a phrasing
        # coincidence, and an Event happens once.
        entries = Entries()
        for _ in range(5):
            entries.entry("Thought:I should call her", "Event:the argument")
        entries.filler(20)
        assert mine(entries.candidates) == []

    def test_weak_evidence_is_not_laundered_by_association(self):
        entries = Entries()
        for _ in range(5):
            entries.entry("dread", "Person:my sister", confidence=0.2)
        entries.filler(20)
        assert mine(entries.candidates) == []

    def test_confidence_never_exceeds_the_weaker_side(self):
        # An association is only as good as the shakier of the two readings under
        # it. Pairing a confident label with a tentative one does not produce a
        # confident finding, however often the pair turns up.
        entries = Entries()
        for _ in range(4):
            entries.entry("dread@0.9", "Person:my sister@0.5")
        entries.filler(15)
        assert mine(entries.candidates)[0].confidence == 0.5


class TestDormancy:
    def test_an_association_that_stopped_is_withdrawn(self):
        entries = Entries()
        for day in range(4):
            entries.entry("dread", "Person:my sister", day=day)
        for day in range(80, 84):
            entries.entry("Activity:running", "Place:the park", day=day)
        assert pairs(entries) == {frozenset(("running", "the park"))}

    def test_recency_is_dated_from_the_last_entry_not_today(self):
        entries = Entries()
        for day in range(4):
            entries.entry("dread", "Person:my sister", day=day)
        entries.filler(20)
        assert len(mine(entries.candidates)) == 1


class TestIdentity:
    def test_a_pair_has_one_key_regardless_of_order(self):
        left, right = uuid4(), uuid4()
        forwards = CoOccurrence(left, right, "a", "b", 0.8, (), 3.0, 2)
        backwards = CoOccurrence(right, left, "b", "a", 0.8, (), 3.0, 2)
        assert forwards.key == backwards.key


class TestDescribe:
    def test_it_states_the_count_and_the_ratio(self):
        entries = Entries()
        for _ in range(3):
            entries.entry("dread", "Person:my sister")
        entries.filler(21)
        text = describe(mine(entries.candidates)[0])
        assert "3 entries" in text
        assert "8.0×" in text

    def test_it_never_reaches_for_cause(self):
        entries = Entries()
        for _ in range(4):
            entries.entry("dread", "Person:my sister")
        entries.filler(20)
        text = describe(mine(entries.candidates)[0]).lower()
        for word in ("because", "cause", "trigger", "makes", "leads to", "due to"):
            assert word not in text
