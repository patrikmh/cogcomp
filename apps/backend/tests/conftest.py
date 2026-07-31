import pytest


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    """anyio runs async tests on asyncio only — trio is not a target here."""
    return "asyncio"
