"""Voice entries over HTTP, against a real database."""

from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account

pytestmark = [pytest.mark.anyio, pytest.mark.integration]

AUDIO = b"not really audio, but the stub does not care"


async def upload(
    client: AsyncClient,
    account: Account,
    *,
    observation_id: str | None = None,
    audio: bytes = AUDIO,
    filename: str = "recording.m4a",
    captured_at: str | None = None,
    timezone: str | None = None,
):
    data = {"id": observation_id or str(uuid4())}
    if captured_at:
        data["captured_at"] = captured_at
    if timezone:
        data["timezone"] = timezone
    return await client.post(
        "/v1/observations/voice",
        headers=account.auth,
        data=data,
        files={"audio": (filename, audio, "audio/m4a")},
    )


class TestVoiceCapture:
    async def test_a_recording_becomes_an_observation(self, client: AsyncClient, account: Account):
        response = await upload(client, account)
        assert response.status_code == 201, response.text
        assert response.json()["source"] == "voice"

    async def test_a_spoken_entry_keeps_its_timezone_like_a_typed_one(
        self, client: AsyncClient, account: Account
    ):
        response = await upload(client, account, timezone="Europe/Stockholm")
        assert response.json()["timezone"] == "Europe/Stockholm"

    async def test_the_transcript_is_the_content(self, client: AsyncClient, account: Account):
        response = await upload(client, account)
        # The stub says what it is, which is exactly what should be stored.
        assert "not configured" in response.json()["content"]

    async def test_it_appears_in_the_journal_alongside_text_entries(
        self, client: AsyncClient, account: Account
    ):
        await upload(client, account)
        await client.post(
            "/v1/observations",
            headers=account.auth,
            json={"id": str(uuid4()), "content": "typed", "source": "text"},
        )
        listed = await client.get("/v1/observations", headers=account.auth)
        sources = {o["source"] for o in listed.json()["observations"]}
        assert sources == {"voice", "text"}

    async def test_a_voice_entry_can_be_extracted_like_any_other(
        self, client: AsyncClient, account: Account
    ):
        # Downstream of capture, source stops mattering — an observation is an
        # observation, and the pipeline should not care how it arrived.
        response = await upload(client, account)
        observation_id = response.json()["id"]
        extraction = await client.post(
            f"/v1/observations/{observation_id}/extract", headers=account.auth
        )
        assert extraction.status_code == 200
        assert extraction.json()["nodes"] >= 1

    async def test_a_repeated_id_is_a_conflict(self, client: AsyncClient, account: Account):
        observation_id = str(uuid4())
        assert (await upload(client, account, observation_id=observation_id)).status_code == 201
        second = await upload(client, account, observation_id=observation_id)
        assert second.status_code == 409

    async def test_captured_at_is_honoured(self, client: AsyncClient, account: Account):
        response = await upload(client, account, captured_at="2026-03-15T08:00:00+00:00")
        assert response.json()["captured_at"].startswith("2026-03-15T08:00")

    async def test_it_lands_in_the_daily_summary(self, client: AsyncClient, account: Account):
        await upload(client, account, captured_at="2026-03-15T08:00:00+00:00")
        summary = await client.get("/v1/summary/2026-03-15", headers=account.auth)
        body = summary.json()
        assert body["entry_count"] == 1
        assert body["observations"][0]["source"] == "voice"


class TestRejections:
    async def test_empty_audio_is_refused(self, client: AsyncClient, account: Account):
        response = await upload(client, account, audio=b"")
        # Nothing was said, so there is nothing to store.
        assert response.status_code == 502

    async def test_a_missing_file_is_refused(self, client: AsyncClient, account: Account):
        response = await client.post(
            "/v1/observations/voice", headers=account.auth, data={"id": str(uuid4())}
        )
        assert response.status_code == 422

    async def test_a_missing_id_is_refused(self, client: AsyncClient, account: Account):
        response = await client.post(
            "/v1/observations/voice",
            headers=account.auth,
            files={"audio": ("r.m4a", AUDIO, "audio/m4a")},
        )
        assert response.status_code == 422

    async def test_it_requires_authentication(self, client: AsyncClient):
        response = await client.post(
            "/v1/observations/voice",
            data={"id": str(uuid4())},
            files={"audio": ("r.m4a", AUDIO, "audio/m4a")},
        )
        assert response.status_code == 401


class TestAudioIsNotRetained:
    async def test_no_audio_is_written_to_the_database(self, client: AsyncClient, account: Account):
        # The transcript is the observation. Keeping the recording would mean
        # storing the user's voice next to their most private thoughts for
        # nothing the transcript does not already give us.
        await upload(client, account, audio=b"DISTINCTIVE-AUDIO-MARKER")
        pool = client._transport.app.state.pool

        tables = await pool.fetch("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
        assert "audio" not in {t["tablename"] for t in tables}

        stored = await pool.fetchval("SELECT content FROM observations LIMIT 1")
        assert "DISTINCTIVE-AUDIO-MARKER" not in stored

    async def test_no_column_anywhere_holds_bytes(self, client: AsyncClient, account: Account):
        await upload(client, account)
        pool = client._transport.app.state.pool
        blob_columns = await pool.fetch(
            """
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND data_type = 'bytea'
            """
        )
        assert list(blob_columns) == []


class TestIsolation:
    async def test_a_voice_entry_is_not_visible_to_another_user(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        await upload(client, account)
        listed = await client.get("/v1/observations", headers=other_account.auth)
        assert listed.json()["observations"] == []


class TestReadiness:
    async def test_ready_reports_the_active_transcriber(self, client: AsyncClient):
        body = (await client.get("/ready")).json()
        # Stub output must never be mistakable for a real transcript's provenance.
        assert body["transcriber"].endswith("/stub")
