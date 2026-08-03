"""Sign-in rate limiting.

Until this existed the only thing between a guessed password and an account was
Argon2id's cost — real, but a constant an attacker can simply wait out.
"""

import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account, register
from tlon.db import login_attempts as attempts_db

pytestmark = [pytest.mark.anyio, pytest.mark.integration]

PASSWORD = "a sufficiently long passphrase"


async def attempt(client: AsyncClient, email: str, password: str):
    return await client.post(
        "/v1/auth/login",
        json={"email": email, "password": password, "device": "tests"},
    )


async def fail_repeatedly(client: AsyncClient, email: str, times: int) -> None:
    for _ in range(times):
        await attempt(client, email, "definitely the wrong password")


class TestLockout:
    async def test_a_few_wrong_guesses_are_tolerated(self, client: AsyncClient, account: Account):
        # People mistype passwords, and this is a journal someone may be reaching
        # for at a bad moment.
        await fail_repeatedly(client, account.email, attempts_db.MAX_FAILURES - 1)
        assert (await attempt(client, account.email, PASSWORD)).status_code == 200

    async def test_repeated_guessing_is_refused(self, client: AsyncClient, account: Account):
        await fail_repeatedly(client, account.email, attempts_db.MAX_FAILURES)
        response = await attempt(client, account.email, "wrong again")
        assert response.status_code == 429

    async def test_the_lockout_holds_even_with_the_right_password(
        self, client: AsyncClient, account: Account
    ):
        # Otherwise an attacker learns they have found the password at the very
        # moment the limit is supposed to stop them.
        await fail_repeatedly(client, account.email, attempts_db.MAX_FAILURES)
        assert (await attempt(client, account.email, PASSWORD)).status_code == 429

    async def test_success_clears_the_count(self, client: AsyncClient, account: Account):
        # Someone who mistyped a few times and then got it right must not be left
        # one typo away from a lockout.
        await fail_repeatedly(client, account.email, attempts_db.MAX_FAILURES - 1)
        assert (await attempt(client, account.email, PASSWORD)).status_code == 200
        await fail_repeatedly(client, account.email, 1)
        assert (await attempt(client, account.email, PASSWORD)).status_code == 200


class TestItIsNotAnExistenceOracle:
    async def test_unknown_addresses_are_rate_limited_too(self, client: AsyncClient, pool):
        # If only real accounts were limited, hitting a lockout would prove the
        # account exists — the very thing the constant-time password check is
        # there to prevent.
        unknown = "nobody-here@example.com"
        await fail_repeatedly(client, unknown, attempts_db.MAX_FAILURES)
        assert (await attempt(client, unknown, "whatever")).status_code == 429

    async def test_a_real_and_an_unknown_address_behave_alike(
        self, client: AsyncClient, account: Account
    ):
        unknown = "also-nobody@example.com"
        await fail_repeatedly(client, account.email, attempts_db.MAX_FAILURES)
        await fail_repeatedly(client, unknown, attempts_db.MAX_FAILURES)
        mine = await attempt(client, account.email, "x")
        theirs = await attempt(client, unknown, "x")
        assert mine.status_code == theirs.status_code == 429


class TestScope:
    async def test_one_locked_account_does_not_lock_another(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        await fail_repeatedly(client, account.email, attempts_db.MAX_FAILURES)
        assert (await attempt(client, other_account.email, PASSWORD)).status_code == 200

    async def test_capitalisation_does_not_reset_the_counter(self, client: AsyncClient):
        # Otherwise the limit is bypassed by holding down shift.
        lower = f"case-{id(object())}@example.com"
        await fail_repeatedly(client, lower, attempts_db.MAX_FAILURES)
        assert (await attempt(client, lower.upper(), "x")).status_code == 429


class TestStorage:
    async def test_the_address_is_not_stored_in_plain_text(self, client: AsyncClient, pool):
        # A login form accepts any address, so a plaintext column here would
        # become a log of whatever an attacker chose to type — including
        # addresses belonging to people who never signed up.
        typed = "someone-elses-address@example.com"
        await fail_repeatedly(client, typed, 2)
        stored = await pool.fetch("SELECT email_hash FROM login_attempts")
        assert stored
        assert all(typed not in row["email_hash"] for row in stored)

    async def test_old_attempts_can_be_pruned(self, client: AsyncClient, pool):
        from datetime import timedelta

        await fail_repeatedly(client, "prune-me@example.com", 3)
        # Nothing reads rows older than the window, so keeping them would make
        # this a permanent record of every address ever typed at the form.
        removed = await attempts_db.prune(pool, older_than=timedelta(seconds=-1))
        assert removed == 3

    async def test_signup_is_unaffected(self, client: AsyncClient):
        # The limit guards guessing at an existing password, not creating an
        # account.
        account = await register(client)
        assert account.token
