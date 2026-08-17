"""Speech-to-text for voice journal entries.

Audio is transcribed and then discarded. It is never written to the database and
never becomes a graph node — the transcript is the observation, and the recording
was only ever the means of producing it. Keeping the audio would mean storing the
user's voice alongside their most private thoughts for no benefit the transcript
does not already provide.

Two providers are supported because they do not share a request shape: ElevenLabs
Scribe authenticates with `xi-api-key` and takes `model_id`, while OpenAI-compatible
endpoints (OpenAI, Groq) use a bearer token and `model`. Both return a JSON object
with a `text` field, which is the only part we keep.

The transport is swappable for the same reason extraction's is: the stub lets the
whole voice path be tested without a key, a network, or a real recording.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Protocol

import httpx
from fastapi import UploadFile

logger = logging.getLogger(__name__)

ELEVENLABS_URL = "https://api.elevenlabs.io/v1/speech-to-text"
ELEVENLABS_MODEL = "scribe_v1"

OPENAI_COMPATIBLE_BASE_URL = "https://api.groq.com/openai/v1"
OPENAI_COMPATIBLE_MODEL = "whisper-large-v3-turbo"

#: What the hosted transcription APIs accept. Rejecting early gives the user a clear
#: error instead of a provider-shaped one after an upload has already happened.
MAX_AUDIO_BYTES = 25 * 1024 * 1024

TRANSCRIPTION_TIMEOUT_SECONDS = 120
_AUDIO_READ_CHUNK_BYTES = 1024 * 1024
#: Two 25 MiB recordings is enough parallelism for normal Talk use while
#: bounding retained upload bytes (including the temporary join) at a
#: conservative process-wide level. The permit covers reading and the provider
#: request, so it cannot be evaded by queueing completed reads.
AUDIO_TRANSCRIPTION_CONCURRENCY = 2
_audio_transcription_budget = asyncio.Semaphore(AUDIO_TRANSCRIPTION_CONCURRENCY)


async def read_bounded_audio(audio: UploadFile) -> bytes:
    """Read an upload in bounded chunks without accepting an oversized body."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await audio.read(_AUDIO_READ_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_AUDIO_BYTES:
            raise AudioTooLarge(f"audio exceeds the limit of {MAX_AUDIO_BYTES} bytes")
        chunks.append(chunk)
    if not chunks:
        raise TranscriptionError("audio file is empty")
    return b"".join(chunks)


async def transcribe_bounded_upload(audio: UploadFile, transcriber: Transcriber) -> str:
    """Read and transcribe one upload under the shared audio memory budget."""
    async with _audio_transcription_budget:
        payload = await read_bounded_audio(audio)
        return await transcriber.transcribe(payload, audio.filename or "recording.m4a")


class TranscriptionError(Exception):
    pass


class AudioTooLarge(TranscriptionError):
    pass


class Transcriber(Protocol):
    @property
    def version(self) -> str:
        """Identifies the model that produced a transcript, for the same reason
        the extractor's version is recorded: a bad batch should be findable."""
        ...

    async def transcribe(self, audio: bytes, filename: str) -> str: ...


def _guard(audio: bytes) -> None:
    if not audio:
        raise TranscriptionError("audio file is empty")
    if len(audio) > MAX_AUDIO_BYTES:
        raise AudioTooLarge(f"audio is {len(audio)} bytes; the limit is {MAX_AUDIO_BYTES}")


def _read_transcript(payload: dict) -> str:
    """Both providers return the transcript under `text`; only that is kept.

    ElevenLabs also returns per-word timings and a detected language. Storing them
    would mean holding a far more precise record of how someone spoke than the
    journal itself needs.
    """
    text = payload.get("text")
    if not isinstance(text, str):
        raise TranscriptionError("transcription response was not in the expected shape")

    transcript = text.strip()
    if not transcript:
        # Silence, or speech the model could not make out. Saying so is more
        # useful than storing an empty entry the user cannot interpret.
        raise TranscriptionError("no speech was detected in the recording")
    return transcript


