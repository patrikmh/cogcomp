"""Conversational journalling over HTTP, against a real database."""

from datetime import UTC
from uuid import uuid4

import pytest
from asyncpg.exceptions import CheckViolationError
from httpx import AsyncClient

from tests.integration.conftest import Account

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


async def start(client: AsyncClient, account: Account) -> str:
    response = await client.post("/v1/conversations", headers=account.auth)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def say(
    client: AsyncClient,
    account: Account,
    cid: str,
    text: str,
    source="text",
    timezone: str | None = None,
):
    return await client.post(
        f"/v1/conversations/{cid}/turns",
        headers=account.auth,
        json={"content": text, "source": source, "timezone": timezone},
    )


class TestConversationFlow:
    async def test_a_conversation_can_be_started(self, client: AsyncClient, account: Account):
        response = await client.post("/v1/conversations", headers=account.auth)
        assert response.status_code == 201
        assert response.json()["agent"].startswith("converse-v0.1/")

    async def test_a_turn_gets_a_reply(self, client: AsyncClient, account: Account):
        cid = await start(client, account)
        response = await say(client, account, cid, "I had a rough day.")
        assert response.status_code == 200
        assert response.json()["reply"]

    async def test_both_speakers_are_recorded(self, client: AsyncClient, account: Account):
        cid = await start(client, account)
        await say(client, account, cid, "I had a rough day.")
        body = (await client.get(f"/v1/conversations/{cid}", headers=account.auth)).json()
        assert [t["speaker"] for t in body["turns"]] == ["user", "assistant"]

    async def test_a_blank_turn_is_refused(self, client: AsyncClient, account: Account):
        cid = await start(client, account)
        assert (await say(client, account, cid, "   ")).status_code == 422

    async def test_turns_are_ordered(self, client: AsyncClient, account: Account):
        cid = await start(client, account)
        for text in ("first", "second", "third"):
            await say(client, account, cid, text)
        body = (await client.get(f"/v1/conversations/{cid}", headers=account.auth)).json()
        said = [t["content"] for t in body["turns"] if t["speaker"] == "user"]
        assert said == ["first", "second", "third"]


