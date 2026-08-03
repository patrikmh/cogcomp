from datetime import date, timedelta

import pytest

from tlon.domain.weekly import NonMonday, UnknownTimezone, week_bounds, week_dates


def test_week_is_seven_calendar_dates_from_monday():
    assert week_dates(date(2026, 3, 16))[-1] == date(2026, 3, 22)


def test_non_monday_is_rejected():
    with pytest.raises(NonMonday):
        week_bounds(date(2026, 3, 17), "UTC")


def test_unknown_timezone_is_rejected():
    with pytest.raises(UnknownTimezone):
        week_bounds(date(2026, 3, 16), "Mars/Olympus_Mons")


def test_dst_week_has_calendar_boundaries():
    start, end = week_bounds(date(2026, 3, 23), "Europe/Stockholm")
    assert end - start == timedelta(days=6, hours=23)


def test_autumn_dst_week_has_calendar_boundaries():
    start, end = week_bounds(date(2026, 10, 19), "Europe/Stockholm")
    assert end - start == timedelta(days=7, hours=1)
