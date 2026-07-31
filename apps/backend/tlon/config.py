from functools import lru_cache

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

    @property
    def uses_real_model(self) -> bool:
        return bool(self.openrouter_api_key.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