class TestOnlyUserTurnsBecomeObservations:
    """The rule the explain screen depends on.

    If the agent's phrasing could become an observation, an inference could cite
    the model to the user as though it were their own thought.
    """

    async def test_closing_converts_only_the_users_turns(
        self, client: AsyncClient, account: Account
    ):
        cid = await start(client, account)
        await say(client, account, cid, "I told Sara I would finish the report.")
        await say(client, account, cid, "I still have not started it.")

        closed = await client.post(f"/v1/conversations/{cid}/close", headers=account.auth)
        assert closed.status_code == 200
        assert closed.json()["turns_converted"] == 2

        # One entry for the conversation, holding both turns verbatim. Kept as
        # two the record filled with fragments that only made sense in order.
        listed = await client.get("/v1/observations", headers=account.auth)
        observations = listed.json()["observations"]
        assert len(observations) == 1
        assert observations[0]["content"] == (
            "I told Sara I would finish the report.\n\nI still have not started it."
        )

    async def test_no_assistant_text_ever_reaches_the_observations_table(
        self, client: AsyncClient, account: Account
    ):
        cid = await start(client, account)
        await say(client, account, cid, "something happened")
        body = (await client.get(f"/v1/conversations/{cid}", headers=account.auth)).json()
        agent_said = [t["content"] for t in body["turns"] if t["speaker"] == "assistant"]

        await client.post(f"/v1/conversations/{cid}/close", headers=account.auth)

        stored = await client._transport.app.state.pool.fetch("SELECT content FROM observations")
        stored_contents = {r["content"] for r in stored}
        for line in agent_said:
            assert line not in stored_contents

    async def test_the_database_refuses_to_link_an_assistant_turn_to_an_observation(
        self, client: AsyncClient, account: Account
    ):
        # Belt and braces: even if the conversion code changed, the schema says no.
        cid = await start(client, account)
        await say(client, account, cid, "hello")
        pool = client._transport.app.state.pool

        assistant_turn = await pool.fetchval(
            "SELECT id FROM conversation_turns WHERE speaker = 'assistant' LIMIT 1"
        )
        observation_id = await pool.fetchval(
            "INSERT INTO graph_nodes (id, user_id, kind, label) "
            "VALUES (gen_random_uuid(), $1, 'Observation', 'x') RETURNING id",
            account.user_id,
        )
        await pool.execute(
            "INSERT INTO observations (node_id, user_id, content, source, captured_at) "
            "VALUES ($1, $2, 'x', 'text', now())",
            observation_id,
            account.user_id,
        )

        with pytest.raises(CheckViolationError, match="only_user_turns_are_observed"):
            await pool.execute(
                "UPDATE conversation_turns SET observation_id = $1 WHERE id = $2",
                observation_id,
                assistant_turn,
            )

    async def test_each_turn_becomes_its_own_entry(self, client: AsyncClient, account: Account):
        # Merging them would produce an entry the person never wrote.
        cid = await start(client, account)
        for text in ("one", "two", "three"):
            await say(client, account, cid, text)
        closed = await client.post(f"/v1/conversations/{cid}/close", headers=account.auth)
        assert len(closed.json()["observations"]) == 3

    async def test_converted_turns_link_to_their_observation(
        self, client: AsyncClient, account: Account
    ):
        cid = await start(client, account)
        await say(client, account, cid, "something")
        await client.post(f"/v1/conversations/{cid}/close", headers=account.auth)

        body = (await client.get(f"/v1/conversations/{cid}", headers=account.auth)).json()
        for turn in body["turns"]:
            if turn["speaker"] == "user":
                assert turn["observation_id"]
            else:
                assert turn["observation_id"] is None

    async def test_a_turn_carries_its_timezone_into_the_entry_it_becomes(
        self, client: AsyncClient, account: Account
    ):
        # The turn is the moment that becomes an entry, so the zone travels with
        # the turn rather than with the conversation: a conversation left open
        # across a flight would otherwise date its later turns from where it
        # started.
        cid = await start(client, account)
        await say(client, account, cid, "I said this at midnight", timezone="Europe/Stockholm")
        await client.post(f"/v1/conversations/{cid}/close", headers=account.auth)

        listed = await client.get("/v1/observations", headers=account.auth)

        assert listed.json()["observations"][0]["timezone"] == "Europe/Stockholm"

    async def test_a_spoken_turn_is_recorded_as_a_voice_observation(
        self, client: AsyncClient, account: Account
    ):
        cid = await start(client, account)
        await say(client, account, cid, "I said this out loud", source="voice")
        await client.post(f"/v1/conversations/{cid}/close", headers=account.auth)
        listed = await client.get("/v1/observations", headers=account.auth)
        assert listed.json()["observations"][0]["source"] == "voice"


class TestClosing:
    async def test_a_closed_conversation_takes_no_more_turns(
        self, client: AsyncClient, account: Account
    ):
        cid = await start(client, account)
        await say(client, account, cid, "hello")
        await client.post(f"/v1/conversations/{cid}/close", headers=account.auth)
        assert (await say(client, account, cid, "more")).status_code == 409

    async def test_closing_twice_is_refused(self, client: AsyncClient, account: Account):
        cid = await start(client, account)
        await say(client, account, cid, "hello")
        await client.post(f"/v1/conversations/{cid}/close", headers=account.auth)
        second = await client.post(f"/v1/conversations/{cid}/close", headers=account.auth)
        assert second.status_code == 409

    async def test_an_empty_conversation_closes_without_creating_entries(
        self, client: AsyncClient, account: Account
    ):
        # Opening the screen and changing your mind should leave no trace.
        cid = await start(client, account)
        closed = await client.post(f"/v1/conversations/{cid}/close", headers=account.auth)
        assert closed.json()["turns_converted"] == 0
        listed = await client.get("/v1/observations", headers=account.auth)
        assert listed.json()["observations"] == []

    async def test_converted_entries_flow_into_the_daily_summary(
        self, client: AsyncClient, account: Account
    ):
        cid = await start(client, account)
        await say(client, account, cid, "a thing I said")
        await client.post(f"/v1/conversations/{cid}/close", headers=account.auth)

        from datetime import datetime

        today = datetime.now(UTC).date().isoformat()
        summary = await client.get(f"/v1/summary/{today}", headers=account.auth)
        assert summary.json()["entry_count"] == 1


