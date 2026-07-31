"""Authentication over HTTP, against a real database."""

from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account, register

pytestmark = [pytest.mark.anyio, pytest.mark.integration]

PASSWORD = "a sufficiently long passphrase"


class TestSignup:
    async def test_signup_returns_a_usable_token(self, client: AsyncClient):
        account = await register(client)
        response = await client.get("/v1/auth/me", headers=account.auth)
        assert response.status_code == 200
        assert response.json()["user_id"] == str(account.user_id)

    async def test_email_is_normalized(self, client: AsyncClient):
        response = await client.post(
            "/v1/auth/signup",
            json={"email": "  MixedCase@Example.COM ", "password": PASSWORD},
        )
        assert response.status_code == 201
        me = await client.get(
            "/v1/auth/me", headers={"Authorization": f"Bearer {response.json()['token']}"}
        )
        assert me.json()["email"] == "mixedcase@example.com"

    async def test_duplicate_email_is_rejected_case_insensitively(self, client: AsyncClient):
        await register(client, "taken@example.com")
        response = await client.post(
            "/v1/auth/signup", json={"email": "TAKEN@example.com", "password": PASSWORD}
        )
        assert response.status_code == 409

    async def test_short_password_is_rejected(self, client: AsyncClient):
        response = await client.post(
            "/v1/auth/signup", json={"email": "a@example.com", "password": "short"}
        )
        assert response.status_code == 422

    async def test_invalid_email_is_rejected(self, client: AsyncClient):
        response = await client.post(
            "/v1/auth/signup", json={"email": "not-an-email", "password": PASSWORD}
        )
        assert response.status_code == 422

    async def test_the_password_is_never_stored_in_plaintext(
        self, client: AsyncClient, account: Account
    ):
        stored = await client._transport.app.state.pool.fetchval(
            "SELECT password_hash FROM users WHERE id = $1", account.user_id
        )
        assert PASSWORD not in stored
        assert stored.startswith("$argon2id$")

    async def test_the_token_is_never_stored_in_plaintext(
        self, client: AsyncClient, account: Account
    ):
        rows = await client._transport.app.state.pool.fetch("SELECT token_hash FROM api_tokens")
        for row in rows:
            assert account.token not in row["token_hash"]
            assert len(row["token_hash"]) == 64  # sha256 hex


class TestLogin:
    async def test_login_issues_a_second_independent_token(
        self, client: AsyncClient, account: Account
    ):
        response = await client.post(
            "/v1/auth/login",
            json={"email": account.email, "password": PASSWORD, "device": "phone"},
        )
        assert response.status_code == 200
        assert response.json()["token"] != account.token

    async def test_login_is_case_insensitive_on_email(self, client: AsyncClient, account: Account):
        response = await client.post(
            "/v1/auth/login", json={"email": account.email.upper(), "password": PASSWORD}
        )
        assert response.status_code == 200

    async def test_wrong_password_is_rejected(self, client: AsyncClient, account: Account):
        response = await client.post(
            "/v1/auth/login", json={"email": account.email, "password": "wrong wrong wrong"}
        )
        assert response.status_code == 401

    async def test_unknown_account_is_indistinguishable_from_wrong_password(
        self, client: AsyncClient, account: Account
    ):
        # Same status and same body, so neither tells an attacker whether an
        # address is registered.
        unknown = await client.post(
            "/v1/auth/login",
            json={"email": "nobody@example.com", "password": "wrong wrong wrong"},
        )
        wrong = await client.post(
            "/v1/auth/login", json={"email": account.email, "password": "wrong wrong wrong"}
        )
        assert unknown.status_code == wrong.status_code == 401
        assert unknown.json() == wrong.json()


