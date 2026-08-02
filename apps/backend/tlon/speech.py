"""Text to speech, and the amplitude envelope that drives the blob.

The blob has to move in time with the voice, which means the client needs to know
how loud the clip is at each moment. There are three ways to get that, and this
module takes the third:

1. Analyse the audio in the browser (Web Audio `AnalyserNode`). Real amplitude,
   but web only — there is no equivalent through expo-av on native, so the blob
   would move on one platform and not the other.
2. Decode the mp3 server-side and analyse it. Correct, but drags in a decoder.
3. Ask ElevenLabs for **raw PCM**, measure it directly, and ship the envelope
   alongside the clip. No decoder anywhere, identical on every platform, and the
   measurement is deterministic so it can be tested without a network call.

The PCM is wrapped in a WAV header on the way out — 44 bytes, no dependency, and
playable by both expo-av and every browser.

Everything below the request itself is pure. `envelope()` and `wav()` take bytes
and return values; only `ElevenLabsVoice.speak` touches the network.
"""

from __future__ import annotations

import logging
import struct
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech"

#: Their multilingual model. Named here rather than left to the API default so a
#: change on their side does not silently change how the app sounds.
DEFAULT_MODEL = "eleven_multilingual_v2"

#: 22.05 kHz mono. Speech carries nothing above ~8 kHz, and halving the rate
#: halves a payload that already travels as uncompressed PCM.
SAMPLE_RATE = 22050

#: One envelope value per frame. 50 ms is about three frames per rendered blob
#: frame at 30fps — fine enough that the motion tracks syllables, coarse enough
#: that the envelope stays a few hundred floats rather than a few thousand.
FRAME_MS = 50

BYTES_PER_SAMPLE = 2

#: Below this the request is not worth making. An empty reply produces an empty
#: clip, and playing it just makes the blob twitch.
MIN_CHARS = 1

#: Long replies are the agent talking too much, which is a prompt problem rather
#: than a transport one — but truncating beats an unbounded synthesis bill.
MAX_CHARS = 2000


class SpeechError(RuntimeError):
    """Synthesis failed. The caller falls back to text, never to silence with no
    explanation."""


@dataclass(frozen=True)
class Clip:
    #: WAV bytes, ready to play.
    audio: bytes
    #: One 0–1 value per FRAME_MS of audio.
    envelope: list[float]
    frame_ms: int = FRAME_MS
    sample_rate: int = SAMPLE_RATE

    @property
    def duration_ms(self) -> int:
        return len(self.envelope) * self.frame_ms


def envelope(pcm: bytes, sample_rate: int = SAMPLE_RATE, frame_ms: int = FRAME_MS) -> list[float]:
    """RMS loudness per frame, normalised so the loudest frame is 1.0.

    RMS rather than peak: peak tracks clicks and plosives, and a blob that lurches
    on every consonant reads as broken rather than as speaking. RMS follows the
    syllable, which is the thing a listener actually perceives as rhythm.

    Normalised per clip rather than against an absolute reference, because the
    blob should look equally alive whether a reply was recorded loud or quiet.
    """
    frame_samples = max(int(sample_rate * frame_ms / 1000), 1)
    frame_bytes = frame_samples * BYTES_PER_SAMPLE

    levels: list[float] = []
    for start in range(0, len(pcm) - frame_bytes + 1, frame_bytes):
        chunk = pcm[start : start + frame_bytes]
        samples = struct.unpack(f"<{frame_samples}h", chunk)
        mean_square = sum(s * s for s in samples) / frame_samples
        levels.append(mean_square**0.5)

    if not levels:
        return []

    loudest = max(levels)
    # An entirely silent clip is not an error — synthesising " " is legal. Return
    # zeros rather than dividing by zero.
    if loudest == 0:
        return [0.0] * len(levels)

    return [round(level / loudest, 4) for level in levels]


def wav(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Wrap mono 16-bit PCM in a WAV header.

    Written out by hand rather than via `wave` so it works on a bytes object
    without a temporary file, and so the 44 bytes are visible to anyone debugging
    a clip that will not play.
    """
    byte_rate = sample_rate * BYTES_PER_SAMPLE
    return (
        b"RIFF"
        + struct.pack("<I", 36 + len(pcm))
        + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, byte_rate, BYTES_PER_SAMPLE, 16)
        + b"data"
        + struct.pack("<I", len(pcm))
        + pcm
    )


def clip_from_pcm(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> Clip:
    return Clip(
        audio=wav(pcm, sample_rate),
        envelope=envelope(pcm, sample_rate),
        sample_rate=sample_rate,
    )


class ElevenLabsVoice:
    """Synthesis through ElevenLabs, as raw PCM."""

    def __init__(self, api_key: str, voice_id: str, model: str = DEFAULT_MODEL) -> None:
        self._api_key = api_key
        self._voice_id = voice_id
        self._model = model

    @property
    def enabled(self) -> bool:
        return True

    async def speak(self, text: str) -> Clip:
        spoken = text.strip()[:MAX_CHARS]
        if len(spoken) < MIN_CHARS:
            raise SpeechError("nothing to say")

        try:
            async with httpx.AsyncClient(timeout=45) as http:
                response = await http.post(
                    f"{TTS_URL}/{self._voice_id}",
                    params={"output_format": f"pcm_{SAMPLE_RATE}"},
                    headers={"xi-api-key": self._api_key},
                    json={"text": spoken, "model_id": self._model},
                )
        except httpx.HTTPError as exc:
            raise SpeechError(f"could not reach the voice service: {exc}") from exc

        if response.status_code != 200:
            # The body carries their error message; it is worth logging but not
            # worth returning to the client verbatim.
            logger.warning("elevenlabs tts %s: %s", response.status_code, response.text[:200])
            raise SpeechError(f"voice service returned {response.status_code}")

        return clip_from_pcm(response.content)


class SilentVoice:
    """The no-key fallback.

    Reports itself as disabled rather than synthesising something fake. A stub
    that returned a beep would make a missing key look like a working feature.
    """

    @property
    def enabled(self) -> bool:
        return False

    async def speak(self, text: str) -> Clip:
        raise SpeechError("speech is not configured")


def build_voice(api_key: str, voice_id: str, model: str = DEFAULT_MODEL):
    if not api_key.strip() or not voice_id.strip():
        logger.warning("no ElevenLabs voice configured — the agent will not speak")
        return SilentVoice()
    return ElevenLabsVoice(api_key, voice_id, model)
