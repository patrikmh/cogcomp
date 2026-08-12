import { Audio } from "expo-av";
import { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
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
  tone = "light",
}: {
  onRecorded: (uri: string) => Promise<void>;
  disabled?: boolean;
  /** Reported so the screen can show what the microphone is doing — the blob
   *  quietens while someone is speaking rather than talking over them. */
  onStateChange?: (state: State) => void;
  /** Dark surfaces need their own colours — the default label is near-black and
   *  vanishes against focus mode's background. */
  tone?: "light" | "dark";
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
        Alert.alert(
          "Microphone access needed",
          "Tlön records voice entries only while you hold the button.",
        );
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
        Alert.alert("Could not start recording", "Please try again.");
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

    try {
      await active?.stopAndUnloadAsync();
      await resetAudioMode();
      const uri = active?.getURI();
      if (!uri) throw new Error("no recording produced");
      await onRecorded(uri);
    } catch {
      Alert.alert("Could not save that recording", "Please try again.");
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
      <Text style={[styles.note, tone === "dark" && styles.noteDark]}>
        The recording is transcribed and then discarded. Only the text is kept.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
  label: { fontFamily: fonts.sans, fontSize: 16, fontWeight: "600", color: colors.inkSoft },
  labelDark: { color: colors.ink },
  labelRecording: { color: colors.ink },
  note: { fontFamily: fonts.sans, fontSize: 11, color: colors.inkMuted, textAlign: "center" },
  noteDark: { color: colors.inkMuted },
});
