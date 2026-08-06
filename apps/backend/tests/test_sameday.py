"""Within-day ordering. Pure logic, no database.

The finer the grain, the easier it is to mistake a writing habit for a sequence,
so most of these are about refusing: one sitting split in two, a pair that runs
both ways, a single busy fortnight.
"""

from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

from tlon.graph.schema import NodeKind
from tlon.patterns import Candidate
from tlon.sameday import MAX_RECALL_DELAY, MIN_MATCHES, describe, mine, to_pattern

START = date(2026, 3, 2)  # Monday


class Journal:
    def __init__(self) -> None:
        self.candidates: list[Candidate] = []
        self.observed_days: set[date] = set()
        self._nodes: dict[tuple[NodeKind, str], UUID] = {}

    def write(
        self,
        day: int,
        hour: float,
        kind: NodeKind,
        label: str,
        confidence: float = 0.8,
        zoned: bool = False,
        observation_id: UUID | None = None,
        recall_delay: timedelta | None = None,
    ) -> UUID:
        observed_on = START + timedelta(days=day)
        self.observed_days.add(observed_on)
        moment = datetime.combine(observed_on, datetime.min.time(), tzinfo=UTC) + timedelta(
            hours=hour
        )
        observation_id = observation_id or uuid4()
        self.candidates.append(
            Candidate(
                node_id=self._nodes.setdefault((kind, label), uuid4()),
                kind=kind,
                label=label,
                confidence=confidence,
                observation_id=observation_id,
                observed_on=observed_on,
                zoned=zoned,
                observed_at=moment,
                recall_delay=recall_delay,
            )
        )
        return observation_id


def mornings_and_evenings(days=(0, 7, 14, 21), gap=10.0, **kwargs) -> Journal:
    """Something at breakfast, something else after work, on the same days."""
    journal = Journal()
    for day in days:
        journal.write(day, 8.0, NodeKind.EMOTION, "wired", **kwargs)
        journal.write(day, 8.0 + gap, NodeKind.ACTIVITY, "skipping dinner", **kwargs)
    return journal


def _of(journal: Journal):
    return journal.candidates, journal.observed_days


class TestWhatCountsAsAWithinDayOrder:
    def test_a_repeated_morning_then_evening_pair_is_found(self):
        findings = mine(*_of(mornings_and_evenings()))

        assert len(findings) == 1
        assert findings[0].source_label == "wired"
        assert findings[0].target_label == "skipping dinner"
        assert findings[0].occasions == 4

    def test_three_days_are_not_enough(self):
        journal = mornings_and_evenings(days=tuple(range(MIN_MATCHES - 1)))

        assert mine(*_of(journal)) == []

    def test_one_intense_fortnight_is_not_a_rhythm(self):
        # Four matches, but inside two calendar weeks.
        journal = mornings_and_evenings(days=(0, 1, 8, 9))

        assert mine(*_of(journal)) == []

    def test_entries_from_one_sitting_are_not_a_sequence(self):
        # Two things written minutes apart are one thought being typed out, and
        # calling that an order would find a writing habit rather than a day.
        journal = mornings_and_evenings(gap=0.05)

        assert mine(*_of(journal)) == []

    def test_two_things_in_the_same_entry_are_not_ordered(self):
        # Simultaneous as far as this record knows. Co-occurrence already says it.
        journal = Journal()
        for day in (0, 7, 14, 21):
            shared = uuid4()
            journal.write(day, 8.0, NodeKind.EMOTION, "wired", observation_id=shared)
            journal.write(day, 8.0, NodeKind.ACTIVITY, "skipping dinner", observation_id=shared)

        assert mine(*_of(journal)) == []

    def test_a_pair_that_runs_both_ways_is_suppressed(self):
        journal = Journal()
        for day in (0, 7, 14, 21):
            journal.write(day, 8.0, NodeKind.EMOTION, "wired")
            journal.write(day, 18.0, NodeKind.ACTIVITY, "skipping dinner")
        for day in (28, 35, 42, 49):
            journal.write(day, 8.0, NodeKind.ACTIVITY, "skipping dinner")
            journal.write(day, 18.0, NodeKind.EMOTION, "wired")

        assert mine(*_of(journal)) == []

    def test_a_pair_that_shares_days_without_an_order_says_nothing(self):
        # Present together, ordered less than three times in four.
        journal = Journal()
        for day in (0, 7):
            journal.write(day, 8.0, NodeKind.EMOTION, "wired")
            journal.write(day, 18.0, NodeKind.ACTIVITY, "skipping dinner")
        for day in (14, 21):
            journal.write(day, 18.0, NodeKind.EMOTION, "wired")
            journal.write(day, 8.0, NodeKind.ACTIVITY, "skipping dinner")

        assert mine(*_of(journal)) == []

    def test_a_day_written_up_a_week_later_is_not_evidence_of_its_shape(self):
        # The order of two moments is exactly what recall distorts — accounts
        # written after the fact are pulled toward peaks and endings. The day
        # still counts everywhere else; only its *hours* are refused here.
        journal = mornings_and_evenings(recall_delay=MAX_RECALL_DELAY + timedelta(hours=1))

        assert mine(*_of(journal)) == []

    def test_writing_the_morning_up_at_lunchtime_still_counts(self):
        journal = mornings_and_evenings(recall_delay=MAX_RECALL_DELAY - timedelta(hours=1))

        assert len(mine(*_of(journal))) == 1

    def test_an_entry_with_no_recorded_delay_is_taken_at_its_word(self):
        # Everything captured before the delay was computed. Refusing those
        # would retire findings that were fine, on no evidence that they are not.
        journal = mornings_and_evenings(recall_delay=None)

        assert len(mine(*_of(journal))) == 1

    def test_an_ordering_nobody_writes_about_any_more_lapses(self):
        journal = mornings_and_evenings()
        journal.observed_days.add(START + timedelta(days=200))

        assert mine(*_of(journal)) == []

    def test_weak_readings_do_not_become_a_claim_by_being_ordered(self):
        assert mine(*_of(mornings_and_evenings(confidence=0.2))) == []


