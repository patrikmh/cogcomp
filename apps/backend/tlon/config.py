from functools import lru_cache

from pydantic import AliasChoices, Field, model_validator
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
    #: The model that holds up the other side of a conversation, when it should
    #: not be the one that does the extracting.
    #:
    #: They want opposite things. Extraction runs in the background against a
    #: schema, and being right matters more than being quick. A conversational
    #: turn is one short question in front of someone who is waiting, and the
    #: wait is most of what it feels like — measured against the deployment,
    #: time-to-first-token is two to four and a half seconds, which is nearly
    #: the whole gap before the reply is spoken.
    #:
    #: Blank means "whatever the extractor uses", so nothing changes for a
    #: deployment that never sets it.
    conversation_model: str = ""

    #: Hosted Whisper, for voice entries. Absent in development, in which case the
    #: stub transcriber keeps the voice path exercisable without a key.
    #: TRANSCRIPTION_API_KEY is deliberately provider-neutral: it is the explicit
    #: choice for the provider selected below. Provider-specific environment keys
    #: are kept separate so a Groq key cannot accidentally be sent to ElevenLabs.
    transcription_api_key: str = Field(
        default="", validation_alias="TRANSCRIPTION_API_KEY"
    )
    elevenlabs_api_key: str = Field(default="", validation_alias="ELEVENLABS_API_KEY")
    openai_compatible_api_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "OPENAI_COMPATIBLE_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY"
        ),
    )
    #: "elevenlabs" or "openai" — they do not share a request shape, so this
    #: selects an implementation rather than just a URL.
    transcription_provider: str = "elevenlabs"
    #: Only used by the openai-compatible provider.
    transcription_base_url: str = "https://api.groq.com/openai/v1"

    @model_validator(mode="after")
    def resolve_transcription_credential(self) -> "Settings":
        provider = self.transcription_provider.strip().lower()
        if provider == "elevenlabs":
            fallback = self.elevenlabs_api_key
            provider_name = "ELEVENLABS_API_KEY"
        elif provider in {"openai", "groq", "openai-compatible"}:
            fallback = self.openai_compatible_api_key
            provider_name = "GROQ_API_KEY or OPENAI_COMPATIBLE_API_KEY"
        else:
            # build_transcriber reports the canonical provider error; do not
            # obscure it with credential resolution for an unknown provider.
            return self

        if self.transcription_api_key.strip():
            return self
        if fallback.strip():
            self.transcription_api_key = fallback
            return self
        # No key at all is supported in development (the stub transcriber). A
        # key for another provider, however, is a configuration mistake and must
        # not be forwarded to a network client.
        mismatched = (
            self.openai_compatible_api_key
            if provider == "elevenlabs"
            else self.elevenlabs_api_key
        )
        if mismatched.strip():
            raise ValueError(
                f"{provider_name} is required for transcription provider "
                f"{self.transcription_provider!r}; only a mismatched provider key was configured"
            )
        return self
    #: Blank means the provider's own default model.
    transcription_model: str = ""

    #: Text to speech, so the agent can be listened to rather than read. Synthesis
    #: only ever goes through ElevenLabs — there is no second TTS provider the way
    #: transcription has one — so this needs an ElevenLabs key specifically.
    #:
    #: Separate from `transcription_api_key` on purpose. Transcription can be
    #: pointed at Groq or another OpenAI-compatible endpoint via
    #: `TRANSCRIPTION_PROVIDER`, in which case `transcription_api_key` holds a
    #: key that ElevenLabs will not accept. Reusing it here used to mean
    #: transcription worked while every spoken reply failed its auth silently —
    #: two features sharing a field that only one of them could actually use.
    #: `ELEVENLABS_API_KEY` still satisfies both when transcription is left on
    #: its ElevenLabs default, since one key covers both of their services then.
    speech_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("SPEECH_API_KEY", "ELEVENLABS_API_KEY"),
    )
    #: The voice must be chosen explicitly because there is no sensible default
    #: for what someone's companion sounds like, and picking one silently is a
    #: strange thing to do to a person.
    speech_voice_id: str = ""
    speech_model: str = "eleven_multilingual_v2"

    #: Whether background agents run on a timer. Off by default: a system that
    #: rewrites your graph on a schedule should be something you switched on, and
    #: it keeps test and CI processes from doing background work nobody asked for.
    agents_enabled: bool = False

    #: Refuse to start rather than run the stub extractor. False in development,
    #: where the stub is the thing that makes the pipeline runnable without a
    #: key; true anywhere real, because a deployment that quietly invents
    #: readings looks healthy in every other respect and is worse than one that
    #: will not boot.
    require_real_model: bool = False

    #: Where the browser clients are served from, comma-separated. There are two
    #: of them — the desktop client and the Expo build phones are sent to — and
    #: they sit on different origins, so this was a list the moment the second one
    #: was deployed. Blank means any origin, which is what local development wants
    #: and what a deployment does not.
    web_origin: str = ""

    #: How words become vectors for the graph projection and semantic search.
    #: 'deterministic' (default) is an offline hash stand-in with no semantics;
    #: 'local' opts into the ONNX model described in ADR-0007, which keeps entry
    #: text inside the server. Anything else must fail loudly, not degrade.
    embedding_provider: str = "deterministic"

    #: FalkorDB, which holds the Graphiti projection. Postgres remains the source
    #: of truth and this is rebuilt from it on every themes run, so these point at
    #: a store that is expected to be empty sometimes and is never backed up.
    falkor_host: str = "localhost"
    falkor_port: int = 6379
    falkor_username: str = ""
    falkor_password: str = ""
    falkor_database: str = "default_db"

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
        return bool(self.speech_api_key.strip() and self.speech_voice_id.strip())

    @property
    def allowed_origins(self) -> list[str]:
        origins = [part.strip() for part in self.web_origin.split(",") if part.strip()]
        return origins or ["*"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
