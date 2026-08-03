"""Pure rules for the user-curated identity projection."""

from enum import StrEnum

from tlon.graph.schema import NodeKind

IDENTITY_NODE_KINDS = frozenset({NodeKind.VALUE, NodeKind.BELIEF, NodeKind.NEED, NodeKind.ACTIVITY})


class IdentitySelectionStatus(StrEnum):
    SELECTED = "selected"
    REMOVED = "removed"


def is_identity_candidate(kind: str | NodeKind, deleted_at: object = None) -> bool:
    """Whether a live graph node may be selected for the projection."""
    return deleted_at is None and kind in IDENTITY_NODE_KINDS


def can_select(kind: str | NodeKind, deleted_at: object = None) -> bool:
    return is_identity_candidate(kind, deleted_at)


def can_change_selection(status: str | IdentitySelectionStatus) -> bool:
    return status in IdentitySelectionStatus


def selection_is_active(status: str | IdentitySelectionStatus) -> bool:
    return status == IdentitySelectionStatus.SELECTED
