"""Bearer-token authentication.

Every user-facing route depends on current_user. That is the enforcement mechanism:
a handler with no user id has nothing to scope its query to.
"""

from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from tlon.db import users as users_db

# auto_error=False so a missing header produces our own 401 shape rather than
# FastAPI's, keeping every auth failure indistinguishable from the outside.
bearer = HTTPBearer(auto_error=False)


async def current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> UUID:
    if credentials is None or not credentials.credentials.strip():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")

    user_id = await users_db.resolve_token(request.app.state.pool, credentials.credentials.strip())
    if user_id is None:
        # Covers every failure the same way: unknown token, revoked token, and
        # token belonging to a deleted user.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")
    return user_id
