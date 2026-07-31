import { Audio } from "expo-av";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

type State = "idle" | "recording" | "uploading";

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
}: {
  onRecorded: (uri: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [state, setState] = useState<State>("idle");
  const recording = useRef<Audio.Recording | null>(null);

  useEffect(() => {
    // If the screen goes away mid-recording, stop the hardware rather than
    // leaving the microphone open.
    return () => {
      recording.current?.stopAndUnloadAsync().catch(() => undefined);
      recording.current = null;
    };
  }, []);

  async function start() {
    if (state !== "idle" || disabled) return;
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Microphone access needed",
          "Tlön records voice entries only while you hold the button.",
        );
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording: started } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recording.current = started;
      setState("recording");
    } catch {
      setState("idle");
      Alert.alert("Could not start recording", "Please try again.");
    }
  }

  async function stop() {
    if (state !== "recording") return;
    const active = recording.current;
    recording.current = null;
    setState("uploading");

    try {
      await active?.stopAndUnloadAsync();
      // Release the audio session so other apps are not left muted.
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = active?.getURI();
      if (!uri) throw new Error("no recording produced");
      await onRecorded(uri);
    } catch {
      Alert.alert("Could not save that recording", "Please try again.");
    } finally {
      setState("idle");
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
      <Pressable
        onPressIn={start}
        onPressOut={stop}
        disabled={disabled || state === "uploading"}
        style={[
          styles.button,
          state === "recording" && styles.recording,
          (disabled || state === "uploading") && styles.disabled,
        ]}
      >
        <Text
          style={[styles.label, state === "recording" && styles.labelRecording]}
        >
          {label}
        </Text>
      </Pressable>
      <Text style={styles.note}>
        The recording is transcribed and then discarded. Only the text is kept.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  button: {
    borderWidth: 1,
    borderColor: "#d4d4d8",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  recording: { backgroundColor: "#fee2e2", borderColor: "#b91c1c" },
  disabled: { opacity: 0.4 },
  label: { fontSize: 16, fontWeight: "600", color: "#3f3f46" },
  labelRecording: { color: "#b91c1c" },
  note: { fontSize: 11, color: "#a1a1aa", textAlign: "center" },
});
