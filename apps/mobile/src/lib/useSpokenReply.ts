import { Audio } from "expo-av";
import { Platform } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api, type SpokenClip } from "@/lib/api";
import { type Envelope, levelAt, smooth } from "@/lib/envelope";
import { speechChunks } from "@tlon/speech";
import { SpokenStream } from "@tlon/speech/stream";

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

/** Somewhere to put a reply that is still being written. */
export interface SpokenFeed {
  /** Another piece of the reply, exactly as it arrived. Whole sentences are
   *  sent for synthesis as they complete; the rest is held. */
  feed: (delta: string) => void;
  /** Nothing more is coming. Speaks whatever is left, however it ends. */
  end: () => void;
}

export interface SpokenReply {
  /** 0–1 loudness at this instant, smoothed on the way down. */
  level: number;
  speaking: boolean;
  /** Synthesise and play. Resolves when playback starts, not when it ends. */
  say: (text: string) => Promise<void>;
  /**
   * Speak a reply that has not finished arriving.
   *
   * The point of the whole arrangement: a sentence is finished long before a
   * reply is, so the first one is sent for synthesis while the model is still
   * writing the second. The wait for the model and the wait for the voice stop
   * being consecutive and become the same wait.
   */
  speakAsItArrives: () => SpokenFeed;
  stop: () => void;
  /** Tell this browser sound is wanted, from inside a user gesture. iOS will
   *  not play anything that starts after a network round-trip otherwise. */
  unlock: () => void;
  /** This server has no voice configured at all (a 503 from `/v1/voice/speak`).
   *  Distinct from a transient synthesis failure: this one will not clear on
   *  its own, so the screen can say so once rather than trying and failing
   *  silently on every reply. */
  unavailable: boolean;
  /** What the last synthesis attempt failed with, if it did. Cleared on the
   *  next successful clip. Reported so a misconfigured voice — a bad id, an
   *  exhausted ElevenLabs quota — is something a person can see and act on
   *  rather than a reply that stays mute with no explanation anywhere. */
  lastError: string | null;
}

