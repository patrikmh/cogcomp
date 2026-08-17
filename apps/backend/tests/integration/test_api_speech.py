"""The speech endpoint over HTTP.

No key is configured in the suite, so what is testable here is the shape of the
contract and — more importantly — that an unconfigured server says so rather than
returning something that looks like working audio.
"""

import base64

import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account
from tlon.speech import SpeechError, clip_from_pcm

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


class TestUnconfigured:
    async def test_it_reports_that_speech_is_off_rather_than_failing_oddly(
        self, client: AsyncClient, account: Account
    ):
        response = await client.post(
            "/v1/voice/speak", headers=account.auth, json={"text": "hello"}
        )
        # 503, so the client can fall back to showing text rather than waiting on
        # audio that is never coming.
        assert response.status_code == 503

    async def test_it_never_returns_a_placeholder_clip(self, client: AsyncClient, account: Account):
        response = await client.post(
            "/v1/voice/speak", headers=account.auth, json={"text": "hello"}
        )
        # A stub beep would make a missing key look like a working feature.
        assert "audio" not in response.json()


class TestConfiguredFailure:
    async def test_provider_details_are_logged_but_not_returned(
        self, client: AsyncClient, account: Account, caplog
    ):
        class FailingVoice:
            enabled = True

            async def speak(self, text: str):
                raise SpeechError("upstream provider detail")

        app = client._transport.app
        original_voice = app.state.voice
        app.state.voice = FailingVoice()
        try:
            response = await client.post(
                "/v1/voice/speak", headers=account.auth, json={"text": "hello"}
            )
        finally:
            app.state.voice = original_voice

        assert response.status_code == 502
        assert response.json() == {"detail": "We could not generate audio. Please try again."}
        assert "upstream provider detail" in caplog.text


class TestValidation:
    async def test_speaking_requires_a_token(self, client: AsyncClient):
        response = await client.post("/v1/voice/speak", json={"text": "hello"})
        assert response.status_code == 401

    async def test_empty_text_is_rejected(self, client: AsyncClient, account: Account):
        response = await client.post("/v1/voice/speak", headers=account.auth, json={"text": ""})
        assert response.status_code == 422

    async def test_an_unbounded_reply_is_rejected(self, client: AsyncClient, account: Account):
        # Truncating beats an unbounded synthesis bill, and a reply this long is a
        # prompt problem rather than a transport one.
        response = await client.post(
            "/v1/voice/speak", headers=account.auth, json={"text": "a" * 5000}
        )
        assert response.status_code == 422


class TestTheContract:
    """The client's side of the sync depends on these exact fields."""

    async def test_a_clip_round_trips_through_base64(self):
        clip = clip_from_pcm(b"\x00\x10" * 44100)
        assert base64.b64decode(base64.b64encode(clip.audio)) == clip.audio

    async def test_the_envelope_and_duration_agree(self):
        clip = clip_from_pcm(b"\x00\x10" * 44100)
        assert clip.duration_ms == len(clip.envelope) * clip.frame_ms
