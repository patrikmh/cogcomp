"""Pure validation and lifecycle rules for user-authored experiments."""

from datetime import date
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator

STATES = ("draft", "active", "paused", "completed", "cancelled")
CADENCES = ("daily", "weekly", "end_only")
ASSESSMENTS = ("met", "partly_met", "not_met", "unclear")


class ExperimentInput(BaseModel):
    id: UUID
    title: str = Field(min_length=1, max_length=200)
    hypothesis: str = Field(min_length=1, max_length=2000)
    action: str = Field(min_length=1, max_length=2000)
    success_criterion: str = Field(min_length=1, max_length=2000)
    start_date: date
    duration_days: int = Field(ge=1, le=42)
    timezone: str
    cadence: str

    @field_validator("title", "hypothesis", "action", "success_criterion")
    @classmethod
    def non_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text must not be blank")
        return value

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timezone must be a valid IANA timezone") from exc
        return value

    @field_validator("cadence")
    @classmethod
    def valid_cadence(cls, value: str) -> str:
        if value not in CADENCES:
            raise ValueError("unknown cadence")
        return value


class ExperimentEdit(ExperimentInput):
    id: UUID | None = None


def transition(current: str, target: str) -> None:
    allowed = {
        "draft": {"active", "cancelled"},
        "active": {"paused", "completed", "cancelled"},
        "paused": {"active", "cancelled"},
        "completed": set(),
        "cancelled": set(),
    }
    if target not in STATES or target not in allowed.get(current, set()):
        raise ValueError(f"invalid experiment transition: {current} -> {target}")


def can_edit(state: str) -> bool:
    return state == "draft"
