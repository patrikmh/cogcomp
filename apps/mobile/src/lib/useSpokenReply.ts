import { Audio } from "expo-av";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { type Envelope, levelAt, smooth } from "@/lib/envelope";

/**
 * Speaking a reply aloud, and reporting how loud it is right now.
 *
 * The level comes from an envelope the server measured off the audio, sampled by
 * playback position — not from analysing the sound in the client. Web Audio could
 * do that in a browser, but there is no equivalent through expo-av on native, and
 * a blob that moves with the voice on one platform and not the other is worse
 * than one that moves the same way everywhere. See `tlon/speech.py`.
 *
 * Failure is silent by design: if speech is not configured, or synthesis fails,
 * the reply is still on screen to read. Speaking is an addition to the text, never
 * a replacement for it.
 *
 * Silent, but not repeated. A server with no voice configured answers 503, and
 * asking again on every reply costs a doomed round trip each time and logs a
 * console error in a perfectly healthy deployment. The 503 is remembered for the
 * session — it is a statement about the server, not about this request.
 */

/** How often the level is recomputed. Matches the blob's own frame rate — sampling
 *  faster would produce values nothing renders. */
const SAMPLE_MS = 33;

export interface SpokenReply {
  /** 0–1 loudness at this instant, smoothed on the way down. */
  level: number;
  speaking: boolean;
  /** Synthesise and play. Resolves when playback starts, not when it ends. */
  say: (text: string) => Promise<void>;
  stop: () => void;
}

export function useSpokenReply(token: string | null, enabled: boolean): SpokenReply {
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const sound = useRef<Audio.Sound | null>(null);
  const envelope = useRef<Envelope>({ levels: [], frameMs: 50 });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const smoothed = useRef(0);
  // Set once the server says it has no voice. A ref rather than state: nothing
  // renders differently, and a re-render here would restart the level timer.
  const unavailable = useRef(false);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    // Detached first so the async unload cannot race a new clip into the ref.
    const active = sound.current;
    sound.current = null;
    active?.unloadAsync().catch(() => undefined);
    smoothed.current = 0;
    setLevel(0);
    setSpeaking(false);
  }, []);

  // Leaving the screen mid-sentence must stop the audio, not let it play on over
  // whatever the person opened next.
  useEffect(() => stop, [stop]);

  const say = useCallback(
    async (text: string) => {
      if (!token || !enabled || !text.trim() || unavailable.current) return;
      stop();

      try {
        const clip = await api.speak(token, text);
        envelope.current = { levels: clip.envelope, frameMs: clip.frame_ms };

        const { sound: created } = await Audio.Sound.createAsync(
          { uri: `data:audio/wav;base64,${clip.audio}` },
          { shouldPlay: true },
        );
        sound.current = created;
        setSpeaking(true);

        created.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) stop();
        });

        let last = Date.now();
        timer.current = setInterval(async () => {
          const active = sound.current;
          if (!active) return;
          const status = await active.getStatusAsync();
          if (!status.isLoaded) return;

          const now = Date.now();
          const elapsed = (now - last) / 1000;
          last = now;

          const target = levelAt(envelope.current, status.positionMillis);
          smoothed.current = smooth(smoothed.current, target, elapsed);
          setLevel(smoothed.current);
        }, SAMPLE_MS);
      } catch (error) {
        // 503 means this server has no voice at all, so there is no point asking
        // again. Any other failure might be transient — a dropped connection, a
        // rate limit — and those are worth retrying on the next reply.
        if (error instanceof ApiError && error.status === 503) {
          unavailable.current = true;
        }
        // The reply is already on screen to read. A failure to speak it is not
        // something to interrupt someone mid-thought about.
        stop();
      }
    },
    [token, enabled, stop],
  );

  return { level, speaking, say, stop };
}
