"""Pattern mining. Pure logic, no database.

A pattern is the first claim this system makes about someone across time rather
than about one entry, so most of these tests are about what it refuses to claim.
"""

from datetime import date
from uuid import UUID, uuid4

from tlon.graph.schema import NodeKind
from tlon.patterns import (
    MIN_DISTINCT_DAYS,
    MIN_OBSERVATIONS,
    Candidate,
    describe,
    mine,
    normalise,
)


def candidate(
    label: str,
    day: int,
    *,
    kind: NodeKind = NodeKind.EMOTION,
    confidence: float = 0.8,
    observation_id: UUID | None = None,
) -> Candidate:
    return Candidate(
        node_id=uuid4(),
        kind=kind,
        label=label,
        confidence=confidence,
        observation_id=observation_id or uuid4(),
        observed_on=date(2026, 3, day),
    )


def recurring(label: str, days=(1, 2, 3), **kwargs) -> list[Candidate]:
    return [candidate(label, day, **kwargs) for day in days]


class TestNormalise:
    def test_case_and_punctuation_are_folded(self):
        assert normalise("Tired.") == normalise("tired") == "tired"

    def test_surrounding_whitespace_is_folded(self):
        assert normalise("  dread  ") == "dread"

    def test_different_words_stay_different(self):
        # No stemming, no synonyms. Deciding that "tired" and "exhausted" are the
        # same thing is an interpretation, and this function does not interpret.
        assert normalise("tired") != normalise("exhausted")
        assert normalise("running") != normalise("run")


class TestRecurrenceThresholds:
    def test_a_single_mention_is_not_a_pattern(self):
        assert mine([candidate("dread", 1)]) == []

    def test_two_mentions_are_not_a_pattern(self):
        # Two is a coincidence often enough that calling it a pattern would
        # cheapen the word.
        assert mine(recurring("dread", days=(1, 2))) == []

    def test_three_mentions_across_three_days_is_a_pattern(self):
        patterns = mine(recurring("dread", days=(1, 2, 3)))
        assert len(patterns) == 1
        assert patterns[0].occurrences == 3

    def test_repetition_within_one_day_is_not_a_pattern(self):
        # Saying the same thing three times in one sitting is one thought.
        same_day = [candidate("dread", 1) for _ in range(5)]
        assert mine(same_day) == []

    def test_repetition_within_one_entry_is_not_a_pattern(self):
        # Nor is the extractor emitting the same label twice from one entry.
        observation = uuid4()
        repeated = [candidate("dread", day, observation_id=observation) for day in (1, 2, 3)]
        assert mine(repeated) == []

    def test_the_thresholds_are_what_the_constants_say(self):
        # Guards against the constants drifting away from the behaviour.
        days = tuple(range(1, MIN_DISTINCT_DAYS + 1))
        just_under = recurring("dread", days=days)[: MIN_OBSERVATIONS - 1]
        assert mine(just_under) == []


class TestWhatCanBeAPattern:
    def test_emotions_and_needs_can_recur(self):
        for kind in (NodeKind.EMOTION, NodeKind.NEED, NodeKind.BELIEF):
            assert mine(recurring("something", kind=kind)), kind

    def test_thoughts_are_not_patterned(self):
        # A Thought recurring verbatim is a phrasing coincidence, not a pattern.
        assert mine(recurring("I should call her", kind=NodeKind.THOUGHT)) == []

    def test_events_are_not_patterned(self):
        # An Event is by definition a single occurrence.
        assert mine(recurring("the argument", kind=NodeKind.EVENT)) == []

    def test_a_blank_label_is_ignored(self):
        assert mine(recurring("   ")) == []


