from tlon.domain.identity import (
    IDENTITY_NODE_KINDS,
    IdentitySelectionStatus,
    can_select,
    selection_is_active,
)
from tlon.graph.schema import NodeKind


def test_identity_candidates_are_existing_non_diagnostic_kinds():
    assert {
        NodeKind.VALUE,
        NodeKind.BELIEF,
        NodeKind.NEED,
        NodeKind.ACTIVITY,
    } == IDENTITY_NODE_KINDS
    assert can_select(NodeKind.VALUE)
    assert not can_select(NodeKind.EMOTION)
    assert not can_select(NodeKind.VALUE, deleted_at=True)


def test_removed_selection_is_not_active_and_can_be_reselected():
    assert selection_is_active(IdentitySelectionStatus.SELECTED)
    assert not selection_is_active(IdentitySelectionStatus.REMOVED)
    assert IdentitySelectionStatus.REMOVED != IdentitySelectionStatus.SELECTED
