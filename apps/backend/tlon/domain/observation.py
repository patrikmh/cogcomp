"""Observations are the raw material: what the user actually said or typed.

They are never edited and never inferred. Everything else in the graph is downstream
of them, which is why they are the one thing stored verbatim.
"""

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, field_validator

from tlon.domain.weekly import timezone_for

#: Generous enough for a long voice entry, bounded so a runaway client cannot write
#: an unbounded row.
MAX_CONTENT_CHARS = 50_000


class Source(StrEnum):
    TEXT = "text"
    VOICE = "voice"


class NewObservation(BaseModel):
    """A validated observation ready to persist.

    The id comes from the client so capture works offline — the phone mints a
    UUIDv7 the moment the user speaks, and sync reconciles later without having to
    rewrite references.
    """

    id: UUID
    content: str
    source: Source
    captured_at: datetime | None = None
    #: The IANA zone the entry was written in, e.g. `Europe/Stockholm`. Optional
    #: because a client that does not send one must still be able to capture:
    #: losing the entry would be far worse than not knowing its local calendar.
    #: `None` is recorded as unknown, never quietly as UTC.
    timezone: str | None = None

    @field_validator("timezone")
    @classmethod
    def timezone_is_known(cls, value: str | None) -> str | None:
        if value is None:
            return None
        # Validated on the way in, because an unrecognised zone is only
        # discoverable later inside a detector, where the only available
        # response is to fail mining for everything else too.
        timezone_for(value)
        return value

    @field_validator("content")
    @classmethod
    def content_is_not_blank(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("observation content cannot be blank")
        if len(trimmed) > MAX_CONTENT_CHARS:
            raise ValueError(f"observation content exceeds {MAX_CONTENT_CHARS} characters")
        return trimmed


class Observation(BaseModel):
    id: UUID
    user_id: UUID
    content: str
    source: Source
    captured_at: datetime
    created_at: datetime
    timezone: str | None = None
    deleted_at: datetime | None = None
