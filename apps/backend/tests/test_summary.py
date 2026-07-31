"""Day-boundary arithmetic. Pure logic, no database."""

from datetime import date

import pytest

from tlon.db.summary import UnknownTimezone, day_bounds


class TestDayBounds:
    def test_utc_day_is_midnight_to_midnight(self):
        start, end = day_bounds(date(2026, 3, 15), "UTC")
        assert start.isoformat() == "2026-03-15T00:00:00+00:00"
        assert end.isoformat() == "2026-03-16T00:00:00+00:00"

    def test_a_day_is_local_not_utc(self):
        # Stockholm is UTC+1 in March, so its midnight is 23:00 UTC the day before.
        # An entry written at 23:30 local belongs to that day, not the next.
        start, end = day_bounds(date(2026, 3, 15), "Europe/Stockholm")
        assert start.isoformat() == "2026-03-14T23:00:00+00:00"
        assert end.isoformat() == "2026-03-15T23:00:00+00:00"

    def test_a_western_timezone_starts_later_in_utc(self):
        # Los Angeles is UTC-7 in March (already on DST), so its midnight is 07:00
        # UTC the same morning.
        start, _ = day_bounds(date(2026, 3, 15), "America/Los_Angeles")
        assert start.isoformat() == "2026-03-15T07:00:00+00:00"

    def test_bounds_are_returned_in_utc(self):
        # One unambiguous instant, so elapsed-time arithmetic on the result is
        # correct rather than wall-clock.
        start, end = day_bounds(date(2026, 3, 15), "Europe/Stockholm")
        assert start.utcoffset().total_seconds() == 0
        assert end.utcoffset().total_seconds() == 0

    def test_spring_forward_gives_a_short_day(self):
        # 2026-03-29 is the EU DST transition: 02:00 local never happens, so the
        # day is 23 hours. Adding 24 hours to the instant would overshoot into the
        # next day and pull in entries that do not belong to it.
        start, end = day_bounds(date(2026, 3, 29), "Europe/Stockholm")
        assert (end - start).total_seconds() == 23 * 3600

    def test_autumn_back_gives_a_long_day(self):
        # 2026-10-25: 02:00 local happens twice, so the day is 25 hours.
        start, end = day_bounds(date(2026, 10, 25), "Europe/Stockholm")
        assert (end - start).total_seconds() == 25 * 3600

    def test_an_ordinary_day_is_24_hours(self):
        start, end = day_bounds(date(2026, 6, 15), "Europe/Stockholm")
        assert (end - start).total_seconds() == 24 * 3600

    def test_days_tile_without_gap_or_overlap(self):
        # Every instant belongs to exactly one day, including across a DST change.
        _, end = day_bounds(date(2026, 3, 29), "Europe/Stockholm")
        next_start, _ = day_bounds(date(2026, 3, 30), "Europe/Stockholm")
        assert end == next_start

    @pytest.mark.parametrize("bad", ["Mars/Olympus_Mons", "not a timezone", ""])
    def test_an_unknown_timezone_is_rejected(self, bad: str):
        with pytest.raises(UnknownTimezone):
            day_bounds(date(2026, 3, 15), bad)