class TestCrisisResources:
    async def test_no_resources_are_attached_to_an_ordinary_reply(
        self, client: AsyncClient, account: Account
    ):
        cid = await start(client, account)
        body = (await say(client, account, cid, "just a normal day")).json()
        assert body["crisis"] is False
        assert body["crisis_resources"] == []

    async def test_resources_are_parsed_from_configuration(self, client: AsyncClient):
        # Config rather than hardcoded, so they can be right for the user's country.
        settings = client._transport.app.state.settings
        settings.crisis_resources = "Mind 90101|112 for emergencies"
        assert settings.crisis_resources_list == ["Mind 90101", "112 for emergencies"]
        settings.crisis_resources = ""

    async def test_blank_configuration_yields_no_resources(self, client: AsyncClient):
        settings = client._transport.app.state.settings
        settings.crisis_resources = ""
        assert settings.crisis_resources_list == []


class TestIsolation:
    async def test_another_user_cannot_read_a_conversation(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        cid = await start(client, account)
        await say(client, account, cid, "private")
        response = await client.get(f"/v1/conversations/{cid}", headers=other_account.auth)
        assert response.status_code == 404

    async def test_another_user_cannot_add_a_turn(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        cid = await start(client, account)
        assert (await say(client, other_account, cid, "intruding")).status_code == 404

    async def test_another_user_cannot_close_it(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        cid = await start(client, account)
        response = await client.post(f"/v1/conversations/{cid}/close", headers=other_account.auth)
        assert response.status_code == 404

    async def test_conversations_are_not_listed_across_users(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        await start(client, account)
        listed = await client.get("/v1/conversations", headers=other_account.auth)
        assert listed.json()["conversations"] == []

    async def test_the_endpoints_require_authentication(self, client: AsyncClient):
        assert (await client.post("/v1/conversations")).status_code == 401
        assert (await client.get("/v1/conversations")).status_code == 401
        assert (await client.get(f"/v1/conversations/{uuid4()}")).status_code == 401


class TestVoiceToken:
    async def test_it_is_unavailable_without_transcription_configured(
        self, client: AsyncClient, account: Account
    ):
        # The suite runs with credentials cleared, so this is the configured state.
        response = await client.post("/v1/voice/token", headers=account.auth)
        assert response.status_code == 503

    async def test_it_requires_authentication(self, client: AsyncClient):
        assert (await client.post("/v1/voice/token")).status_code == 401


class TestSpokenTurns:
    """A spoken turn takes the same path as a typed one — same conversation,
    entered differently, not a separate feature with its own rules."""

    AUDIO = b"not really audio, but the stub does not care"

    async def speak(self, client: AsyncClient, account: Account, cid: str, audio=None):
        return await client.post(
            f"/v1/conversations/{cid}/turns/voice",
            headers=account.auth,
            files={"audio": ("r.m4a", audio if audio is not None else self.AUDIO, "audio/m4a")},
        )

    async def test_a_spoken_turn_gets_a_reply(self, client: AsyncClient, account: Account):
        cid = await start(client, account)
        response = await self.speak(client, account, cid)
        assert response.status_code == 200, response.text
        assert response.json()["reply"]

    async def test_the_transcript_becomes_the_turn(self, client: AsyncClient, account: Account):
        cid = await start(client, account)
        await self.speak(client, account, cid)
        body = (await client.get(f"/v1/conversations/{cid}", headers=account.auth)).json()
        spoken = next(t for t in body["turns"] if t["speaker"] == "user")
        assert "not configured" in spoken["content"]
        assert spoken["source"] == "voice"

    async def test_it_becomes_a_voice_observation_on_close(
        self, client: AsyncClient, account: Account
    ):
        cid = await start(client, account)
        await self.speak(client, account, cid)
        await client.post(f"/v1/conversations/{cid}/close", headers=account.auth)
        listed = await client.get("/v1/observations", headers=account.auth)
        assert listed.json()["observations"][0]["source"] == "voice"

    async def test_spoken_and_typed_turns_mix_in_one_conversation(
        self, client: AsyncClient, account: Account
    ):
        cid = await start(client, account)
        await say(client, account, cid, "typed first")
        await self.speak(client, account, cid)
        body = (await client.get(f"/v1/conversations/{cid}", headers=account.auth)).json()
        sources = [t["source"] for t in body["turns"] if t["speaker"] == "user"]
        assert sources == ["text", "voice"]

    async def test_empty_audio_is_refused(self, client: AsyncClient, account: Account):
        cid = await start(client, account)
        assert (await self.speak(client, account, cid, audio=b"")).status_code == 502

    async def test_a_closed_conversation_refuses_a_spoken_turn(
        self, client: AsyncClient, account: Account
    ):
        cid = await start(client, account)
        await say(client, account, cid, "hello")
        await client.post(f"/v1/conversations/{cid}/close", headers=account.auth)
        assert (await self.speak(client, account, cid)).status_code == 409

    async def test_another_user_cannot_speak_into_it(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        cid = await start(client, account)
        assert (await self.speak(client, other_account, cid)).status_code == 404

    async def test_it_requires_authentication(self, client: AsyncClient, account: Account):
        cid = await start(client, account)
        response = await client.post(
            f"/v1/conversations/{cid}/turns/voice",
            files={"audio": ("r.m4a", self.AUDIO, "audio/m4a")},
        )
        assert response.status_code == 401

    async def test_no_audio_is_retained(self, client: AsyncClient, account: Account):
        cid = await start(client, account)
        await self.speak(client, account, cid, audio=b"DISTINCTIVE-CONVERSATION-AUDIO")
        rows = await client._transport.app.state.pool.fetch(
            "SELECT content FROM conversation_turns"
        )
        for row in rows:
            assert "DISTINCTIVE-CONVERSATION-AUDIO" not in row["content"]


def parse_sse(body: str) -> list[dict]:
    """The events out of a `text/event-stream` body, in order."""
    import json

    return [
        json.loads(line[len("data: ") :])
        for line in body.splitlines()
        if line.startswith("data: ")
    ]


class TestStreamedTurn:
    """The streaming turn has to agree with the plain one about everything that
    is not its timing. Two ways to say the same thing is two ways to get the
    safety rules wrong, so the agreement is what these check."""

    async def stream(self, client: AsyncClient, account: Account, cid: str, text: str):
        response = await client.post(
            f"/v1/conversations/{cid}/turns/stream",
            headers=account.auth,
            json={"content": text, "source": "text", "timezone": None},
        )
        return response, parse_sse(response.text)

    async def test_a_turn_streams_a_reply(self, client: AsyncClient, account: Account):
        cid = await start(client, account)
        response, events = await self.stream(client, account, cid, "hello")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert events[-1]["type"] == "done"
        assert events[-1]["reply"]

    async def test_the_pieces_add_up_to_the_reply(self, client: AsyncClient, account: Account):
        cid = await start(client, account)
        _, events = await self.stream(client, account, cid, "hello")
        deltas = "".join(e["text"] for e in events if e["type"] == "delta")
        assert deltas == events[-1]["reply"]

    async def test_both_speakers_are_recorded(self, client: AsyncClient, account: Account):
        cid = await start(client, account)
        _, events = await self.stream(client, account, cid, "hello")
        body = (await client.get(f"/v1/conversations/{cid}", headers=account.auth)).json()
        assert [t["speaker"] for t in body["turns"]] == ["user", "assistant"]
        assert body["turns"][1]["content"] == events[-1]["reply"]

    async def test_a_blank_turn_is_refused_before_anything_streams(
        self, client: AsyncClient, account: Account
    ):
        cid = await start(client, account)
        response, _ = await self.stream(client, account, cid, "   ")
        assert response.status_code == 422

    async def test_a_closed_conversation_refuses_a_streamed_turn(
        self, client: AsyncClient, account: Account
    ):
        cid = await start(client, account)
        await say(client, account, cid, "hello")
        await client.post(f"/v1/conversations/{cid}/close", headers=account.auth)
        response, _ = await self.stream(client, account, cid, "again")
        assert response.status_code == 409

    async def test_a_stranger_cannot_stream_into_someone_elses_conversation(
        self, client: AsyncClient, account: Account
    ):
        response = await client.post(
            f"/v1/conversations/{uuid4()}/turns/stream",
            headers=account.auth,
            json={"content": "hello", "source": "text", "timezone": None},
        )
        assert response.status_code == 404

    async def test_the_crisis_marker_never_appears_in_the_stream(
        self, client: AsyncClient, account: Account
    ):
        # Whatever the agent is, no delta may carry the marker: it is for the
        # application, and showing it to the person it is about is the one
        # outcome the whole mechanism exists to prevent.
        cid = await start(client, account)
        _, events = await self.stream(client, account, cid, "i want to hurt myself")
        assert all("[CRISIS]" not in e.get("text", "") for e in events)
        assert "[CRISIS]" not in events[-1]["reply"]
