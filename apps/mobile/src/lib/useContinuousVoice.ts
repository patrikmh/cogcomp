import { Audio } from "expo-av";
import { Platform } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";

import { type VadState, initial, levelFromMetering, step } from "@/lib/vad";

/**
 * A conversation you can just have.
 *
 * Hold-to-record makes you operate a machine while you are trying to think. This
 * listens, notices when you have finished a thought, sends it, and speaks the
 * reply — then listens again. The only button is the one that starts and ends
 * the whole thing.
 *
 * Three rules keep it from being unpleasant:
 *
 * **It never listens to itself.** The microphone is closed while the agent is
 * speaking. Otherwise the reply is transcribed as your next turn and the two of
 * you talk in a loop forever.
 *
 * **It never sends silence.** The detector discards anything too short to be
 * speech, so a door closing does not become a journal entry.
 *
 * **Stopping is immediate and total.** Recording stops, playback stops, and the
 * microphone is released — this is an app people use to talk about difficult
 * things, and "is it still listening?" must never be a question.
 *
 * The decision of when a person started and stopped talking is in `@/lib/vad`,
 * pure and tested. This file owns the microphone, the timing, and the handoff.
 */

/** How often the microphone level is sampled. Fast enough to catch the start of
 *  a word, slow enough not to matter. */
const POLL_MS = 50;

export type ListenState = "off" | "listening" | "hearing" | "thinking" | "replying";

