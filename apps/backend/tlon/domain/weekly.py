"""Pure calendar rules for deterministic Monday--Sunday reports."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


class UnknownTimezone(ValueError):
    pass


class NonMonday(ValueError):
    pass


def timezone_for(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise UnknownTimezone(f"unknown timezone: {name}") from exc


def week_bounds(week_start: date, timezone: str) -> tuple[datetime, datetime]:
    """Return UTC instants for local Monday midnight and next Monday midnight."""
    zone = timezone_for(timezone)
    if week_start.weekday() != 0:
        raise NonMonday("week_start must be a Monday")
    start = datetime.combine(week_start, time.min, tzinfo=zone)
    end = datetime.combine(week_start + timedelta(days=7), time.min, tzinfo=zone)
    return start.astimezone(UTC), end.astimezone(UTC)


def week_dates(week_start: date) -> tuple[date, ...]:
    if week_start.weekday() != 0:
        raise NonMonday("week_start must be a Monday")
    return tuple(week_start + timedelta(days=i) for i in range(7))


def local_date(instant: datetime, timezone: str) -> date:
    return instant.astimezone(timezone_for(timezone)).date()
