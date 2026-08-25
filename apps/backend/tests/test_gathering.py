"""Gathering hints: what is one honest entry short of a finding.

The bar these tests protect: a hint is only ever reported at exactly two
distinct entries across the required distinct days. Anything mining would
rightly refuse for reasons a hint must not paper over — echoes, stale evidence,
weak readings, words that already earned a pattern — stays silent here too.
"""

from datetime import date
from uuid import uuid4

from tlon.gathering import GATHERING_OBSERVATIONS, gathering
from tlon.graph.schema import NodeKind
from tlon.patterns import MIN_DISTINCT_DAYS, MIN_OBSERVATIONS, Candidate


def candidate(
    label: str,
    day: int,
    *,
    kind: NodeKind = NodeKind.EMOTION,
    confidence: float = 0.8,
    observation_id=None,
) -> Candidate:
    return Candidate(
        node_id=uuid4(),
        kind=kind,
        label=label,
        confidence=confidence,
        observation_id=observation_id or uuid4(),
        observed_on=date(2026, 3, day),
    )


class TestGatheringThresholds:
    def test_two_entries_on_two_days_are_a_hint(self):
        found = gathering([candidate("dread", 1), candidate("dread", 4)])
        assert len(found) == 1
        assert found[0].observations == 2
        assert found[0].observations_needed == MIN_OBSERVATIONS

    def test_one_entry_is_not_worth_a_hint(self):
        assert gathering([candidate("dread", 1)]) == []

    def test_three_entries_already_crossed_the_floor(self):
        # At the floor it is mining's business, not a hint's.
        found = gathering([candidate("dread", 1), candidate("dread", 2), candidate("dread", 3)])
        assert found == []

    def test_two_mentions_in_one_sitting_are_an_echo(self):
        same_day = [candidate("dread", 1), candidate("dread", 1)]
        assert gathering(same_day) == []

    def test_the_gap_is_stated_in_days_too(self):
        found = gathering([candidate("dread", 1), candidate("dread", 5)])
        assert found[0].days_needed == MIN_DISTINCT_DAYS
        assert found[0].distinct_days == 2


class TestGatheringHonesty:
    def test_stale_evidence_is_not_forming(self):
        # Same distance from the floor, but the window has moved on: a claim
        # built on this now would not be present tense.
        found = gathering(
            [
                candidate("dread", 1),
                candidate("dread", 4),
            ],
            # More than RECENCY_DAYS after the last mention.
            as_of=date(2026, 5, 15),
        )
        assert found == []

    def test_weak_readings_do_not_hint(self):
        found = gathering(
            [
                candidate("dread", 1, confidence=0.2),
                candidate("dread", 4, confidence=0.2),
            ]
        )
        assert found == []

    def test_a_held_pattern_is_never_also_a_hint(self):
        cands = [candidate("dread", 1), candidate("dread", 4)]
        held = {"Emotion:dread"}
        assert gathering(cands, held_keys=held) == []

    def test_lapsed_words_may_form_again(self):
        # The tombstone is not in held_keys, so a returning word earns its hint.
        cands = [candidate("dread", 1), candidate("dread", 4)]
        assert len(gathering(cands, held_keys=set())) == 1

    def test_non_patternable_kinds_stay_silent(self):
        cands = [
            candidate("note to self", 1, kind=NodeKind.THOUGHT),
            candidate("note to self", 4, kind=NodeKind.THOUGHT),
        ]
        assert gathering(cands) == []


class TestGatheringNaming:
    def test_uses_the_most_recent_own_wording(self):
        # Same key (case/punctuation fold), but the raw phrasings differ; the
        # person's latest way of writing it is the one shown.
        cands = [
            candidate("Dread", 1),
            candidate("  DREAD!!", 4),
        ]
        found = gathering(cands)
        assert found[0].label == "  DREAD!!"

    def test_case_and_punctuation_fold_into_one_candidate(self):
        cands = [
            candidate("Dread.", 1),
            candidate("  dread", 4),
        ]
        assert len(gathering(cands)) == 1

    def test_deterministic_ordering_newest_first(self):
        cands = [candidate("alpha", 10), candidate("alpha", 12)] + [
            candidate("beta", 2),
            candidate("beta", 20),
        ]
        found = gathering(cands)
        assert [c.label for c in found] == ["beta", "alpha"]

    def test_floor_constants_are_consistent(self):
        assert GATHERING_OBSERVATIONS == MIN_OBSERVATIONS - 1