class TestConfidence:
    def test_confidence_never_exceeds_the_weakest_input(self):
        # Recurrence does not launder the uncertainty underneath it. A pattern
        # built from shaky guesses is a shaky pattern, however often it appears.
        members = [
            candidate("dread", 1, confidence=0.9),
            candidate("dread", 2, confidence=0.3),
            candidate("dread", 3, confidence=0.8),
        ]
        assert mine(members)[0].confidence == 0.3

    def test_frequent_recurrence_does_not_inflate_confidence(self):
        members = [candidate("dread", day, confidence=0.4) for day in range(1, 11)]
        pattern = mine(members)[0]
        assert pattern.occurrences == 10
        assert pattern.confidence == 0.4


class TestProvenance:
    def test_every_contributing_observation_is_cited(self):
        members = recurring("dread")
        pattern = mine(members)[0]
        assert set(pattern.observation_ids) == {m.observation_id for m in members}

    def test_every_contributing_node_is_recorded(self):
        members = recurring("dread")
        pattern = mine(members)[0]
        assert set(pattern.node_ids) == {m.node_id for m in members}

    def test_duplicate_observations_are_counted_once(self):
        observation = uuid4()
        members = [
            candidate("dread", 1, observation_id=observation),
            candidate("dread", 1, observation_id=observation),
            candidate("dread", 2),
            candidate("dread", 3),
        ]
        pattern = mine(members)[0]
        assert pattern.occurrences == 3


class TestLabelling:
    def test_the_label_is_the_persons_most_recent_phrasing(self):
        # Not the normalised form, and not an invented summary — the record
        # should read in their words.
        members = [
            candidate("Dread.", 1),
            candidate("dread", 2),
            candidate("Dread", 3),
        ]
        assert mine(members)[0].label == "Dread"

    def test_a_longer_phrasing_is_a_different_thing(self):
        # "a low dread" is not "dread" under exact matching, and that is the
        # intended direction to be wrong in: under-reporting beats inventing a
        # recurrence the person never had.
        members = [
            candidate("dread", 1),
            candidate("dread", 2),
            candidate("a low dread", 3),
        ]
        assert mine(members) == []

    def test_variants_that_normalise_together_are_one_pattern(self):
        members = [candidate("Tired.", 1), candidate("tired", 2), candidate("  TIRED  ", 3)]
        assert len(mine(members)) == 1

    def test_the_same_label_under_different_kinds_stays_separate(self):
        members = [
            *recurring("rest", kind=NodeKind.NEED),
            *recurring("rest", kind=NodeKind.ACTIVITY),
        ]
        patterns = mine(members)
        assert len(patterns) == 2
        assert {p.kind for p in patterns} == {NodeKind.NEED, NodeKind.ACTIVITY}


class TestDeterminism:
    def test_the_same_graph_yields_the_same_patterns(self):
        # A pattern that appears and disappears between runs is worse than no
        # pattern at all.
        members = [*recurring("dread"), *recurring("rest", kind=NodeKind.NEED)]
        first = [(p.kind, p.label, p.occurrences) for p in mine(members)]
        second = [(p.kind, p.label, p.occurrences) for p in mine(list(reversed(members)))]
        assert first == second

    def test_patterns_are_ordered_by_strength(self):
        members = [
            *recurring("often", days=(1, 2, 3, 4, 5)),
            *recurring("less often", days=(1, 2, 3)),
        ]
        patterns = mine(members)
        assert [p.label for p in patterns] == ["often", "less often"]


class TestDescribe:
    def test_it_states_the_count_without_interpreting_it(self):
        pattern = mine(recurring("dread", days=(1, 2, 3)))[0]
        text = describe(pattern)
        assert "3 entries" in text
        assert "3 days" in text
        # What it means is the person's to decide.
        for interpretation in ("struggling", "pattern of", "suggests", "indicates"):
            assert interpretation not in text.lower()

    def test_it_gets_singulars_right(self):
        members = [candidate("dread", 1), candidate("dread", 1), candidate("dread", 2)]
        # Three entries, two days.
        pattern = mine(members)[0]
        assert "3 entries" in describe(pattern)
        assert "2 days" in describe(pattern)


class TestEmpty:
    def test_no_candidates_yields_no_patterns(self):
        assert mine([]) == []
