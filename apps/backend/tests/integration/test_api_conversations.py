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


async def say(client: AsyncClient, account: Account, cid: str, text: str, source="text"):
    return await client.post(
        f"/v1/conversations/{cid}/turns",
        headers=account.auth,
        json={"content": text, "source": source},
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

        listed = await client.get("/v1/observations", headers=account.auth)
        contents = {o["content"] for o in listed.json()["observations"]}
        assert contents == {
            "I told Sara I would finish the report.",
            "I still have not started it.",
        }

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
