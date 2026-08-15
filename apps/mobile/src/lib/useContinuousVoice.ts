import { Audio } from "expo-av";
import { Platform } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";

import { type VadState, initial, levelFromMetering, step } from "@/lib/vad";

/**
 * A conversation you can just have.
 *
 * Hold-to-record makes you operate a machine while you are trying to think. This
 * listens, notices when you have finished a thought, sends it, and speaks the
 * reply — then listens again. The only button is the one that starts and ends the
 * whole thing.
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
  onUtterance: (uri: string) => Promise<void>;
  /** True while the agent's voice is playing. The microphone stays shut. */
  speaking: boolean;
}): ContinuousVoice {
  const [state, setState] = useState<ListenState>("off");
  const [level, setLevel] = useState(0);
  /** The web's own level source; null on native, which uses metering. */
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
  // Read inside the polling loop, which closes over its first render otherwise.
  const muted = useRef(speaking);
  muted.current = speaking;

  /**
   * A microphone level, on the web.
   *
   * `expo-av`'s web recorder answers `getAudioRecordingStatus` with five fields
   * — canRecord, isRecording, isDoneRecording, durationMillis, uri — and no
   * `metering` among them. `isMeteringEnabled` is honoured on iOS and Android
   * and ignored here, so `status.metering` was always undefined, the level was
   * always 0, and the detector never heard anything: the microphone opened, the
   * screen said it was listening, and nothing was ever sent however long anyone
   * talked.
   *
   * So the web reads the level itself, off an analyser on its own stream, and
   * native carries on using metering.
   */
  const openWebMeter = useCallback(async () => {
    if (Platform.OS !== "web" || meter.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const analyser = context.createAnalyser();
    // Small window: this is asked for a level every 60ms and only needs loudness.
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    meter.current = { stream, context, analyser, data: new Uint8Array(analyser.fftSize) };
  }, []);

  const closeWebMeter = useCallback(() => {
    const open = meter.current;
    meter.current = null;
    if (!open) return;
    open.stream.getTracks().forEach((t) => t.stop());
    void open.context.close().catch(() => undefined);
  }, []);

  /** Loudness now, 0–1, as root-mean-square about the centre of the waveform. */
  const webLevel = useCallback((): number => {
    const open = meter.current;
    if (!open) return 0;
    open.analyser.getByteTimeDomainData(open.data);
    let sum = 0;
    for (let i = 0; i < open.data.length; i++) {
      const deviation = (open.data[i]! - 128) / 128;
      sum += deviation * deviation;
    }
    // The same shape `levelFromMetering` gives: quiet is 0, speech approaches 1.
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
  }, []);

  const stop = useCallback(() => {
    running.current = false;
    void teardown();
    // Release the audio session so other apps are not left muted.
    void Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => undefined);
    vad.current = initial();
    setLevel(0);
    setState("off");
  }, [teardown]);

  // Leaving the screen must close the microphone. A listening session that
  // outlives the screen that started it is the worst bug this feature could have.
  useEffect(() => stop, [stop]);

  const beginSegment = useCallback(async () => {
    const created = new Audio.Recording();
    // The options type requires every per-platform block, while the preset types
    // them as optional — so spreading it alone does not satisfy the signature
    // even though the preset defines all three at runtime. Asserted rather than
    // rebuilt, so this keeps following the preset if expo changes it.
    const preset = Audio.RecordingOptionsPresets.HIGH_QUALITY!;
    const options: Audio.RecordingOptions = {
      ...preset,
      android: preset.android!,
      ios: preset.ios!,
      web: preset.web!,
      // Without this the status carries no level and the detector is blind.
      isMeteringEnabled: true,
    };
    await created.prepareToRecordAsync(options);
    await created.startAsync();
    recording.current = created;
  }, []);

  const start = useCallback(async () => {
    if (running.current || !enabled) return;
    setError(null);

    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setError("Microphone access is needed to talk.");
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      // The web's own level source. Opened once for the session rather than per
      // segment, so the analyser is warm when the first word arrives.
      await openWebMeter();

      running.current = true;
      vad.current = initial();
      lastFrame.current = Date.now();
      await beginSegment();
      setState("listening");

      timer.current = setInterval(async () => {
        const active = recording.current;
        if (!active || busy.current) return;

        // Shut while the agent talks, so its own voice is never transcribed as
        // the person's next turn.
        if (muted.current) {
          vad.current = initial();
          setLevel(0);
          return;
        }

        const status = await active.getStatusAsync().catch(() => null);
        if (!status?.isRecording) return;

        const now = Date.now();
        const elapsed = now - lastFrame.current;
        lastFrame.current = now;

        const current =
          Platform.OS === "web" ? webLevel() : levelFromMetering(status.metering ?? Number.NaN);
        setLevel(current);

        const { state: next, action } = step(vad.current, current, elapsed);
        vad.current = next;

        if (action.type === "start") setState("hearing");

        if (action.type === "discard") {
          // Too short to be speech. Restart the segment so the next utterance
          // does not arrive with a cough glued to the front of it.
          setState("listening");
          busy.current = true;
          await teardown();
          if (running.current) await beginSegment().catch(() => undefined);
          busy.current = false;
          return;
        }

        if (action.type === "finish") {
          busy.current = true;
          setState("thinking");
          const finished = recording.current;
          recording.current = null;
          try {
            await finished?.stopAndUnloadAsync();
            const uri = finished?.getURI();
            if (uri) await onUtterance(uri);
          } catch {
            setError("Could not send that. Still listening.");
          } finally {
            // Listening resumes whatever happened — a failed turn must not end
            // the conversation silently.
            if (running.current) {
              await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
              }).catch(() => undefined);
              await beginSegment().catch(() => undefined);
              vad.current = initial();
              lastFrame.current = Date.now();
              setState("listening");
            }
            busy.current = false;
          }
        }
      }, POLL_MS);
    } catch {
      setError("Could not start listening.");
      stop();
    }
  }, [enabled, beginSegment, onUtterance, teardown, stop]);

  // Reflect the agent's turn in the reported state without touching the loop.
  useEffect(() => {
    if (!running.current) return;
    if (speaking) setState("replying");
    else if (!busy.current) setState("listening");
  }, [speaking]);

  return { state, level, error, start, stop };
}