export function useSpokenReply(token: string | null, enabled: boolean): SpokenReply {
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  /** Whether this browser has been told, inside a gesture, that sound is wanted. */
  const unlocked = useRef(false);
  const sound = useRef<Audio.Sound | null>(null);
  /** The web's one player, primed by `unlock` and reused for every clip. Not an
   *  `Audio.Sound`: see `say`. */
  const voice = useRef<HTMLAudioElement | null>(null);
  const envelope = useRef<Envelope>({ levels: [], frameMs: 50 });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const smoothed = useRef(0);
  // Mirrors the `unavailable` state into a ref so `say` can check it inside its
  // own closure without depending on the state value — depending on it would
  // restart the level timer's effect wiring on every flip.
  const unavailableRef = useRef(false);
  /** Which utterance is the current one. A reply is spoken in several pieces
   *  with several requests in flight at once, and stopping has to be able to
   *  disown all of them — including the ones that have not come back yet. */
  const generation = useRef(0);
  /** Resolver for the piece playing right now, so stopping can end the wait. */
  const finished = useRef<(() => void) | null>(null);
  /** Pieces asked for and not yet played, in the order they were written. */
  const queue = useRef<Promise<SpokenClip>[]>([]);
  /** Whether the loop that empties the queue is already running. */
  const draining = useRef(false);
  /** Identifies the drain currently allowed to release the lock. */
  const drainGeneration = useRef(0);
  /** Whether everything this reply will ever contain has been queued. Until it
   *  is, an empty queue means "waiting for the model", not "finished". */
  const complete = useRef(true);

  const stop = useCallback(() => {
    // Anything still in flight for the utterance being stopped belongs to a
    // generation that is now over, and will drop what it was about to play.
    generation.current += 1;
    // Let a new reply take over immediately, even while the old drain is
    // unwinding an in-flight request or playback promise.
    drainGeneration.current += 1;
    draining.current = false;
    // Pieces already asked for are let go of rather than played into whatever
    // comes next. The requests themselves cannot be recalled, and are not worth
    // trying to: they are already paid for and their answers are simply dropped.
    queue.current = [];
    complete.current = true;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    // Detached first so the async unload cannot race a new clip into the ref.
    const active = sound.current;
    sound.current = null;
    active?.unloadAsync().catch(() => undefined);

    // Paused, not discarded: this element carries iOS's permission to make
    // sound at all, and the next reply needs it.
    const el = voice.current;
    if (el) {
      el.onended = null;
      el.onerror = null;
      el.pause();
    }
    // A piece that was waiting to finish never will now. Released rather than
    // left hanging, so the loop walking the pieces unwinds instead of parking
    // on a promise nothing will ever settle.
    const waiting = finished.current;
    finished.current = null;
    waiting?.();

    smoothed.current = 0;
    setLevel(0);
    setSpeaking(false);
  }, []);

  // Leaving the screen mid-sentence must stop the audio, not let it play on over
  // whatever the person opened next.
  useEffect(() => stop, [stop]);

  /**
   * Let this browser play sound at all.
   *
   * iOS only permits audio that starts inside a user gesture. A spoken reply
   * arrives after a network round-trip — the tap that asked for it is long over
   * by then — so WebKit refuses it, silently, and the conversation reads as
   * mute while everything else works. Desktop browsers have no such rule, which
   * is why this only ever failed on a phone.
   *
   * Playing a moment of silence inside the tap marks the element as user-started;
   * every later `play()` on it is then allowed. Called from the press handler,
   * where the gesture still counts.
   *
   * The permission attaches to *that element*, not to the page, so the element
   * primed here is the element every reply is played through — swapping its
   * `src` keeps the grant, while building a fresh one per clip would throw the
   * grant away each time and leave the conversation mute after the first turn.
   */
  const unlock = useCallback(() => {
    if (unlocked.current || Platform.OS !== "web") return;
    unlocked.current = true;
    try {
      // 0.05s of silent WAV — short enough to be inaudible, real enough to count.
      const silence =
        "data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQgAAAAAAAAAAAAAAA==";
      const primer = new window.Audio(silence);
      primer.volume = 0;
      voice.current = primer;
      void primer.play().catch(() => undefined);
    } catch {
      // If it cannot be primed there is nothing to fall back to; the reply is
      // still on screen to read.
    }
  }, []);

  /**
   * The clip as a source the element will accept.
   *
   * A blob URL is the tidier of the two — it hands the element a resource
   * instead of a hundred kilobytes of base64 in an attribute, and it can be
   * revoked the moment the clip ends. It is also the one mobile Safari will not
   * play: `blob:` in an `<audio>` src is served through the same path as
   * MediaSource there, which iOS does not implement for audio, so the element
   * loads nothing and `play()` resolves against a clip that never sounds.
   * Nothing is thrown and no error fires, which is exactly what a mute
   * conversation with a healthy server looks like.
   *
   * The web client next door has always used a `data:` URI and has always
   * worked on the same phone, from the same server, on the same clip. So this
   * one does too, and the size is the price of it sounding.
   */
  function clipUri(base64: string): string {
    return `data:audio/wav;base64,${base64}`;
  }

  /** Sample the level off whatever is playing, for as long as anything is.
   *
   *  Started once for the whole reply rather than once per piece: the envelope
   *  is swapped underneath it as each piece begins, and a timer that survived
   *  the seams is one less thing to get wrong at them. */
  const startLevel = useCallback(() => {
    if (timer.current) return;
    let last = Date.now();

    const sample = (positionMs: number) => {
      const now = Date.now();
      const elapsed = (now - last) / 1000;
      last = now;
      const target = levelAt(envelope.current, positionMs);
      smoothed.current = smooth(smoothed.current, target, elapsed);
      setLevel(smoothed.current);
    };

    if (Platform.OS === "web") {
      timer.current = setInterval(() => {
        const active = voice.current;
        if (active) sample(active.currentTime * 1000);
      }, SAMPLE_MS);
      return;
    }

    timer.current = setInterval(async () => {
      const active = sound.current;
      if (!active) return;
      const status = await active.getStatusAsync();
      if (status.isLoaded) sample(status.positionMillis);
    }, SAMPLE_MS);
  }, []);

  /**
   * Play one piece, and resolve when it has finished sounding.
   *
   * The browser plays this itself; expo-av only carries it on native.
   *
   * `Audio.Sound` is a wrapper over the same `<audio>` element on the web, and
   * on iOS it loses the one thing that matters: the element it creates is not
   * the element the opening tap unlocked, so WebKit refuses to play it and
   * reports no error. The web client next door has always used a plain element
   * for exactly this reason, and has always worked on the same phone, from the
   * same server, on the same clip. Two players, one silent — so the wrapper is
   * the difference, and the web does without it.
   */
  const play = useCallback(
    async (clip: { audio: string; envelope: number[]; frame_ms: number }) => {
      const mine = generation.current;
      envelope.current = { levels: clip.envelope, frameMs: clip.frame_ms };

      if (Platform.OS === "web") {
        // The primed element if there is one — a person who never tapped
        // (autoplay-permissive desktop) gets a fresh one, which is fine there.
        const el = voice.current ?? new window.Audio();
        voice.current = el;
        el.volume = 1;
        el.src = clipUri(clip.audio);
        // Any refusal lands in the caller's catch and is named in `lastError`,
        // rather than leaving the reply mute with nothing said about why.
        if (generation.current !== mine) return;
        try {
          await el.play();
        } catch (error) {
          if (generation.current !== mine) {
            el.pause();
            return;
          }
          throw error;
        }
        if (generation.current !== mine) {
          el.pause();
          return;
        }
        setSpeaking(true);
        startLevel();
        await new Promise<void>((resolve) => {
          finished.current = resolve;
          el.onended = () => resolve();
          el.onerror = () => resolve();
        });
        return;
      }

      // Native playback must not inherit a leftover recording session. The
      // continuous recorder already flipped allowsRecordingIOS off; this
      // restates the silent-switch override so a muted phone still speaks.
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      }).catch(() => undefined);
      if (generation.current !== mine) return;
      const { sound: created } = await Audio.Sound.createAsync(
        { uri: clipUri(clip.audio) },
        { shouldPlay: false },
      );
      if (generation.current !== mine) {
        await created.unloadAsync().catch(() => undefined);
        return;
      }
      sound.current = created;
      try {
        await created.playAsync();
      } catch (error) {
        if (generation.current !== mine) {
          if (sound.current === created) sound.current = null;
          await created.unloadAsync().catch(() => undefined);
          return;
        }
        throw error;
      }
      if (generation.current !== mine) {
        if (sound.current === created) sound.current = null;
        await created.unloadAsync().catch(() => undefined);
        return;
      }
      setSpeaking(true);
      startLevel();
      await new Promise<void>((resolve) => {
        finished.current = resolve;
        created.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded || status.didJustFinish) resolve();
        });
      });
      sound.current = null;
      await created.unloadAsync().catch(() => undefined);
    },
    [startLevel],
  );

  const report = useCallback((error: unknown) => {
    // 503 means this server has no voice at all, so there is no point asking
    // again. Any other failure might be transient — a dropped connection, a
    // rate limit — and those are worth retrying on the next reply.
    if (error instanceof ApiError && error.status === 503) {
      unavailableRef.current = true;
      setUnavailable(true);
      setLastError("Speech is not configured on this server.");
    } else if (error instanceof ApiError) {
      setLastError(error.message);
    } else if (error instanceof Error && error.name === "NotAllowedError") {
      // The browser has the clip and refused to play it. Naming this separately
      // matters: it is the one failure the person can clear themselves, and it
      // is not a fault of the server or the network.
      setLastError("This browser blocked the sound. Tap the shape to allow it.");
    } else {
      setLastError("Could not reach the voice service.");
    }
  }, []);

  /** Play everything queued, in order, until there is nothing left and nothing
   *  more coming. Only ever one of these runs at a time; a piece queued while
   *  it is running is picked up by the loop it is already in. */
  const drain = useCallback(
    async (mine: number) => {
      if (draining.current) return;
      draining.current = true;
      const owner = ++drainGeneration.current;
      try {
        for (;;) {
          const next = queue.current.shift();
          if (!next) break;
          const clip = await next;
          // Stopped, or a newer reply took over while this was in the air.
          if (generation.current !== mine) return;
          // A clip played is proof the voice works now, whatever failed before.
          setLastError(null);
          await play(clip);
          if (generation.current !== mine) return;
        }
        // Nothing queued. If nothing more is coming either, the reply is spoken.
        if (complete.current && generation.current === mine) stop();
      } catch (error) {
        if (generation.current !== mine) return;
        report(error);
        // The reply is already on screen to read. A failure to speak it is not
        // something to interrupt someone mid-thought about — this state is
        // exposed for a quiet status line, never a toast.
        stop();
      } finally {
        if (drainGeneration.current === owner) draining.current = false;
      }
    },
    [play, report, stop],
  );

  /** Ask for a piece and put it in line. Synthesis starts now; playing waits
   *  for its turn, so the pieces overlap in the air and not in the ear. */
  const enqueue = useCallback(
    (text: string, mine: number) => {
      if (!token || !text.trim()) return;
      const request = api.speak(token, text);
      // Awaited in turn by the drain loop, so it would otherwise sit as an
      // unhandled rejection for as long as the pieces ahead of it take to play.
      request.catch(() => undefined);
      queue.current.push(request);
      void drain(mine);
    },
    [token, drain],
  );

  const say = useCallback(
    async (text: string) => {
      if (!token || !enabled || !text.trim() || unavailableRef.current) return;
      stop();

      const mine = generation.current;
      complete.current = true;
      setSpeaking(true);
      for (const chunk of speechChunks(text)) enqueue(chunk, mine);
    },
    [token, enabled, stop, enqueue],
  );

  const speakAsItArrives = useCallback((): SpokenFeed => {
    if (!token || !enabled || unavailableRef.current) {
      // Speech is off or unavailable. The caller still streams text to the
      // screen; it simply is not spoken, which is the same silence as before.
      return { feed: () => undefined, end: () => undefined };
    }
    stop();

    const mine = generation.current;
    complete.current = false;
    setSpeaking(true);
    const cutter = new SpokenStream();

    return {
      feed: (delta: string) => {
        if (generation.current !== mine) return;
        for (const piece of cutter.push(delta)) enqueue(piece, mine);
      },
      end: () => {
        if (generation.current !== mine) return;
        for (const piece of cutter.end()) enqueue(piece, mine);
        complete.current = true;
        // The queue may already have run dry while the model was still writing,
        // so the loop that would have noticed the end has ended. Nudge it.
        void drain(mine);
      },
    };
  }, [token, enabled, stop, enqueue, drain]);

  return {
    level,
    speaking,
    say,
    speakAsItArrives,
    stop,
    unlock,
    unavailable,
    lastError,
  };
}
