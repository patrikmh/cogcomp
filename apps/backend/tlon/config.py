from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    bind_address: str = "0.0.0.0:8080"
    log_level: str = "INFO"

    #: Absent in development. Without it the app runs the stub extractor, so the
    #: pipeline is exercisable without a key or a network call.
    openrouter_api_key: str = ""
    openrouter_model: str = "anthropic/claude-opus-5"

    #: Hosted Whisper, for voice entries. Absent in development, in which case the
    #: stub transcriber keeps the voice path exercisable without a key.
    #: Accepts the provider-specific name too, since ELEVENLABS_API_KEY is what
    #: their dashboard hands you and renaming it on the way in is a papercut.
    transcription_api_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "TRANSCRIPTION_API_KEY", "ELEVENLABS_API_KEY", "GROQ_API_KEY"
        ),
    )
    #: "elevenlabs" or "openai" — they do not share a request shape, so this
    #: selects an implementation rather than just a URL.
    transcription_provider: str = "elevenlabs"
    #: Only used by the openai-compatible provider.
    transcription_base_url: str = "https://api.groq.com/openai/v1"
    #: Blank means the provider's own default model.
    transcription_model: str = ""

    #: Text to speech, so the agent can be listened to rather than read. Shares
    #: the ElevenLabs key with transcription; the voice must be chosen explicitly
    #: because there is no sensible default for what someone's companion sounds
    #: like, and picking one silently is a strange thing to do to a person.
    speech_voice_id: str = ""
    speech_model: str = "eleven_multilingual_v2"

    #: Whether background agents run on a timer. Off by default: a system that
    #: rewrites your graph on a schedule should be something you switched on, and
    #: it keeps test and CI processes from doing background work nobody asked for.
    agents_enabled: bool = False

    #: Shown alongside the agent's message when the safety path fires. Config
    #: rather than hardcoded: a US hotline shown to someone in Sweden is worse
    #: than showing nothing, because it looks like help and is not.
    #: Newline- or pipe-separated, e.g.
    #: "Mind Självmordslinjen 90101|112 for emergencies"
    crisis_resources: str = ""

    @property
    def crisis_resources_list(self) -> list[str]:
        raw = self.crisis_resources.replace("\n", "|")
        return [part.strip() for part in raw.split("|") if part.strip()]

    @property
    def uses_real_model(self) -> bool:
        return bool(self.openrouter_api_key.strip())

    @property
    def uses_real_transcription(self) -> bool:
        return bool(self.transcription_api_key.strip())

    @property
    def uses_real_speech(self) -> bool:
        return bool(self.transcription_api_key.strip() and self.speech_voice_id.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
