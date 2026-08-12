import { DISCLOSURES, DISCLOSURE_HEADING } from "@tlon/copy";
import { radii, type as scale } from "@tlon/design";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Kicker, Rule } from "@/components/Marks";
import { MotionSurface } from "@/components/MotionSurface";
import { colors, fonts } from "@/theme";

/**
 * What happens to your words.
 *
 * The web client has had this page since it was ported; this one had nothing,
 * and its only disclosure was a sentence in Settings that turned out to be
 * wrong. A page you can read before writing anything is the point — the whole
 * argument for the app is that you can check what it does, and that argument
 * cannot live only on the client someone is not using.
 *
 * The sentences come from `@tlon/copy` so both clients say exactly the same
 * thing. Two independently maintained privacy pages is how the last one drifted.
 */
export default function WordsScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Kicker>Before your first entry</Kicker>
      <Text style={styles.title}>{DISCLOSURE_HEADING}</Text>
      <Rule />

      {DISCLOSURES.map((item) => (
        <View key={item.title} style={styles.card}>
          <Kicker>{item.title}</Kicker>
          <Text style={styles.body}>{item.body}</Text>
        </View>
      ))}

      <View style={styles.actions}>
        <MotionSurface
          style={styles.primary}
          onPress={() => router.replace("/")}
          accessibilityRole="button"
        >
          <Text style={styles.primaryLabel}>Start writing</Text>
        </MotionSurface>
        <MotionSurface
          style={styles.secondary}
          onPress={() => router.push("/settings")}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryLabel}>Settings</Text>
        </MotionSurface>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.room },
  content: { padding: 20, paddingBottom: 56, gap: 12 },
  title: {
    color: colors.ink,
    fontFamily: fonts.sansBold,
    fontSize: scale.title.size,
    lineHeight: scale.title.line,
    letterSpacing: scale.title.tracking,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.surface,
    padding: 14,
    gap: 8,
  },
  body: {
    color: colors.inkSoft,
    fontFamily: fonts.sans,
    fontSize: scale.body.size,
    lineHeight: scale.body.line,
  },
  actions: { flexDirection: "row", gap: 10, marginTop: 8, flexWrap: "wrap" },
  primary: {
    borderWidth: 1,
    borderColor: colors.ink,
    borderRadius: radii.surface,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  primaryLabel: { color: colors.ink, fontFamily: fonts.sansSemi, fontSize: scale.body.size },
  secondary: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.surface,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  secondaryLabel: {
    color: colors.inkMuted,
    fontFamily: fonts.sans,
    fontSize: scale.body.size,
  },
});