class TestTokens:
    async def test_no_token_is_rejected(self, client: AsyncClient):
        assert (await client.get("/v1/auth/me")).status_code == 401

    async def test_a_garbage_token_is_rejected(self, client: AsyncClient):
        response = await client.get(
            "/v1/auth/me", headers={"Authorization": "Bearer not-a-real-token"}
        )
        assert response.status_code == 401

    async def test_logout_revokes_only_this_device(self, client: AsyncClient, account: Account):
        second = await client.post(
            "/v1/auth/login",
            json={"email": account.email, "password": PASSWORD, "device": "phone"},
        )
        phone = {"Authorization": f"Bearer {second.json()['token']}"}

        assert (await client.post("/v1/auth/logout", headers=account.auth)).status_code == 204
        assert (await client.get("/v1/auth/me", headers=account.auth)).status_code == 401
        assert (await client.get("/v1/auth/me", headers=phone)).status_code == 200

    async def test_sessions_lists_live_tokens_only(self, client: AsyncClient, account: Account):
        await client.post(
            "/v1/auth/login",
            json={"email": account.email, "password": PASSWORD, "device": "phone"},
        )
        listed = await client.get("/v1/auth/sessions", headers=account.auth)
        labels = {s["label"] for s in listed.json()["sessions"]}
        assert labels == {"tests", "phone"}

    async def test_logout_everywhere_revokes_every_token(
        self, client: AsyncClient, account: Account
    ):
        second = await client.post(
            "/v1/auth/login",
            json={"email": account.email, "password": PASSWORD, "device": "phone"},
        )
        phone = {"Authorization": f"Bearer {second.json()['token']}"}

        response = await client.post("/v1/auth/logout-everywhere", headers=account.auth)
        assert response.json()["revoked"] == 2
        assert (await client.get("/v1/auth/me", headers=account.auth)).status_code == 401
        assert (await client.get("/v1/auth/me", headers=phone)).status_code == 401

    async def test_last_used_at_is_recorded(self, client: AsyncClient, account: Account):
        await client.get("/v1/auth/me", headers=account.auth)
        listed = await client.get("/v1/auth/sessions", headers=account.auth)
        assert listed.json()["sessions"][0]["last_used_at"] is not None


class TestPasswordChange:
    async def test_it_revokes_other_sessions_and_returns_a_fresh_token(
        self, client: AsyncClient, account: Account
    ):
        second = await client.post(
            "/v1/auth/login",
            json={"email": account.email, "password": PASSWORD, "device": "phone"},
        )
        phone = {"Authorization": f"Bearer {second.json()['token']}"}

        response = await client.post(
            "/v1/auth/change-password",
            headers=account.auth,
            json={"current_password": PASSWORD, "new_password": "an entirely new passphrase"},
        )
        assert response.status_code == 200
        fresh = {"Authorization": f"Bearer {response.json()['token']}"}

        # A password change is usually a response to compromise, so every prior
        # session dies — including the one that made the request.
        assert (await client.get("/v1/auth/me", headers=account.auth)).status_code == 401
        assert (await client.get("/v1/auth/me", headers=phone)).status_code == 401
        assert (await client.get("/v1/auth/me", headers=fresh)).status_code == 200

    async def test_the_new_password_works_and_the_old_one_does_not(
        self, client: AsyncClient, account: Account
    ):
        await client.post(
            "/v1/auth/change-password",
            headers=account.auth,
            json={"current_password": PASSWORD, "new_password": "an entirely new passphrase"},
        )
        old = await client.post(
            "/v1/auth/login", json={"email": account.email, "password": PASSWORD}
        )
        new = await client.post(
            "/v1/auth/login",
            json={"email": account.email, "password": "an entirely new passphrase"},
        )
        assert old.status_code == 401
        assert new.status_code == 200

    async def test_a_wrong_current_password_is_rejected(
        self, client: AsyncClient, account: Account
    ):
        response = await client.post(
            "/v1/auth/change-password",
            headers=account.auth,
            json={"current_password": "not the password", "new_password": "another long one"},
        )
        assert response.status_code == 401

    async def test_a_weak_new_password_is_rejected(self, client: AsyncClient, account: Account):
        response = await client.post(
            "/v1/auth/change-password",
            headers=account.auth,
            json={"current_password": PASSWORD, "new_password": "short"},
        )
        assert response.status_code == 422


class TestDeletedUser:
    async def test_a_soft_deleted_users_tokens_stop_working(
        self, client: AsyncClient, account: Account
    ):
        # Deleting the account must not require hunting down every issued token.
        await client._transport.app.state.pool.execute(
            "UPDATE users SET deleted_at = now() WHERE id = $1", account.user_id
        )
        assert (await client.get("/v1/auth/me", headers=account.auth)).status_code == 401

    async def test_an_unknown_user_id_cannot_be_forged(self, client: AsyncClient):
        # There is no route that accepts a user id from the client; identity comes
        # only from the token. This guards against that changing by accident.
        response = await client.get("/v1/auth/me", headers={"Authorization": f"Bearer {uuid4()}"})
        assert response.status_code == 401
