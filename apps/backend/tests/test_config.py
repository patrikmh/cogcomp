"""Settings that decide which credential goes where.

`speech_api_key` used to not exist — TTS was built from `transcription_api_key`
directly, which is only ever an ElevenLabs key by coincidence. The moment
transcription was pointed at Groq or another OpenAI-compatible endpoint, that
key stopped being one ElevenLabs would accept, and spoken replies failed their
auth on every turn while transcription kept working — the exact "one voice
feature works, the other doesn't" split this file guards against.
"""

import pytest

from tlon.config import Settings
from tlon.transcription import build_transcriber

CREDENTIALS = (
    "DATABASE_URL",
    "TRANSCRIPTION_API_KEY",
    "ELEVENLABS_API_KEY",
    "GROQ_API_KEY",
    "OPENAI_COMPATIBLE_API_KEY",
    "OPENAI_API_KEY",
    "SPEECH_API_KEY",
    "SPEECH_VOICE_ID",
    "TRANSCRIPTION_PROVIDER",
)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    # Settings() reads the real process environment. Cleared so a developer's
    # own shell — or a previous test in the same run — never leaks into what
    # this one observes.
    for key in CREDENTIALS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgres://tlon:tlon@localhost:5433/tlon")


def settings(**env: str) -> Settings:
    import os

    for key, value in env.items():
        os.environ[key] = value
    try:
        # `_env_file=None`: this repo's `.env` must never leak into what a test
        # observes; only what `clean_env` and this call put in the environment
        # does.
        return Settings(_env_file=None)  # type: ignore[call-arg]
    finally:
        for key in env:
            del os.environ[key]


class TestSpeechApiKey:
    def test_falls_back_to_elevenlabs_api_key(self):
        # The common case: one ElevenLabs key covers transcription and speech
        # both, and nobody should have to set it twice.
        s = settings(ELEVENLABS_API_KEY="sk_shared")
        assert s.speech_api_key == "sk_shared"
        assert s.transcription_api_key == "sk_shared"

    def test_is_independent_of_a_groq_transcription_key(self):
        # Transcription on Groq, speech left unconfigured. `transcription_api_key`
        # is a Groq key here and must never leak into what TTS sends ElevenLabs.
        s = settings(
            TRANSCRIPTION_PROVIDER="openai",
            TRANSCRIPTION_API_KEY="gsk_groq_only",
        )
        assert s.transcription_api_key == "gsk_groq_only"
        assert s.speech_api_key == ""

    def test_speech_api_key_overrides_when_both_are_set(self):
        s = settings(
            TRANSCRIPTION_PROVIDER="openai",
            TRANSCRIPTION_API_KEY="gsk_groq_only",
            SPEECH_API_KEY="sk_elevenlabs_for_speech",
        )
        assert s.transcription_api_key == "gsk_groq_only"
        assert s.speech_api_key == "sk_elevenlabs_for_speech"


class TestProviderCredentialResolution:
    def test_unknown_provider_is_rejected_without_a_credential(self):
        config = settings(TRANSCRIPTION_PROVIDER="whisper.cpp")
        with pytest.raises(ValueError, match="unknown TRANSCRIPTION_PROVIDER"):
            build_transcriber(
                config.transcription_api_key,
                config.transcription_provider,
                config.transcription_base_url,
                config.transcription_model,
            )

    def test_openai_provider_uses_only_its_provider_fallback(self):
        s = settings(TRANSCRIPTION_PROVIDER="openai", GROQ_API_KEY="gsk_provider")
        assert s.transcription_api_key == "gsk_provider"

    def test_elevenlabs_provider_rejects_only_groq_key(self):
        with pytest.raises(ValueError, match="mismatched provider key"):
            settings(GROQ_API_KEY="gsk_provider")

    def test_openai_provider_rejects_only_elevenlabs_key(self):
        with pytest.raises(ValueError, match="mismatched provider key"):
            settings(TRANSCRIPTION_PROVIDER="openai", ELEVENLABS_API_KEY="xi_provider")


class TestUsesRealSpeech:
    def test_false_with_no_speech_key(self):
        s = settings(SPEECH_VOICE_ID="voice-1")
        assert s.uses_real_speech is False

    def test_false_with_no_voice_id(self):
        s = settings(ELEVENLABS_API_KEY="sk_shared")
        assert s.uses_real_speech is False

    def test_true_once_both_are_set(self):
        s = settings(ELEVENLABS_API_KEY="sk_shared", SPEECH_VOICE_ID="voice-1")
        assert s.uses_real_speech is True

    def test_a_groq_transcription_key_alone_does_not_count(self):
        # This is the regression itself: transcription fully configured, speech
        # not, and `uses_real_speech` must say so rather than reporting true off
        # a key TTS cannot actually use.
        s = settings(
            TRANSCRIPTION_PROVIDER="openai",
            TRANSCRIPTION_API_KEY="gsk_groq_only",
            SPEECH_VOICE_ID="voice-1",
        )
        assert s.uses_real_speech is False


class TestConversationModel:
    """The talk turn and the extractor want opposite things from a model, so
    they are allowed to disagree — but only when someone says so."""

    def test_the_conversation_falls_back_to_the_extractor_s_model(self):
        settings = Settings(database_url="postgres://x", openrouter_model="a/b")
        assert settings.conversation_model == ""
        assert (settings.conversation_model or settings.openrouter_model) == "a/b"

    def test_it_can_be_pointed_at_a_faster_model_on_its_own(self):
        settings = Settings(
            database_url="postgres://x",
            openrouter_model="a/slow",
            conversation_model="a/fast",
        )
        assert (settings.conversation_model or settings.openrouter_model) == "a/fast"
        # The extractor is untouched: being right matters more there than being quick.
        assert settings.openrouter_model == "a/slow"
