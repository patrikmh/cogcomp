from datetime import date
from uuid import uuid4

import pytest
from pydantic import ValidationError

from tlon.domain.experiment import ExperimentInput, can_edit, transition


def payload(**overrides):
    value = {
        "id": uuid4(),
        "title": "A small experiment",
        "hypothesis": "A consistent action will help",
        "action": "Do the action",
        "success_criterion": "Notice a difference",
        "start_date": date(2026, 3, 1),
        "duration_days": 1,
        "timezone": "Europe/Stockholm",
        "cadence": "daily",
    }
    value.update(overrides)
    return value


class TestExperimentInput:
    @pytest.mark.parametrize("field", ["title", "hypothesis", "action", "success_criterion"])
    def test_text_is_non_blank_and_bounded(self, field):
        assert ExperimentInput(**payload(**{field: "x"})).model_dump()[field] == "x"
        with pytest.raises(ValidationError):
            ExperimentInput(**payload(**{field: " "}))

    @pytest.mark.parametrize("duration", [0, 43])
    def test_duration_outside_one_to_forty_two_is_rejected(self, duration):
        with pytest.raises(ValidationError):
            ExperimentInput(**payload(duration_days=duration))

    @pytest.mark.parametrize("duration", [1, 42])
    def test_duration_bounds_are_accepted(self, duration):
        assert ExperimentInput(**payload(duration_days=duration)).duration_days == duration

    def test_text_limits_are_inclusive(self):
        for field, limit in (
            ("title", 200),
            ("hypothesis", 2000),
            ("action", 2000),
            ("success_criterion", 2000),
        ):
            assert (
                len(ExperimentInput(**payload(**{field: "x" * limit})).model_dump()[field]) == limit
            )
            with pytest.raises(ValidationError):
                ExperimentInput(**payload(**{field: "x" * (limit + 1)}))

    def test_timezone_must_be_iana(self):
        assert ExperimentInput(**payload(timezone="UTC")).timezone == "UTC"
        with pytest.raises(ValidationError, match="IANA"):
            ExperimentInput(**payload(timezone="not/a_timezone"))

    @pytest.mark.parametrize("cadence", ["daily", "weekly", "end_only"])
    def test_known_cadence_is_accepted(self, cadence):
        assert ExperimentInput(**payload(cadence=cadence)).cadence == cadence

    def test_unknown_cadence_is_rejected(self):
        with pytest.raises(ValidationError):
            ExperimentInput(**payload(cadence="hourly"))


class TestLifecycle:
    @pytest.mark.parametrize(
        "current,target",
        [
            ("draft", "active"),
            ("draft", "cancelled"),
            ("active", "paused"),
            ("active", "completed"),
            ("active", "cancelled"),
            ("paused", "active"),
            ("paused", "cancelled"),
        ],
    )
    def test_allowed_transitions(self, current, target):
        transition(current, target)

    @pytest.mark.parametrize(
        "current,target",
        [
            ("draft", "paused"),
            ("draft", "completed"),
            ("paused", "completed"),
            ("completed", "active"),
            ("completed", "completed"),
            ("cancelled", "draft"),
        ],
    )
    def test_disallowed_transitions(self, current, target):
        with pytest.raises(ValueError):
            transition(current, target)

    def test_only_drafts_are_editable(self):
        assert can_edit("draft")
        for state in ("active", "paused", "completed", "cancelled"):
            assert not can_edit(state)
