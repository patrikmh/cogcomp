"""HTTP endpoints for the user-curated identity projection."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from tlon.auth import current_user
from tlon.db import identity as identity_db
from tlon.domain.identity import IdentitySelectionStatus

router = APIRouter()


class SelectionChange(BaseModel):
    status: IdentitySelectionStatus


class SelectionRequest(BaseModel):
    node_id: UUID


@router.get("/v1/identity")
async def get_identity(request: Request, user_id: UUID = Depends(current_user)) -> dict:
    return await identity_db.projection(request.app.state.pool, user_id)


@router.get("/v1/identity/candidates")
async def get_identity_candidates(request: Request, user_id: UUID = Depends(current_user)) -> dict:
    return {"candidates": await identity_db.candidates(request.app.state.pool, user_id)}


@router.post("/v1/identity/selections", status_code=status.HTTP_200_OK)
async def select_identity_node(
    request: Request, payload: SelectionRequest, user_id: UUID = Depends(current_user)
) -> dict:
    selection = await identity_db.select_node(request.app.state.pool, user_id, payload.node_id)
    if selection is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "node is not a live identity candidate"
        )
    return selection


@router.post("/v1/identity/{node_id}", include_in_schema=False)
async def select_identity_node_alias(
    request: Request, node_id: UUID, user_id: UUID = Depends(current_user)
) -> dict:
    selection = await identity_db.select_node(request.app.state.pool, user_id, node_id)
    if selection is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "node is not a live identity candidate"
        )
    return selection


@router.patch("/v1/identity/selections/{node_id}")
async def change_identity_selection(
    request: Request,
    node_id: UUID,
    payload: SelectionChange,
    user_id: UUID = Depends(current_user),
) -> dict:
    selection = await identity_db.update_selection(
        request.app.state.pool, user_id, node_id, payload.status
    )
    if selection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "selection not found")
    return selection


@router.delete("/v1/identity/selections/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_identity_selection(
    request: Request, node_id: UUID, user_id: UUID = Depends(current_user)
) -> None:
    selection = await identity_db.update_selection(
        request.app.state.pool, user_id, node_id, IdentitySelectionStatus.REMOVED
    )
    if selection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "selection not found")
