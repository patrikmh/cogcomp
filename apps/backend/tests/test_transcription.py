"""Transcription behaviour that does not need a network."""

import pytest

from tlon.transcription import (
    MAX_AUDIO_BYTES,
    AudioTooLarge,
    ElevenLabsTranscriber,
    StubTranscriber,
    TranscriptionError,
    WhisperTranscriber,
    _read_transcript,
    build_transcriber,
)

pytestmark = pytest.mark.anyio


class TestStubTranscriber:
    async def test_it_returns_a_transcript(self):
        assert await StubTranscriber().transcribe(b"audio bytes", "r.m4a")

    async def test_it_announces_that_it_is_a_stub(self):
        # A placeholder that read like real speech could end up in someone's graph
        # indistinguishable from something they actually said.
        transcript = await StubTranscriber().transcribe(b"x", "r.m4a")
        assert "not configured" in transcript

    async def test_empty_audio_is_rejected(self):
        with pytest.raises(TranscriptionError):
            await StubTranscriber().transcribe(b"", "r.m4a")

    async def test_oversized_audio_is_rejected(self):
        with pytest.raises(AudioTooLarge):
            await StubTranscriber().transcribe(b"x" * (MAX_AUDIO_BYTES + 1), "r.m4a")

    async def test_its_version_is_distinguishable_from_a_real_model(self):
        assert StubTranscriber().version.endswith("/stub")


class TestWhisperTranscriber:
    async def test_empty_audio_is_rejected_before_any_request(self):
        # No key is configured here, so reaching the network would fail loudly.
        # Rejecting first is what makes this test meaningful.
        with pytest.raises(TranscriptionError):
            await WhisperTranscriber("k").transcribe(b"", "r.m4a")

    async def test_oversized_audio_is_rejected_before_any_request(self):
        with pytest.raises(AudioTooLarge):
            await WhisperTranscriber("k").transcribe(b"x" * (MAX_AUDIO_BYTES + 1), "r.m4a")

    def test_the_version_names_the_model(self):
        assert WhisperTranscriber("k", model="whisper-large-v3").version == (
            "transcribe-v0.1/whisper-large-v3"
        )

    def test_a_trailing_slash_on_the_base_url_does_not_double_up(self):
        transcriber = WhisperTranscriber("k", base_url="https://example.com/v1/")
        assert transcriber._base_url == "https://example.com/v1"


class TestElevenLabsTranscriber:
    async def test_empty_audio_is_rejected_before_any_request(self):
        with pytest.raises(TranscriptionError):
            await ElevenLabsTranscriber("k").transcribe(b"", "r.m4a")

    async def test_oversized_audio_is_rejected_before_any_request(self):
        with pytest.raises(AudioTooLarge):
            await ElevenLabsTranscriber("k").transcribe(b"x" * (MAX_AUDIO_BYTES + 1), "r.m4a")

    def test_the_version_names_the_provider_and_model(self):
        # Provenance again: a transcript should be traceable to what produced it.
        assert ElevenLabsTranscriber("k").version == "transcribe-v0.1/elevenlabs/scribe_v1"


class TestReadTranscript:
    def test_only_the_text_is_kept(self):
        # ElevenLabs also returns per-word timings and a detected language.
        # Storing those would be a far more precise record of how someone spoke
        # than the journal needs.
        payload = {
            "text": "  I slept badly.  ",
            "language_code": "eng",
            "words": [{"text": "I", "start": 0.0, "end": 0.1}],
        }
        assert _read_transcript(payload) == "I slept badly."

    def test_silence_is_reported_rather_than_stored_as_an_empty_entry(self):
        with pytest.raises(TranscriptionError, match="no speech"):
            _read_transcript({"text": "   "})

    def test_an_unexpected_shape_is_rejected(self):
        with pytest.raises(TranscriptionError):
            _read_transcript({"transcript": "wrong key"})


class TestBuildTranscriber:
    def test_a_blank_key_falls_back_to_the_stub(self):
        # The voice path stays exercisable in development without a key.
        assert isinstance(build_transcriber("", "elevenlabs", "url", ""), StubTranscriber)
        assert isinstance(build_transcriber("   ", "elevenlabs", "url", ""), StubTranscriber)

    def test_elevenlabs_is_selected_by_provider(self):
        transcriber = build_transcriber("key", "elevenlabs", "", "")
        assert isinstance(transcriber, ElevenLabsTranscriber)

    def test_the_openai_compatible_provider_is_selected_by_provider(self):
        for name in ("openai", "groq", "OpenAI"):
            transcriber = build_transcriber("key", name, "https://example.com/v1", "")
            assert isinstance(transcriber, WhisperTranscriber), name

    def test_a_blank_model_falls_back_to_the_providers_default(self):
        assert build_transcriber("key", "elevenlabs", "", "").version.endswith("scribe_v1")

    def test_an_unknown_provider_fails_loudly(self):
        # Silently picking the wrong provider would surface much later as a
        # confusing authentication error.
        with pytest.raises(ValueError, match="unknown TRANSCRIPTION_PROVIDER"):
            build_transcriber("key", "whisper.cpp", "", "")
