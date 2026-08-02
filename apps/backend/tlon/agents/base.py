"""What a background agent is.

Background agents are the part of this system that makes claims about someone
without being asked. That is a genuinely different thing from responding to a
request, and the constraints follow from it:

- **Every run is logged**, including the ones that did nothing. "Nothing ran" and
  "something ran and found nothing" are different answers to a person asking why
  their graph changed, and only a log can tell them apart.
- **Agents are per-user.** There is no cross-user analysis anywhere in this
  system, and the interface makes it awkward to write one by accident.
- **A failing agent is contained.** One agent throwing must not stop the others,
  and must never leave a half-written conclusion behind — hence the transaction
  boundary inside each agent rather than around the batch.
- **Agents declare what they need.** `should_run` lets an agent skip cheaply when
  there is no new material, which is what keeps a scheduler from burning tokens
  re-deriving the same conclusions every hour.

Deterministic agents are preferred over model-backed ones wherever the work can
be done by arithmetic. A recurrence that was counted is explainable in a way that
a recurrence a model asserted is not.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable
from uuid import UUID

import asyncpg


@dataclass(frozen=True)
class AgentResult:
    """What one run did.

    Counts rather than content. The run log is a record of activity, not a second
    copy of the person's material — a log that quoted their entries back would be
    another place their private writing lives.
    """

    #: Free-form counts, e.g. {"patterns": 3, "considered": 41}. Rendered to the
    #: user as "what this run did", so keys should read as plain words.
    summary: dict[str, int | str] = field(default_factory=dict)
    #: True when the agent decided there was nothing to do. Recorded distinctly
    #: from success, because "skipped" and "found nothing" are different facts.
    skipped: bool = False
    #: Why it skipped, in a phrase. Shown to the user.
    reason: str = ""


@runtime_checkable
class Agent(Protocol):
    """A unit of background work for one user."""

    @property
    def name(self) -> str:
        """Stable identifier. Appears in the run log and never changes, because
        changing it would orphan a person's history of what ran."""

    @property
    def version(self) -> str:
        """Bumped whenever the logic changes, so a conclusion can be attributed to
        the exact version that drew it."""

    @property
    def cadence_seconds(self) -> int:
        """How often the scheduler may run this. A floor, not a promise."""

    async def should_run(self, pool: asyncpg.Pool, user_id: UUID) -> bool:
        """Cheap check for whether there is anything new to work on.

        Runs before every scheduled attempt, so it must be much cheaper than the
        agent itself — a query, not an analysis.
        """

    async def run(self, pool: asyncpg.Pool, user_id: UUID) -> AgentResult:
        """Do the work. Raising is fine; the runner records the failure."""
