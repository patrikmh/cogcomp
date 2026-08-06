import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { MotionSurface } from "@/components/MotionSurface";
import { api } from "@/lib/api";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { colors } from "@/theme";

/**
 * Settings.
 *
 * Three switches and a way out. Everything that used to sit in the main navigation
 * because it had nowhere else to go now lives either here or behind the developer
 * switch — a journal should not open onto a control panel.
 *
 * Each switch says what it does in a few words and nothing else. The longer
 * explanations that used to accompany them were reassurance, and reassurance
 * repeated on every screen stops being read.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const token = useSession((s) => s.token);
  const signOut = useSession((s) => s.signOut);
  const { voice, developer, findings, setVoice, setDeveloper, setFindings } = usePreferences();

  if (!token) return null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Switch
        label="Spoken replies"
        note="The agent reads its side aloud."
        on={voice}
        onToggle={() => void setVoice(!voice)}
      />

      <Switch
        label="Patterns and regions"
        note="What has been noticed across time. Turning this off keeps every entry."
        on={findings}
        onToggle={() => void setFindings(!findings)}
      />

      <Switch
        label="Developer surfaces"
        note="Shows the run log, the raw graph, and experiments."
        on={developer}
        onToggle={() => void setDeveloper(!developer)}
      />

      {developer && (
        <MotionSurface style={styles.link} onPress={() => router.push("/dev")}>
          <Text style={styles.linkLabel}>Open developer menu →</Text>
        </MotionSurface>
      )}

      <View style={styles.spacer} />

      <MotionSurface
        style={styles.link}
        onPress={() => {
          // Revoked server-side too, so a copied token cannot outlive sign-out.
          void api.logout(token).catch(() => undefined);
          void signOut();
        }}
      >
        <Text style={styles.signOut}>Sign out</Text>
      </MotionSurface>

      <Text style={styles.footnote}>
        Your entries stay on your account. Nothing here is shared with anyone.
      </Text>
    </ScrollView>
  );
}

/**
 * A switch that reads as lit or unlit rather than as a checkbox.
 *
 * The whole app says "on" with a glowing dot — an inference that is confident, a
 * microphone that is open, a theme you have kept. Reusing that here means the
 * control needs no legend.
 */
function Switch({
  label,
  note,
  on,
  onToggle,
}: {
  label: string;
  note: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <MotionSurface
      style={styles.row}
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
    >
      <View style={[styles.track, on && styles.trackOn]}>
        <View style={[styles.knob, on && styles.knobOn]} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.note}>{note}</Text>
      </View>
    </MotionSurface>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.room },
  content: { padding: 20, gap: 4, paddingBottom: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14 },
  track: {
    width: 44,
    height: 24,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  trackOn: { borderColor: colors.cyan, backgroundColor: "#0c1c22" },
  knob: {
    width: 16,
    height: 16,
    borderRadius: 999,
    backgroundColor: colors.lineStrong,
    alignSelf: "flex-start",
  },
  knobOn: { backgroundColor: colors.cyan, alignSelf: "flex-end" },
  copy: { flex: 1, gap: 2 },
  label: { color: colors.ink, fontSize: 16, fontWeight: "600" },
  note: { color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
  link: { paddingVertical: 14 },
  linkLabel: { color: colors.cyan, fontSize: 14, fontWeight: "700" },
  signOut: { color: colors.inkSoft, fontSize: 15, fontWeight: "700" },
  spacer: { height: 12 },
  footnote: { color: colors.inkMuted, fontSize: 12, lineHeight: 18, paddingTop: 20 },
});
