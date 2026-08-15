"""Integration test fixtures.

These run against a real Postgres. The invariants that matter most in this codebase —
the two-tier rule, provenance, user isolation — are enforced by CHECK constraints and
foreign keys, so a mocked database would verify nothing about them.

The suite uses its own database (`tlon_test`), created and dropped per session, so it
never touches development data.
"""

import os
from collections.abc import AsyncIterator
from uuid import UUID, uuid4

import asyncpg
import pytest
from httpx import ASGITransport, AsyncClient

DEV_URL = os.environ.get("DATABASE_URL", "postgres://tlon:tlon@localhost:5433/tlon")
TEST_DB = "tlon_test"


def _url_for(database: str) -> str:
    base, _, _ = DEV_URL.rpartition("/")
    return f"{base}/{database}".replace("postgres://", "postgresql://", 1)


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(scope="session")
async def test_database() -> AsyncIterator[str]:
    """Create a dedicated database for the run and drop it afterwards."""
    admin = await asyncpg.connect(_url_for("postgres"))
    try:
        await admin.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        await admin.execute(f'CREATE DATABASE "{TEST_DB}"')
    finally:
        await admin.close()

    yield _url_for(TEST_DB)

    admin = await asyncpg.connect(_url_for("postgres"))
    try:
        await admin.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
    finally:
        await admin.close()


@pytest.fixture(scope="session")
async def app(test_database: str):
    """The real FastAPI app, wired to the test database and the stub extractor.

    The stub keeps the suite deterministic and free of network calls. The live model
    path is exercised separately — see benchmarks/.
    """
    os.environ["DATABASE_URL"] = test_database
    # Every credential is cleared, not just the model one. A real key in .env
    # must never change what the suite exercises — tests that quietly start
    # calling a paid API are both slow and no longer testing this code.
    for credential in (
        "OPENROUTER_API_KEY",
        "TRANSCRIPTION_API_KEY",
        "ELEVENLABS_API_KEY",
        "GROQ_API_KEY",
        "SPEECH_API_KEY",
    ):
        os.environ[credential] = ""

    from tlon.config import get_settings

    get_settings.cache_clear()

    from tlon.main import app as fastapi_app

    return fastapi_app


@pytest.fixture
async def client(app) -> AsyncIterator[AsyncClient]:
    """An HTTP client against the app, with lifespan (pool + migrations) running."""
    from asgi_lifespan import LifespanManager

    async with (
        LifespanManager(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http,
    ):
        yield http


@pytest.fixture
async def pool(app) -> asyncpg.Pool:
    return app.state.pool


@pytest.fixture(autouse=True)
async def clean_tables(client) -> AsyncIterator[None]:
    """Truncate between tests so each starts from an empty graph.

    Depends on `client` so the pool exists; TRUNCATE ... CASCADE reaches every table
    through the foreign keys from `users`.
    """
    yield
    # `login_attempts` deliberately has no foreign key to users — attempts
    # against addresses with no account must be counted too — so the cascade
    # does not reach it and it has to be named. Left out, one test's failed
    # sign-ins could lock an address a later test tries to use.
    await client._transport.app.state.pool.execute("TRUNCATE users, login_attempts CASCADE")


class Account:
    """A signed-up user plus its bearer token."""

    def __init__(self, user_id: UUID, token: str, email: str) -> None:
        self.user_id = user_id
        self.token = token
        self.email = email

    @property
    def auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}


async def register(client: AsyncClient, email: str | None = None) -> Account:
    email = email or f"user-{uuid4().hex[:12]}@example.com"
    response = await client.post(
        "/v1/auth/signup",
        json={"email": email, "password": "a sufficiently long passphrase", "device": "tests"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    return Account(UUID(body["user_id"]), body["token"], email)


@pytest.fixture
async def account(client: AsyncClient) -> Account:
    return await register(client)


@pytest.fixture
async def other_account(client: AsyncClient) -> Account:
    return await register(client)