async def _post(url: str, *, headers: dict, files: dict, data: dict) -> dict:
    async with httpx.AsyncClient(timeout=TRANSCRIPTION_TIMEOUT_SECONDS) as client:
        try:
            response = await client.post(url, headers=headers, files=files, data=data)
        except httpx.HTTPError as exc:
            raise TranscriptionError(f"transcription request failed: {exc}") from exc

    if response.status_code != 200:
        # The body can quote request metadata back; it goes to the log, not the caller.
        logger.error("transcription failed: %s %s", response.status_code, response.text[:500])
        raise TranscriptionError(f"transcription service returned {response.status_code}")

    try:
        return response.json()
    except ValueError as exc:
        raise TranscriptionError("transcription response was not valid JSON") from exc


class StubTranscriber:
    """Returns a fixed transcript so the voice path can be exercised offline.

    Deliberately says what it is. A stub transcript that looked like real speech
    could end up in someone's graph indistinguishable from something they said.
    """

    PLACEHOLDER = "[voice entry — transcription is not configured on this server]"

    @property
    def version(self) -> str:
        return "transcribe-v0.1/stub"

    async def transcribe(self, audio: bytes, filename: str) -> str:
        _guard(audio)
        return self.PLACEHOLDER


class ElevenLabsTranscriber:
    """ElevenLabs Scribe. Authenticates with `xi-api-key`, takes `model_id`."""

    def __init__(self, api_key: str, model: str = ELEVENLABS_MODEL) -> None:
        self._api_key = api_key
        self._model = model

    @property
    def version(self) -> str:
        return f"transcribe-v0.1/elevenlabs/{self._model}"

    async def transcribe(self, audio: bytes, filename: str) -> str:
        _guard(audio)
        payload = await _post(
            ELEVENLABS_URL,
            headers={"xi-api-key": self._api_key},
            files={"file": (filename, audio)},
            data={"model_id": self._model},
        )
        return _read_transcript(payload)


class WhisperTranscriber:
    """Whisper over an OpenAI-compatible audio transcription API (OpenAI, Groq)."""

    def __init__(
        self,
        api_key: str,
        base_url: str = OPENAI_COMPATIBLE_BASE_URL,
        model: str = OPENAI_COMPATIBLE_MODEL,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._model = model

    @property
    def version(self) -> str:
        return f"transcribe-v0.1/{self._model}"

    async def transcribe(self, audio: bytes, filename: str) -> str:
        _guard(audio)
        payload = await _post(
            f"{self._base_url}/audio/transcriptions",
            headers={"Authorization": f"Bearer {self._api_key}"},
            files={"file": (filename, audio)},
            data={"model": self._model, "response_format": "json"},
        )
        return _read_transcript(payload)


def build_transcriber(api_key: str, provider: str, base_url: str, model: str) -> Transcriber:
    normalized = provider.strip().lower()
    if normalized not in {"elevenlabs", "openai", "groq", "openai-compatible"}:
        # Validate configuration before allowing the no-credential development
        # stub. An invalid provider must never be hidden by a blank key.
        raise ValueError(
            f"unknown TRANSCRIPTION_PROVIDER {provider!r}; expected 'elevenlabs' or 'openai'"
        )

    if not api_key.strip():
        logger.warning("TRANSCRIPTION_API_KEY is unset — voice entries will use the stub")
        return StubTranscriber()

    if normalized == "elevenlabs":
        chosen = model or ELEVENLABS_MODEL
        logger.info("transcription via ElevenLabs Scribe (%s)", chosen)
        return ElevenLabsTranscriber(api_key, chosen)
    if normalized in {"openai", "groq", "openai-compatible"}:
        chosen = model or OPENAI_COMPATIBLE_MODEL
        logger.info("transcription via %s (%s)", base_url, chosen)
        return WhisperTranscriber(api_key, base_url, chosen)
