"""Signup, login, logout, and session management."""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field

from tlon.auth import bearer, current_user
from tlon.db import login_attempts as attempts_db
from tlon.db import users as users_db
from tlon.domain.credentials import (
    MIN_PASSWORD_LENGTH,
    WeakPassword,
    hash_password,
    needs_rehash,
    verify_password,
)

router = APIRouter(prefix="/v1/auth", tags=["auth"])


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=1024)
    #: Which device this is, so sessions are distinguishable when revoking one.
    device: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    device: str | None = None


class TokenResponse(BaseModel):
    user_id: UUID
    token: str
    #: Stated plainly because it is the only time the token is ever shown.
    note: str = "Store this token; it cannot be retrieved again."


@router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup(request: Request, payload: SignupRequest) -> TokenResponse:
    try:
        user_id, token = await users_db.create(
            request.app.state.pool, payload.email, payload.password, payload.device
        )
    except users_db.EmailTaken:
        # Signup necessarily reveals whether an address is registered — there is no
        # way to create an account at a taken address. Login, where the same leak is
        # avoidable, does avoid it.
        raise HTTPException(
            status.HTTP_409_CONFLICT, "an account with that email already exists"
        ) from None
    except WeakPassword as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    return TokenResponse(user_id=user_id, token=token)


@router.post("/login")
async def login(request: Request, payload: LoginRequest) -> TokenResponse:
    pool = request.app.state.pool

    # Checked before the password is verified, so a locked identity costs an
    # attacker a cheap rejection rather than an Argon2id hash. Counted per
    # address rather than per connection: an address is what passwords get
    # iterated against, and an IP is trivially rotated and shared by everyone
    # behind one router.
    if await attempts_db.is_locked(pool, payload.email):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "too many sign-in attempts — wait a few minutes and try again",
        )

    user = await users_db.find_by_email(pool, payload.email)

    # Verify against a dummy hash when the account does not exist, so a missing
    # account and a wrong password take the same time. Otherwise the response
    # latency itself tells an attacker which emails are registered.
    stored_hash = user["password_hash"] if user else None
    if not verify_password(stored_hash, payload.password):
        if stored_hash is None:
            hash_password("timing-equalizer-not-a-real-password")
        # Recorded for unknown addresses too. If only real accounts were rate
        # limited, the presence of a lockout would tell an attacker the account
        # exists — the very thing the constant-time check above avoids.
        await attempts_db.record_failure(pool, payload.email)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")

    # Cleared on success, so someone who mistyped a few times and then got it
    # right is not left one typo from a lockout for the rest of the window.
    await attempts_db.clear(pool, payload.email)

    if needs_rehash(stored_hash):
        # Cost parameters were raised since this password was set. We have the
        # plaintext right now and never will again, so upgrade it here.
        await users_db.update_password_hash(pool, user["id"], hash_password(payload.password))

    token = await users_db.issue_token(pool, user["id"], payload.device)
    return TokenResponse(user_id=user["id"], token=token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    user_id: UUID = Depends(current_user),
) -> None:
    """Revoke the token used to make this request. Other devices stay signed in."""
    assert credentials is not None  # current_user already rejected the missing case
    await users_db.revoke_token(request.app.state.pool, credentials.credentials.strip())


class SessionsResponse(BaseModel):
    sessions: list[dict]


@router.get("/sessions")
async def list_sessions(
    request: Request, user_id: UUID = Depends(current_user)
) -> SessionsResponse:
    return SessionsResponse(sessions=await users_db.list_sessions(request.app.state.pool, user_id))


class RevokedResponse(BaseModel):
    revoked: int


@router.post("/logout-everywhere")
async def logout_everywhere(
    request: Request, user_id: UUID = Depends(current_user)
) -> RevokedResponse:
    """Sign out every device, including this one."""
    revoked = await users_db.revoke_all_tokens(request.app.state.pool, user_id)
    return RevokedResponse(revoked=revoked)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=1024)


class ChangePasswordResponse(BaseModel):
    token: str
    revoked_sessions: int


@router.post("/change-password")
async def change_password(
    request: Request,
    payload: ChangePasswordRequest,
    user_id: UUID = Depends(current_user),
) -> ChangePasswordResponse:
    """Change the password and sign out everywhere, then issue one fresh token.

    A password change is usually a response to suspected compromise, so leaving
    other sessions alive would defeat the point. The caller gets a new token so the
    device doing the change is not signed out of its own session.
    """
    pool = request.app.state.pool
    row = await pool.fetchrow("SELECT password_hash FROM users WHERE id = $1", user_id)
    if not verify_password(row["password_hash"] if row else None, payload.current_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "current password is incorrect")

    try:
        new_hash = hash_password(payload.new_password)
    except WeakPassword as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    await users_db.update_password_hash(pool, user_id, new_hash)
    revoked = await users_db.revoke_all_tokens(pool, user_id)
    token = await users_db.issue_token(pool, user_id, "after password change")
    return ChangePasswordResponse(token=token, revoked_sessions=revoked)


class MeResponse(BaseModel):
    user_id: UUID
    email: str
    created_at: datetime


@router.get("/me")
async def me(request: Request, user_id: UUID = Depends(current_user)) -> MeResponse:
    row = await request.app.state.pool.fetchrow(
        "SELECT id, email, created_at FROM users WHERE id = $1", user_id
    )
    return MeResponse(user_id=row["id"], email=row["email"], created_at=row["created_at"])
