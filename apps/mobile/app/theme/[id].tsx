import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AtmosphericShell } from "@/components/Atmospheric";
import { MotionSurface } from "@/components/MotionSurface";
import { ErrorLens, LoadingLens } from "@/components/SpatialField";
import { api, type ThemeDetail, type ThemeMember } from "@/lib/api";
import { useSession } from "@/state/session";

/**
 * A region of a life, opened.
 *
 * A pattern says one thing keeps coming back. An association says two things
 * travel together. This says something neither can — that a *group* of things
 * is one area of your life — which makes it the densest claim the system makes
 * and the one with the most room to be wrong.
 *
 * So the screen shows its working. The members are listed in the person's own
 * words and each opens to the entries behind it; the associations that formed
 * the region are stated as a count rather than left implied. Until then a
 * reader has only the system's word that these things belong together.
 *
 * There is no summary and no heading for the region, because none is written.
 * Naming an area of someone's life is an interpretation, and an interpretation
 * presented as a title is the hardest kind to argue with.
 */
export default function ThemeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useSession((s) => s.token);

  const theme = useQuery({
    queryKey: ["theme", id],
    queryFn: () => api.theme(token!, id!),
    enabled: Boolean(token && id),
  });

  if (!token) return null;

  if (theme.isLoading) return <LoadingLens label="Reading the region…" />;
  if (theme.isError || !theme.data) return <ErrorLens label="Could not load this region." />;

  return <Body theme={theme.data} />;
}

function Body({ theme }: { theme: ThemeDetail }) {
  const router = useRouter();
  const held = new Date(theme.first_seen_at).toLocaleDateString();

  return (
    <AtmosphericShell variant="secondary">
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.kicker}>A REGION, NOT A DIAGNOSIS</Text>
        <Text style={styles.headline}>{theme.label}</Text>

        <View style={[styles.badge, theme.tentative && styles.badgeTentative]}>
          <Text style={styles.badgeText}>
            {theme.member_count} things · {Math.round(theme.confidence * 100)}% confident
          </Text>
        </View>

        {/* Said before the members, not after. A list of things under one
            heading reads as a category unless something says otherwise. */}
        <Text style={styles.lead}>
          These came up in the same entries as each other, often enough to form a
          group. That is a shape in what you wrote — not a part of your life the
          app has decided something about.
        </Text>

        <Text style={styles.sectionTitle}>What is in it</Text>
        {theme.members.map((member) => (
          <Member key={member.id} member={member} onOpen={() => router.push(`/node/${member.id}`)} />
        ))}

        <View style={styles.provenance}>
          <Text style={styles.provenanceTitle}>How this was formed</Text>
          <Row
            label="Associations inside it"
            value={`${theme.associations.length} ${theme.associations.length === 1 ? "pair" : "pairs"}`}
          />
          <Row label="Held since" value={held} />
          <Row label="Method" value={theme.detector} />
          <Row label="Status" value={theme.epistemic_status} />
        </View>

        <Text style={styles.footnote}>
          Regions are built from things appearing together and nothing else. No
          direction, no cause, and no claim about which of them came first.
        </Text>
      </ScrollView>
    </AtmosphericShell>
  );
}

function Member({ member, onOpen }: { member: ThemeMember; onOpen: () => void }) {
  const tentative = member.confidence < 0.5;
  return (
    <MotionSurface
      style={styles.member}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${member.label}, ${member.kind.toLowerCase()}. Where this came from`}
    >
      <View style={[styles.dot, tentative && styles.dotTentative]} />
      <View style={styles.memberBody}>
        <Text style={styles.memberLabel}>{member.label}</Text>
        <Text style={styles.meta}>
          {member.kind.toLowerCase()} · {Math.round(member.confidence * 100)}%
          {member.epistemic_status === "user_rejected" ? " · you rejected this" : ""}
        </Text>
      </View>
      <Text style={styles.chevron}>→</Text>
    </MotionSurface>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#08080c", padding: 20, gap: 12, paddingBottom: 48 },
  kicker: { color: "#f0abfc", fontSize: 11, fontWeight: "700", letterSpacing: 1.8 },
  headline: { fontSize: 22, lineHeight: 30, fontWeight: "600", color: "#f1f0f8" },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#181827",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  badgeTentative: { backgroundColor: "#3a2e0e" },
  badgeText: { fontSize: 13, color: "#b5b3c7" },
  lead: { fontSize: 15, lineHeight: 22, color: "#b5b3c7", marginTop: 4 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#a09db4",
    marginTop: 14,
  },
  member: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#12121c",
    borderWidth: 1,
    borderColor: "#29293b",
    borderRadius: 3,
    padding: 12,
  },
  dot: { width: 9, height: 9, borderRadius: 999, backgroundColor: "#f0abfc" },
  dotTentative: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#fbbf24" },
  memberBody: { flex: 1, gap: 2 },
  memberLabel: { fontSize: 16, color: "#f1f0f8" },
  meta: { fontSize: 12, color: "#a09db4" },
  chevron: { color: "#a09db4", fontSize: 15 },
  provenance: {
    backgroundColor: "#12121c",
    marginTop: 18,
    borderWidth: 1,
    borderColor: "#29293b",
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  provenanceTitle: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#a09db4",
    marginBottom: 2,
  },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel: { fontSize: 13, color: "#a09db4" },
  rowValue: { fontSize: 13, flexShrink: 1, textAlign: "right", color: "#f1f0f8" },
  footnote: { marginTop: 18, fontSize: 12, lineHeight: 18, color: "#a09db4" },
});
