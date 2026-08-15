import { Audio } from "expo-av";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ApiError } from "@/lib/api";
import Svg, { Path, Rect } from "react-native-svg";
import { MotionSurface } from "@/components/MotionSurface";
import { colors, fonts } from "@/theme";
import { radii } from "@tlon/design";

export type RecordState = "idle" | "recording" | "uploading";
type State = RecordState;

/**
 * Hold-to-record voice capture.
 *
 * Hold rather than tap-to-start/tap-to-stop: a recording that keeps running
 * because someone forgot to tap again is both a privacy problem and a way to
 * accidentally capture a conversation that was never meant to be a journal entry.
 * Releasing always stops it.
 */
export function RecordButton({
  onRecorded,
  disabled = false,
  onStateChange,
  onError,
  tone = "light",
  compact = false,
}: {
  onRecorded: (uri: string) => Promise<void>;
  disabled?: boolean;
  /** Reported so the screen can show what the microphone is doing — the blob
   *  quietens while someone is speaking rather than talking over them. */
  onStateChange?: (state: State) => void;
  /** What went wrong, for the screen to show. Failures used to be reported with
   *  `Alert.alert`, which on react-native-web is an empty function — so every
   *  one of them, permission refusals included, vanished without a trace and the
   *  button simply went back to idle. */
  onError?: (message: string) => void;
  /** Dark surfaces need their own colours — the default label is near-black and
   *  vanishes against focus mode's background. */
  tone?: "light" | "dark";
  /** The composer's 44px mic rather than a full-width button. Same hold to
   *  record, same release to save — only the mark differs, because in the
   *  composer the microphone sits beside the words rather than under them. */
  compact?: boolean;
}) {
  const [state, setState] = useState<State>("idle");
  const mounted = useRef(true);
  const holdActive = useRef(false);
  const generation = useRef(0);
  const recording = useRef<Audio.Recording | null>(null);

  useEffect(() => {
    onStateChange?.(state);
    // The callback is usually an inline closure; depending on it would fire this
    // on every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  useEffect(() => {
    // If the screen goes away mid-recording or during startup, stop the
    // hardware rather than leaving the microphone open.
    return () => {
      mounted.current = false;
      holdActive.current = false;
      generation.current += 1;
      const active = recording.current;
      recording.current = null;
      if (active) {
        active.stopAndUnloadAsync()
          .catch(() => undefined)
          .finally(() => resetAudioMode().catch(() => undefined));
      } else {
        resetAudioMode().catch(() => undefined);
      }
    };
  }, []);

  /** Say what went wrong, where someone can see it.
   *
   *  These messages used to go to `Alert.alert`, which react-native-web defines
   *  as an empty function — so on the web build every failure here, a refused
   *  microphone included, was discarded and the button just returned to idle
   *  with nothing said. The console line stays regardless of whether a screen
   *  passes `onError`, because a silent failure is the worst of both. */
  /** What actually went wrong, in as few words as carry it. The bare `catch`
   *  that used to be here threw the cause away, so every failure read the same
   *  and none of them said anything you could act on. */
  function describe(cause: unknown): string {
    // `ApiError` carries the server's own `detail` as its message — "no speech
    // was detected in the recording" and the like — which is the sentence worth
    // showing. The status goes with it, because a 413 and a 401 need different
    // things from the person reading it.
    if (cause instanceof ApiError) return `${cause.message} (${cause.status})`;
    if (cause instanceof Error && cause.message) return cause.message;
    return String(cause);
  }

  function report(message: string) {
    console.error(`[record] ${message}`);
    onError?.(message);
  }

  async function resetAudioMode() {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: false,
    });
  }

  async function start() {
    if (state !== "idle" || disabled || !mounted.current) return;
    holdActive.current = true;
    const currentGeneration = ++generation.current;
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!mounted.current || !holdActive.current || generation.current !== currentGeneration) {
        await resetAudioMode();
        return;
      }
      if (!permission.granted) {
        report("Microphone access is needed to record.");
        holdActive.current = false;
        await resetAudioMode();
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording: started } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      const cancelled = !mounted.current || !holdActive.current || generation.current !== currentGeneration;
      if (cancelled) {
        await started.stopAndUnloadAsync().catch(() => undefined);
        await resetAudioMode();
        return;
      }
      recording.current = started;
      setState("recording");
    } catch {
      await resetAudioMode().catch(() => undefined);
      if (mounted.current && generation.current === currentGeneration) {
        setState("idle");
        report("Could not start recording. Please try again.");
      }
    }
  }

  async function stop() {
    holdActive.current = false;
    generation.current += 1;
    // Use the ref, not React state: release can arrive after the recording is
    // assigned but before the state commit that follows it.
    const active = recording.current;
    recording.current = null;
    if (!active) {
      // Release can arrive while permission or createAsync is pending. The
      // startup continuation will also clean up any late-created recording.
      await resetAudioMode().catch(() => undefined);
      return;
    }
    setState("uploading");

    // Saving and sending are separate failures and were reported as one. A
    // recording that stopped cleanly and then failed to upload said "could not
    // save that recording", which sends someone to look at their microphone
    // when the problem is the network or the server.
    let uri: string | null = null;
    try {
      await active?.stopAndUnloadAsync();
      await resetAudioMode();
      uri = active?.getURI() ?? null;
      if (!uri) throw new Error("the recorder produced no file");
    } catch (cause) {
      report(`Could not save that recording. ${describe(cause)}`);
      if (mounted.current) setState("idle");
      return;
    }

    try {
      await onRecorded(uri);
    } catch (cause) {
      report(`Could not send that recording. ${describe(cause)}`);
    } finally {
      if (mounted.current) setState("idle");
    }
  }

  const label =
    state === "recording"
      ? "Recording — release to save"
      : state === "uploading"
        ? "Transcribing…"
        : "Hold to record";

  if (compact) {
    return (
      <MotionSurface
        motion="none"
        onPressIn={start}
        onPressOut={stop}
        disabled={disabled || state === "uploading"}
        accessibilityRole="button"
        accessibilityLabel="Hold to record"
        accessibilityHint="Press and hold while speaking; release to stop and save the recording."
        style={[styles.mic, (disabled || state === "uploading") && styles.disabled]}
      >
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Rect
            x={9}
            y={3}
            width={6}
            height={12}
            rx={3}
            fill="none"
            stroke={state === "recording" ? colors.cyan : colors.inkMuted}
            strokeWidth={1.4}
          />
          <Path
            d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"
            fill="none"
            stroke={state === "recording" ? colors.cyan : colors.inkMuted}
            strokeWidth={1.4}
            strokeLinecap="round"
          />
        </Svg>
      </MotionSurface>
    );
  }

  return (
    <View style={styles.wrap}>
      <MotionSurface motion="none"
        onPressIn={start}
        onPressOut={stop}
        disabled={disabled || state === "uploading"}
        accessibilityRole="button"
        accessibilityLabel="Hold to record"
        accessibilityHint="Press and hold while speaking; release to stop and save the recording."
        style={[
          styles.button,
          tone === "dark" && styles.buttonDark,
          state === "recording" && styles.recording,
          (disabled || state === "uploading") && styles.disabled,
        ]}
      >
        <View
          style={[
            styles.pip,
            tone === "dark" && styles.pipDark,
            state === "recording" && styles.pipRecording,
          ]}
        />
        <Text
          style={[
            styles.label,
            tone === "dark" && styles.labelDark,
            state === "recording" && styles.labelRecording,
          ]}
        >
          {label}
        </Text>
      </MotionSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  /** The design's `#cap button`: 44 square, transparent, the glyph alone. */
  mic: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  wrap: { gap: 6 },
  // A lit pip beside the label. Held-to-talk has no state you can see once your
  // finger is on it, and the colour change under the thumb is hidden by the
  // thumb; a dot next to the words is not.
  pip: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.inkMuted },
  pipDark: { backgroundColor: colors.line },
  pipRecording: { backgroundColor: colors.danger },
  button: {
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    // 3px, like every other control. This was a pill on the argument that the
    // shape says "press and keep pressing" — but the web client's HOLD TO RECORD
    // is a 3px button making the same promise in words, and in this design only
    // a switch is round. One product cannot have two answers to what a button
    // holds.
    borderRadius: radii.surface,
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDark: { borderColor: colors.lineStrong, backgroundColor: colors.surfaceBright },
  // A dark alert surface keeps the recording state unmistakable while pairing
  // with a light label at normal-text contrast.
  recording: { backgroundColor: colors.surfaceBright, borderColor: colors.danger },
  disabled: { opacity: 0.4 },
  // Matches the design's `.btn` and the control above it: mono, uppercase,
  // letter-spaced, rather than bold sans.
  label: {
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  labelDark: { color: colors.ink },
  labelRecording: { color: colors.ink },
  note: { fontFamily: fonts.sans, fontSize: 11, color: colors.inkMuted, textAlign: "center" },
  noteDark: { color: colors.inkMuted },
});