class TestWhatItIsAllowedToSay:
    def test_the_description_states_sequence_and_a_typical_gap(self):
        text = describe(mine(*_of(mornings_and_evenings(zoned=True)))[0])

        assert text == (
            "wired came up earlier in the day than skipping dinner · "
            "on 4 of the 4 days both came up, about 10 hours apart"
        )

    def test_the_description_claims_no_cause(self):
        text = describe(mine(*_of(mornings_and_evenings()))[0]).lower()

        for causal in ("because", "cause", "trigger", "leads to", "makes", "due to", "so that"):
            assert causal not in text

    def test_a_short_gap_is_not_dressed_up_as_a_number(self):
        text = describe(mine(*_of(mornings_and_evenings(gap=0.6)))[0])

        assert "under an hour" in text

    def test_the_typical_gap_ignores_one_very_long_day(self):
        journal = Journal()
        for day, gap in ((0, 3.0), (7, 3.0), (14, 3.0), (21, 14.0)):
            journal.write(day, 8.0, NodeKind.EMOTION, "wired")
            journal.write(day, 8.0 + gap, NodeKind.ACTIVITY, "skipping dinner")

        assert "about 3 hours apart" in describe(mine(*_of(journal))[0])

    def test_days_are_hedged_until_every_entry_knows_its_timezone(self):
        assert describe(mine(*_of(mornings_and_evenings()))[0]).endswith("(UTC)")
        assert not describe(mine(*_of(mornings_and_evenings(zoned=True)))[0]).endswith("(UTC)")


class TestTheSharedPatternContract:
    def test_it_cites_both_entries_from_every_occasion(self):
        journal = mornings_and_evenings()
        finding = mine(*_of(journal))[0]

        pattern = to_pattern(finding)

        assert pattern.kind is NodeKind.PATTERN
        assert pattern.label == describe(finding)
        assert pattern.key == "Emotion:wired->Activity:skipping dinner:sameday"
        assert set(pattern.observation_ids) == {
            candidate.observation_id for candidate in journal.candidates
        }
        assert pattern.occurrences == 4

    def test_input_order_does_not_change_the_claim(self):
        journal = mornings_and_evenings()
        forwards = mine(journal.candidates, journal.observed_days)
        backwards = mine(list(reversed(journal.candidates)), journal.observed_days)

        assert [f.key for f in forwards] == [f.key for f in backwards]

    def test_entries_without_a_time_are_ignored_rather_than_guessed(self):
        # Everything written before entries carried a moment simply cannot
        # contribute here, and must not be assumed to have happened at midnight.
        journal = mornings_and_evenings()
        journal.candidates = [
            Candidate(
                node_id=candidate.node_id,
                kind=candidate.kind,
                label=candidate.label,
                confidence=candidate.confidence,
                observation_id=candidate.observation_id,
                observed_on=candidate.observed_on,
                zoned=candidate.zoned,
            )
            for candidate in journal.candidates
        ]

        assert mine(*_of(journal)) == []
