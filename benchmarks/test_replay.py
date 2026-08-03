"""The replay's declared truth must distinguish different kinds of claim."""

from benchmarks.replay import Track, _periodicity_report


def test_the_generic_recurrence_does_not_satisfy_periodicity_truth():
    tracks = {
        ("exact-label", "Emotion:drained"): Track(
            first_reported_day=17,
            node_ids={"exact"},
            live_days=[17],
        )
    }

    report = _periodicity_report(tracks, days=120)

    assert report["found"] == {}
    assert "Emotion:drained:weekday:3" in report["missed"]


def test_an_unplanted_periodicity_is_reported():
    tracks = {
        ("weekday", "Emotion:dread:weekday:1"): Track(
            first_reported_day=24,
            node_ids={"invented"},
            live_days=[24],
        )
    }

    report = _periodicity_report(tracks, days=120)

    assert report["unaccounted"] == {"Emotion:dread:weekday:1": 24}