export interface ContinuousVoice {
  state: ListenState;
  /** 0–1 microphone level, for the avatar to move with. */
  level: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

export function useContinuousVoice({
  enabled,
  onUtterance,
  speaking,
}: {
  enabled: boolean;
  /** Called with a finished utterance. Resolve when the reply has been spoken. */
  onUtterance: (uri: string, generation: number) => Promise<void>;
  /** True while a reply is owned — pending synthesis counts. The microphone
   *  stays shut for the whole of that, not only while a clip is sounding. */
  speaking: boolean;
}): ContinuousVoice {
  const [state, setState] = useState<ListenState>("off");
  const [level, setLevel] = useState(0);
  const meter = useRef<{
    stream: MediaStream;
    context: AudioContext;
    analyser: AnalyserNode;
    data: Uint8Array;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recording = useRef<Audio.Recording | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const vad = useRef<VadState>(initial());
  const busy = useRef(false);
  const running = useRef(false);
  const lastFrame = useRef(Date.now());
  const previousSpeaking = useRef(speaking);
  const pollRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const startPollingRef = useRef<() => void>(() => undefined);
  const lifecycle = useRef(0);
  const muted = useRef(speaking);
  muted.current = speaking;

  const openWebMeter = useCallback(async (generation: number) => {
    if (Platform.OS !== "web" || meter.current) return;
    if (generation !== lifecycle.current || !running.current || muted.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let context: AudioContext | null = null;
    try {
      if (generation !== lifecycle.current || !running.current || muted.current) return;
      context = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      if (context.state === "suspended") await context.resume();
      if (generation !== lifecycle.current || !running.current || muted.current) return;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      if (generation !== lifecycle.current || !running.current || muted.current) return;
      meter.current = { stream, context, analyser, data: new Uint8Array(analyser.fftSize) };
    } finally {
      if (!meter.current || meter.current.stream !== stream) {
        stream.getTracks().forEach((track) => track.stop());
        await context?.close().catch(() => undefined);
      }
    }
  }, []);

  const closeWebMeter = useCallback(() => {
    const open = meter.current;
    meter.current = null;
    if (!open) return;
    open.stream.getTracks().forEach((t) => t.stop());
    void open.context.close().catch(() => undefined);
  }, []);

  const webLevel = useCallback((): number => {
    const open = meter.current;
    if (!open) return 0;
    open.analyser.getByteTimeDomainData(open.data);
    let sum = 0;
    for (let i = 0; i < open.data.length; i++) {
      const deviation = (open.data[i]! - 128) / 128;
      sum += deviation * deviation;
    }
    return Math.min(1, Math.sqrt(sum / open.data.length) * 4);
  }, []);

  const teardown = useCallback(async () => {
    closeWebMeter();
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    const active = recording.current;
    recording.current = null;
    try {
      await active?.stopAndUnloadAsync();
    } catch {
      // Already stopped, or never started. Nothing to recover.
    }
  }, [closeWebMeter]);

  /**
   * Close the recording route before asking the voice service for a reply.
   *
   * iOS keeps a held-open recorder on the earpiece path; the reply is then
   * technically playing and completely inaudible. Playback still needs the
   * silent-switch override — without it a phone on mute speaks nothing.
   */
  const releaseForReply = useCallback(async (generation: number, finished?: Audio.Recording | null) => {
    closeWebMeter();
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (finished && recording.current === finished) recording.current = null;
    else if (!finished && generation === lifecycle.current) {
      const active = recording.current;
      recording.current = null;
      await active?.stopAndUnloadAsync().catch(() => undefined);
    }
    if (generation === lifecycle.current) {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      }).catch(() => undefined);
    }
  }, [closeWebMeter]);

  const stop = useCallback(() => {
    lifecycle.current += 1;
    running.current = false;
    void teardown();
    void Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    }).catch(() => undefined);
    vad.current = initial();
    setLevel(0);
    setState("off");
  }, [teardown]);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  const beginSegment = useCallback(async (generation: number) => {
    const created = new Audio.Recording();
    const preset = Audio.RecordingOptionsPresets.HIGH_QUALITY!;
    const options: Audio.RecordingOptions = {
      ...preset,
      android: preset.android!,
      ios: preset.ios!,
      web: preset.web!,
      isMeteringEnabled: true,
    };
    try {
      await created.prepareToRecordAsync(options);
      if (generation !== lifecycle.current || !running.current || muted.current) {
        await created.stopAndUnloadAsync().catch(() => undefined);
        return;
      }
      await created.startAsync();
      if (generation !== lifecycle.current || !running.current || muted.current) {
        await created.stopAndUnloadAsync().catch(() => undefined);
        return;
      }
      recording.current = created;
    } catch (error) {
      await created.stopAndUnloadAsync().catch(() => undefined);
      throw error;
    }
  }, []);

  const resumeSegment = useCallback(async (generation: number): Promise<boolean> => {
    try {
      await beginSegment(generation);
    } catch {
      if (generation === lifecycle.current) {
        closeWebMeter();
      }
      if (generation === lifecycle.current && running.current && !muted.current) {
        running.current = false;
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setState("off");
        setError("Could not start listening.");
      }
      return false;
    }
    if (generation !== lifecycle.current) return false;
    if (recording.current) return true;
    if (!running.current || muted.current) return false;
    running.current = false;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setState("off");
    setError("Could not start listening.");
    return false;
  }, [beginSegment, closeWebMeter]);

  const poll = useCallback(async () => {
    const active = recording.current;
    if (!active || busy.current) return;
    if (muted.current) {
      vad.current = initial();
      setLevel(0);
      return;
    }
    const generation = lifecycle.current;
    const status = await active.getStatusAsync().catch(() => null);
    // A poll that crossed stop+restart must not finish the *new* recorder.
    if (generation !== lifecycle.current || recording.current !== active) return;
    if (!status?.isRecording) return;
    const now = Date.now();
    const elapsed = now - lastFrame.current;
    lastFrame.current = now;
    const current = Platform.OS === "web" ? webLevel() : levelFromMetering(status.metering ?? Number.NaN);
    setLevel(current);
    const { state: next, action } = step(vad.current, current, elapsed);
    vad.current = next;
    if (action.type === "start") setState("hearing");

    if (action.type === "discard") {
      setState("listening");
      busy.current = true;
      await teardown();
      if (running.current && !muted.current && generation === lifecycle.current) {
        if (await resumeSegment(generation)) {
          if (generation === lifecycle.current && recording.current) {
            startPollingRef.current();
          }
        }
      }
      busy.current = false;
      return;
    }

    if (action.type === "finish") {
      if (recording.current !== active) return;
      busy.current = true;
      setState("thinking");
      recording.current = null;
      try {
        await active.stopAndUnloadAsync();
        const uri = active.getURI();
        // The recording route is gone before the reply is asked for. Opening
        // the microphone again is the falling edge of `speaking`, not this
        // finally — `voice.say` claims speaking asynchronously, and a resume
        // here would win that race on iOS every time.
        await releaseForReply(generation, active);
        if (uri && generation === lifecycle.current && running.current) {
          await onUtterance(uri, generation);
        } else if (generation === lifecycle.current && running.current && !muted.current) {
          setError("Could not send that. Still listening.");
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
          }).catch(() => undefined);
          if (await resumeSegment(generation)) {
            if (generation === lifecycle.current && recording.current) {
              vad.current = initial();
              lastFrame.current = Date.now();
              setState("listening");
              startPollingRef.current();
            }
          }
        }
      } catch {
        if (generation === lifecycle.current && running.current && !muted.current) {
          setError("Could not send that. Still listening.");
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
          }).catch(() => undefined);
          if (await resumeSegment(generation)) {
            if (generation === lifecycle.current && recording.current) {
              vad.current = initial();
              lastFrame.current = Date.now();
              setState("listening");
              startPollingRef.current();
            }
          }
        } else if (generation === lifecycle.current) {
          setError("Could not send that. Still listening.");
        }
      } finally {
        busy.current = false;
      }
    }
  }, [onUtterance, releaseForReply, resumeSegment, teardown, webLevel]);

  const startPolling = useCallback(() => {
    if (timer.current) return;
    timer.current = setInterval(() => void pollRef.current(), POLL_MS);
  }, []);
  pollRef.current = poll;
  startPollingRef.current = startPolling;

  const start = useCallback(async () => {
    if (running.current || !enabled) return;
    const generation = ++lifecycle.current;
    setError(null);
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (generation !== lifecycle.current || !permission.granted) {
        if (!permission.granted && generation === lifecycle.current) {
          setError("Microphone access is needed to talk.");
        }
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      if (generation !== lifecycle.current || muted.current) {
        if (generation === lifecycle.current) {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: true,
          }).catch(() => undefined);
        }
        return;
      }
      running.current = true;
      await openWebMeter(generation);
      if (generation !== lifecycle.current || !running.current || muted.current) {
        await teardown();
        return;
      }
      vad.current = initial();
      lastFrame.current = Date.now();
      await beginSegment(generation);
      if (generation !== lifecycle.current || !running.current || muted.current || !recording.current) {
        await teardown();
        if (generation === lifecycle.current) {
          running.current = false;
          setState("off");
        }
        return;
      }
      setState("listening");
      startPolling();
    } catch {
      if (generation === lifecycle.current) {
        setError("Could not start listening.");
        stop();
      }
    }
  }, [beginSegment, enabled, openWebMeter, startPolling, stop]);

  useEffect(() => {
    if (!running.current) {
      previousSpeaking.current = speaking;
      return;
    }
    if (speaking) {
      void releaseForReply(lifecycle.current);
      setState("replying");
    } else if (previousSpeaking.current && !busy.current) {
      const generation = lifecycle.current;
      void (async () => {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        }).catch(() => undefined);
        try {
          await openWebMeter(generation);
        } catch {
          if (generation === lifecycle.current) {
            running.current = false;
            await teardown();
            setState("off");
          }
          return;
        }
        if (generation !== lifecycle.current || !running.current || busy.current || muted.current) {
          return;
        }
        if (!(await resumeSegment(generation))) return;
        if (generation !== lifecycle.current || !running.current || !recording.current) return;
        vad.current = initial();
        lastFrame.current = Date.now();
        setState("listening");
        startPollingRef.current();
      })();
    } else if (!speaking && !busy.current && running.current && !recording.current) {
      // Upload failed before anyone claimed speaking. There is no falling edge
      // to wait for, and sitting silent after "Could not send that" is worse
      // than opening the microphone again.
      const generation = lifecycle.current;
      void (async () => {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        }).catch(() => undefined);
        try {
          await openWebMeter(generation);
        } catch {
          if (generation === lifecycle.current) {
            running.current = false;
            await teardown();
            setState("off");
          }
          return;
        }
        if (generation !== lifecycle.current || !running.current || muted.current) return;
        if (!(await resumeSegment(generation))) return;
        if (generation !== lifecycle.current || !running.current || !recording.current) return;
        vad.current = initial();
        lastFrame.current = Date.now();
        setState("listening");
        startPollingRef.current();
      })();
    }
    previousSpeaking.current = speaking;
  }, [openWebMeter, releaseForReply, resumeSegment, speaking]);

  return { state, level, error, start, stop };
}
