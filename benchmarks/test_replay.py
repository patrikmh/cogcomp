"""The replay's declared truth must distinguish different kinds of claim."""

from benchmarks.replay import Track, _lag_report, _periodicity_report


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


def test_exact_recurrence_does_not_satisfy_lag_truth():
    tracks = {
        "Activity:sleeping badly": Track(
            first_reported_day=10,
            node_ids={"exact"},
            live_days=[10],
        )
    }

    report = _lag_report(tracks, days=120)

    assert report["found"] == {}
    assert "Activity:sleeping badly->Emotion:foggy:lag:1" in report["missed"]


def test_an_unplanted_lag_is_reported():
    tracks = {
        "Emotion:dread->Activity:coffee:lag:2": Track(
            first_reported_day=20,
            node_ids={"dark-launch"},
            live_days=[20],
        )
    }

    report = _lag_report(tracks, days=120)

    assert report["unaccounted"] == {"Emotion:dread->Activity:coffee:lag:2": 20}
