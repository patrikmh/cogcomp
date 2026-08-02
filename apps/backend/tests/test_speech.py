"""The amplitude envelope and the WAV wrapper. Pure, no network.

The envelope is what makes the blob move in time with the voice, so the property
that matters is not "is it correct RMS" but "does it track the syllable" — a
value that spikes on a click or lags a beat behind is worse than no motion.
"""

import math
import struct

import pytest

from tlon.speech import (
    BYTES_PER_SAMPLE,
    FRAME_MS,
    SAMPLE_RATE,
    SilentVoice,
    SpeechError,
    build_voice,
    clip_from_pcm,
    envelope,
    wav,
)

FRAME_SAMPLES = int(SAMPLE_RATE * FRAME_MS / 1000)


def pcm(samples: list[int]) -> bytes:
    return struct.pack(f"<{len(samples)}h", *samples)


def frames(*amplitudes: int) -> bytes:
    """One frame per amplitude, each a constant-level block."""
    return pcm([a for amplitude in amplitudes for a in [amplitude] * FRAME_SAMPLES])


def tone(amplitude: int, frame_count: int = 1, hz: float = 200.0) -> bytes:
    total = FRAME_SAMPLES * frame_count
    return pcm(
        [int(amplitude * math.sin(2 * math.pi * hz * i / SAMPLE_RATE)) for i in range(total)]
    )


class TestEnvelope:
    def test_silence_is_flat(self):
        assert envelope(frames(0, 0, 0)) == [0.0, 0.0, 0.0]

    def test_one_value_per_frame(self):
        assert len(envelope(frames(1000, 2000, 3000, 4000))) == 4

    def test_it_is_normalised_to_the_loudest_frame(self):
        # Per clip rather than against an absolute reference: the blob should look
        # equally alive whether a reply came out loud or quiet.
        assert max(envelope(frames(100, 8000, 400))) == 1.0

    def test_relative_loudness_is_preserved(self):
        quiet, loud = envelope(frames(1000, 4000))
        assert loud == 1.0
        assert quiet == pytest.approx(0.25, abs=0.001)

    def test_every_value_is_within_range(self):
        for level in envelope(tone(12000, frame_count=8)):
            assert 0.0 <= level <= 1.0

    def test_a_partial_trailing_frame_is_dropped(self):
        # Rather than reported as a quiet frame, which would make every clip end
        # on a fade the speaker did not perform.
        assert len(envelope(frames(5000, 5000) + pcm([5000] * (FRAME_SAMPLES // 3)))) == 2

    def test_shorter_than_one_frame_is_empty(self):
        assert envelope(pcm([1000] * (FRAME_SAMPLES // 2))) == []

    def test_empty_audio_is_empty(self):
        assert envelope(b"") == []

    def test_it_follows_loudness_rather_than_peaks(self):
        # RMS, not peak. A single click in an otherwise quiet frame must not make
        # that frame read as loud — a blob that lurches on every plosive looks
        # broken rather than like something speaking.
        click = pcm([32000] + [0] * (FRAME_SAMPLES - 1))
        sustained = pcm([4000] * FRAME_SAMPLES)
        clicked, steady = envelope(click + sustained)
        assert clicked < steady

    def test_it_is_deterministic(self):
        audio = tone(9000, frame_count=4)
        assert envelope(audio) == envelope(audio)


class TestWav:
    def test_it_starts_with_a_riff_header(self):
        assert wav(frames(1000)).startswith(b"RIFF")

    def test_it_declares_wave_format(self):
        header = wav(frames(1000))
        assert header[8:12] == b"WAVE"
        assert header[12:16] == b"fmt "

    def test_the_header_is_44_bytes(self):
        audio = frames(1000, 2000)
        assert len(wav(audio)) == len(audio) + 44

    def test_it_declares_mono_16_bit_at_the_right_rate(self):
        header = wav(frames(1000))
        channels, rate, _, _, bits = struct.unpack("<HIIHH", header[22:36])
        assert channels == 1
        assert rate == SAMPLE_RATE
        assert bits == 16

    def test_the_declared_sizes_match_the_payload(self):
        # A wrong size field is the classic reason a clip plays as a fraction of
        # its length, or not at all.
        audio = frames(1000, 2000, 3000)
        built = wav(audio)
        assert struct.unpack("<I", built[4:8])[0] == len(built) - 8
        assert struct.unpack("<I", built[40:44])[0] == len(audio)

    def test_the_samples_survive_intact(self):
        audio = frames(1234)
        assert wav(audio)[44:] == audio


class TestClip:
    def test_it_carries_playable_audio_and_an_envelope(self):
        clip = clip_from_pcm(tone(8000, frame_count=6))
        assert clip.audio.startswith(b"RIFF")
        assert len(clip.envelope) == 6

    def test_duration_matches_the_envelope(self):
        clip = clip_from_pcm(tone(8000, frame_count=6))
        assert clip.duration_ms == 6 * FRAME_MS

    def test_the_envelope_covers_the_whole_clip(self):
        # The client interpolates by playback position, so an envelope shorter
        # than the audio leaves the blob frozen for the last stretch of speech.
        audio = tone(8000, frame_count=10)
        clip = clip_from_pcm(audio)
        played_ms = len(audio) / BYTES_PER_SAMPLE / SAMPLE_RATE * 1000
        assert clip.duration_ms == pytest.approx(played_ms, abs=FRAME_MS)


@pytest.mark.anyio
class TestConfiguration:
    @pytest.fixture
    def anyio_backend(self) -> str:
        return "asyncio"

    def test_without_a_key_the_agent_stays_silent(self):
        assert isinstance(build_voice("", "voice-id"), SilentVoice)

    def test_without_a_voice_the_agent_stays_silent(self):
        # There is no sensible default for what someone's companion sounds like,
        # and picking one silently is a strange thing to do to a person.
        assert isinstance(build_voice("key", ""), SilentVoice)

    def test_the_silent_voice_says_so_rather_than_faking_it(self):
        assert SilentVoice().enabled is False

    async def test_the_silent_voice_refuses_rather_than_returning_a_beep(self):
        # A stub that returned something audible would make a missing key look
        # like a working feature.
        with pytest.raises(SpeechError):
            await SilentVoice().speak("hello")

    def test_a_configured_voice_is_enabled(self):
        assert build_voice("key", "voice-id").enabled is True
