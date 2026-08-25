"""The thread grouper adds no claim, so the tests pin exactly what it may do.

What must never happen here: two findings grouped when they share no supporting
label, a subject named that no pair of members shares, or an ordering that moves
between identical runs.
"""

from uuid import UUID, uuid4

from tlon.threads import Link, threads


def link(
    subject: str,
    *,
    label: str | None = None,
    pattern_id: UUID | None = None,
    detector: str = "exact-label",
    confidence: float = 0.8,
    occurrences: int = 4,
) -> Link:
    return Link(
        pattern_id=pattern_id or uuid4(),
        detector=detector,
        label=label or subject,
        confidence=confidence,
        tentative=confidence < 0.5,
        occurrences=occurrences,
        subject_label=subject,
    )


def test_findings_sharing_a_subject_form_one_thread():
    dread = link("dread")
    thursdays = link("dread", label="dread tends to turn up on Thursdays", detector="weekday")
    found = threads([dread, thursdays])
    assert len(found) == 1
    assert {m.pattern_id for m in found[0].members} == {
        dread.pattern_id,
        thursdays.pattern_id,
    }
    assert found[0].subjects == ("dread",)


def test_findings_with_no_shared_subject_are_left_alone():
    assert threads([link("dread"), link("running")]) == []


def test_trivial_case_and_punctuation_do_not_split_a_thread():
    tired = link("tired")
    tired_again = link(" Tired ", label="Tired.", detector="weekday")
    found = threads([tired, tired_again])
    assert len(found) == 1
    assert found[0].subjects == ("Tired",)


def test_a_bridge_finding_chains_two_subjects_and_names_both():
    # One finding resting on both nodes is what makes the dread thread and the
    # sleep thread the same group. Both subjects stay named.
    bridge_id = uuid4()
    dread = link("dread")
    sleep = link("sleep", label="broken sleep")
    bridge_rows = [
        link(
            "dread", label="dread comes before broken sleep", pattern_id=bridge_id, detector="lag"
        ),
        link(
            "sleep", label="dread comes before broken sleep", pattern_id=bridge_id, detector="lag"
        ),
    ]
    found = threads([dread, *bridge_rows, sleep])
    assert len(found) == 1
    assert set(found[0].subjects) == {"dread", "sleep"}
    assert {m.pattern_id for m in found[0].members} == {
        dread.pattern_id,
        sleep.pattern_id,
        bridge_id,
    }


def test_a_subject_under_only_one_member_is_not_named():
    # Two findings share "dread"; one of them also cites "coffee", which nothing
    # else rests on. The thread is about dread — naming coffee would dress one
    # member's private evidence up as something shared.
    paired_id = uuid4()
    links = [
        link("dread"),
        link("dread", label="dread · coffee", pattern_id=paired_id, detector="co-occurrence"),
        link("coffee", label="dread · coffee", pattern_id=paired_id, detector="co-occurrence"),
    ]
    found = threads(links)
    assert len(found) == 1
    assert found[0].subjects == ("dread",)


def test_ordering_is_deterministic_and_strongest_first():
    first = link("dread", occurrences=9)
    second = link("dread", label="dread on Thursdays", detector="weekday", occurrences=4)
    rest = link("rest", occurrences=3)
    rest_recorded_id = uuid4()
    rest_rows = [
        link(
            "rest",
            label="rest stated · working late recorded",
            pattern_id=rest_recorded_id,
            detector="stated-vs-recorded",
            occurrences=3,
        ),
        link(
            "working late",
            label="rest stated · working late recorded",
            pattern_id=rest_recorded_id,
            detector="stated-vs-recorded",
            occurrences=3,
        ),
        link(
            "working late",
            label="working late",
            occurrences=5,
        ),
    ]

    found = threads([first, second, rest, *rest_rows])
    assert len(found) == 2

    # The rest side chained through "working late" into a third finding, so it
    # carries both bridging subjects, has three members, and outranks the
    # two-member dread thread.
    dread_thread = next(t for t in found if t.subjects == ("dread",))
    rest_thread = next(t for t in found if set(t.subjects) == {"rest", "working late"})
    assert dread_thread.members[0].pattern_id == first.pattern_id
    assert len(rest_thread.members) == 3
    assert found.index(rest_thread) < found.index(dread_thread)


def test_identical_input_yields_identical_output():
    links = [link("dread"), link("dread", label="dread on Thursdays", detector="weekday")]
    assert threads(list(links)) == threads(list(reversed(links)))


def test_empty_input_yields_nothing():
    assert threads([]) == []


def test_tentative_travels_with_the_member():
    forming = link("dread", confidence=0.4)
    held = link("dread", label="dread on Thursdays", detector="weekday")
    found = threads([forming, held])
    members = {m.pattern_id: m for m in found[0].members}
    assert members[forming.pattern_id].tentative is True
    assert members[held.pattern_id].tentative is False
