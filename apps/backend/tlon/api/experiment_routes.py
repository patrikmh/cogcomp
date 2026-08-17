"""Authenticated, user-controlled experiment API."""

from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from tlon.auth import current_user
from tlon.db import experiments as db
from tlon.domain.experiment import ExperimentEdit, ExperimentInput

router = APIRouter()


class Mutation(BaseModel):
    revision: int
    include_links: bool = True


class Outcome(Mutation):
    assessment: str
    note: str | None = None
    final_checkin_observation_id: UUID


class Link(Mutation):
    node_id: UUID


class Checkin(Mutation):
    observation_id: UUID


def fail(exc):
    if isinstance(exc, db.Missing):
        raise HTTPException(404, "not found") from exc
    raise HTTPException(409, str(exc)) from exc


def response(row):
    return row


@router.post("/v1/experiments", status_code=201)
async def create(
    request: Request,
    payload: ExperimentInput,
    user_id: UUID = Depends(current_user),
    x_request_fingerprint: str | None = Header(None),
):
    try:
        return await db.create(
            request.app.state.pool, user_id, payload.id, payload, x_request_fingerprint
        )
    except (db.Conflict, ValueError) as exc:
        fail(exc)


@router.get("/v1/experiments")
async def listing(
    request: Request,
    include_links: bool = True,
    user_id: UUID = Depends(current_user),
):
    return {
        "experiments": await db.list_for_user(
            request.app.state.pool, user_id, include_links=include_links
        )
    }


@router.get("/v1/experiments/{experiment_id}")
async def fetch(
    request: Request,
    experiment_id: UUID,
    include_links: bool = True,
    user_id: UUID = Depends(current_user),
):
    try:
        return await db.detail(
            request.app.state.pool, user_id, experiment_id, include_links=include_links
        )
    except db.Missing as exc:
        fail(exc)


@router.patch("/v1/experiments/{experiment_id}")
async def edit(
    request: Request,
    experiment_id: UUID,
    payload: ExperimentEdit,
    revision: int,
    include_links: bool = True,
    user_id: UUID = Depends(current_user),
):
    try:
        return await db.edit(
            request.app.state.pool, user_id, experiment_id, revision, payload, include_links
        )
    except (db.Conflict, db.Missing) as exc:
        fail(exc)


@router.delete("/v1/experiments/{experiment_id}", status_code=204)
async def delete(
    request: Request, experiment_id: UUID, revision: int, user_id: UUID = Depends(current_user)
):
    try:
        await db.soft_delete(request.app.state.pool, user_id, experiment_id, revision)
    except (db.Conflict, db.Missing) as exc:
        fail(exc)


async def state(request, experiment_id, payload, target, user_id):
    try:
        return await db.set_state(
            request.app.state.pool,
            user_id,
            experiment_id,
            payload.revision,
            target,
            getattr(payload, "assessment", None),
            getattr(payload, "note", None),
            getattr(payload, "final_checkin_observation_id", None),
            payload.include_links,
        )
    except (db.Conflict, db.Missing) as exc:
        fail(exc)


@router.post("/v1/experiments/{experiment_id}/start")
async def start(
    request: Request, experiment_id: UUID, payload: Mutation, user_id: UUID = Depends(current_user)
):
    return await state(request, experiment_id, payload, "active", user_id)


@router.post("/v1/experiments/{experiment_id}/pause")
async def pause(
    request: Request, experiment_id: UUID, payload: Mutation, user_id: UUID = Depends(current_user)
):
    return await state(request, experiment_id, payload, "paused", user_id)


@router.post("/v1/experiments/{experiment_id}/resume")
async def resume(
    request: Request, experiment_id: UUID, payload: Mutation, user_id: UUID = Depends(current_user)
):
    return await state(request, experiment_id, payload, "active", user_id)


@router.post("/v1/experiments/{experiment_id}/cancel")
async def cancel(
    request: Request, experiment_id: UUID, payload: Mutation, user_id: UUID = Depends(current_user)
):
    return await state(request, experiment_id, payload, "cancelled", user_id)


@router.post("/v1/experiments/{experiment_id}/complete")
async def complete(
    request: Request, experiment_id: UUID, payload: Outcome, user_id: UUID = Depends(current_user)
):
    return await state(request, experiment_id, payload, "completed", user_id)


@router.post("/v1/experiments/{experiment_id}/links")
async def add_link(
    request: Request, experiment_id: UUID, payload: Link, user_id: UUID = Depends(current_user)
):
    try:
        return await db.link(
            request.app.state.pool,
            user_id,
            experiment_id,
            payload.node_id,
            payload.revision,
            payload.include_links,
        )
    except (db.Conflict, db.Missing) as exc:
        fail(exc)


@router.delete("/v1/experiments/{experiment_id}/links/{node_id}")
async def remove_link(
    request: Request,
    experiment_id: UUID,
    node_id: UUID,
    revision: int,
    include_links: bool = True,
    user_id: UUID = Depends(current_user),
):
    try:
        return await db.unlink(
            request.app.state.pool, user_id, experiment_id, node_id, revision, include_links
        )
    except (db.Conflict, db.Missing) as exc:
        fail(exc)


@router.post("/v1/experiments/{experiment_id}/checkins")
async def checkin(
    request: Request, experiment_id: UUID, payload: Checkin, user_id: UUID = Depends(current_user)
):
    try:
        return await db.attach_checkin(
            request.app.state.pool,
            user_id,
            experiment_id,
            payload.observation_id,
            payload.revision,
            payload.include_links,
        )
    except (db.Conflict, db.Missing) as exc:
        fail(exc)
