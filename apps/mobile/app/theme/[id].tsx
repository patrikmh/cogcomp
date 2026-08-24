import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AtmosphericShell } from "@/components/Atmospheric";
import { MotionSurface } from "@/components/MotionSurface";
import { ErrorLens, LoadingLens } from "@/components/SpatialField";
import { api, type Judgement, type ThemeDetail, type ThemeMember } from "@/lib/api";
import { themeMembersOf } from "@/lib/drawnFrom";
import { SECTIONS } from "@tlon/copy/sections";
import { useSession } from "@/state/session";
import { usePreferences } from "@/state/preferences";
import { colors, fonts } from "@/theme";
import { radii } from "@tlon/design";
import { type as scale } from "@tlon/design";
import { Guide } from "@/components/Guide";

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
  const showFindings = usePreferences((s) => s.findings);

  const theme = useQuery({
    queryKey: ["theme", id],
    queryFn: () => api.theme(token!, id!),
    enabled: Boolean(token && id && showFindings),
  });

  if (!token) return null;
  if (!showFindings) return <ErrorLens label="Findings are off. This region is hidden." />;

  if (theme.isLoading) return <LoadingLens label="Reading the region…" />;
  if (theme.isError || !theme.data) return <ErrorLens label="Could not load this region." onRetry={() => void theme.refetch()} />;

  return <Body theme={theme.data} />;
}

function Body({ theme }: { theme: ThemeDetail }) {
  const router = useRouter();
  const token = useSession((s) => s.token);
  const client = useQueryClient();
  const held = new Date(theme.first_seen_at).toLocaleDateString();
  const lastSeen = new Date(theme.last_confirmed_at).toLocaleDateString();
  const { inside, holds, around } = themeMembersOf(theme.members);

  // The sections say "in your words", so each member carries the sentence that
  // named it — the same first citing entry the web screen shows. Keyed the same
  // way the node screen keys its explain reads, so opening a member afterwards
  // is already in cache.
  const evidence = useQueries({
    queries: theme.members.map((member) => ({
      queryKey: ["explain", member.id],
      queryFn: () => api.explain(token!, member.id),
      enabled: Boolean(token),
    })),
  });
  const quoteFor = new Map(
    theme.members.map((member, i) => [
      member.id,
      evidence[i]?.data?.derived_from?.[0]?.content as string | undefined,
    ]),
  );

  // A region is the densest claim the system makes, so it is also answerable:
  // the same judgement a reading gets, with the same consequences. While the
  // request is in flight the chosen answer shows immediately; the invalidated
  // query reconciles against the server's word afterwards.
  const judge = useMutation({
    mutationFn: (next: Judgement) => api.judgeNode(token!, theme.id, next),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["theme", theme.id], refetchType: "active" });
      void client.invalidateQueries({ queryKey: ["themes"] });
      // Rejecting stops the region feeding everything derived from it.
      void client.invalidateQueries({ queryKey: ["patterns"] });
      void client.invalidateQueries({ queryKey: ["temporal"] });
      void client.invalidateQueries({ queryKey: ["graph"] });
      void client.invalidateQueries({ queryKey: ["summary"] });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["theme", theme.id], refetchType: "active" });
    },
  });
  const status =
    judge.isPending && judge.variables ? judge.variables : theme.epistemic_status;
  const choose = (next: Judgement) => {
    if (judge.isPending) return;
    judge.mutate(status === next ? "hypothesis" : next);
  };

  return (
    <AtmosphericShell variant="secondary">
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.kicker}>A REGION, NOT A DIAGNOSIS</Text>
        <View style={styles.headingRow}>
          <Text style={[styles.headline, styles.headlineFill]}>{theme.label}</Text>
          <Guide id="theme" />
        </View>

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

        {inside.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{SECTIONS.inside.title}</Text>
            <Text style={styles.sectionAside}>{SECTIONS.inside.aside} · in your words</Text>
            {inside.map((member) => (
              <Member key={member.id} member={member} quote={quoteFor.get(member.id)} onOpen={() => router.push(`/node/${member.id}`)} />
            ))}
          </>
        )}
        {holds.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{SECTIONS.holds.title}</Text>
            <Text style={styles.sectionAside}>{SECTIONS.holds.aside} · in your words</Text>
            {holds.map((member) => (
              <Member key={member.id} member={member} quote={quoteFor.get(member.id)} onOpen={() => router.push(`/node/${member.id}`)} />
            ))}
          </>
        )}
        {around.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{SECTIONS.kept.title}</Text>
            <Text style={styles.sectionAside}>people, places, acts · in your words</Text>
            {around.map((member) => (
              <Member key={member.id} member={member} quote={quoteFor.get(member.id)} onOpen={() => router.push(`/node/${member.id}`)} />
            ))}
          </>
        )}

        <View style={styles.provenance}>
          <Text style={styles.provenanceTitle}>How this was formed</Text>
          <Row
            label="Associations inside it"
            value={`${theme.associations.length} ${theme.associations.length === 1 ? "pair" : "pairs"}`}
          />
          <Row label="Held since" value={held} />
          <Row label="Last confirmed" value={lastSeen} />
        </View>

        <View style={styles.verdict}>
          <Text style={styles.verdictAsk}>Does this region hold?</Text>
          <View style={styles.verdictRow}>
            <MotionSurface
              style={[styles.choice, status === "user_confirmed" && styles.choiceYes]}
              onPress={() => choose("user_confirmed")}
              accessibilityRole="button"
              accessibilityState={{ selected: status === "user_confirmed" }}
            >
              <Text
                style={[styles.choiceLabel, status === "user_confirmed" && styles.choiceLabelOn]}
              >
                Yes, that holds
              </Text>
            </MotionSurface>
            <MotionSurface
              style={[styles.choice, status === "user_rejected" && styles.choiceNo]}
              onPress={() => choose("user_rejected")}
              accessibilityRole="button"
              accessibilityState={{ selected: status === "user_rejected" }}
            >
              <Text
                style={[styles.choiceLabel, status === "user_rejected" && styles.choiceLabelOn]}
              >
                Not really
              </Text>
            </MotionSurface>
          </View>
          <Text style={styles.verdictNote}>
            {status === "user_rejected"
              ? "Kept on record, but no longer feeding patterns, comparisons or the graph."
              : "Saying “not really” stops this region feeding patterns, comparisons and the graph."}
          </Text>
        </View>

        <Text style={styles.footnote}>
          Regions are built from things appearing together and nothing else. No
          direction, no cause, and no claim about which of them came first.
        </Text>
      </ScrollView>
    </AtmosphericShell>
  );
}

function Member({
  member,
  quote,
  onOpen,
}: {
  member: ThemeMember;
  quote?: string;
  onOpen: () => void;
}) {
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
        {quote && <Text style={styles.memberQuote}>“{quote}”</Text>}
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
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  headlineFill: { flex: 1 },
  screen: { backgroundColor: colors.room, padding: 20, gap: 12, paddingBottom: 48 },
  kicker: { color: colors.pink, fontFamily: fonts.mono, fontSize: 11, fontWeight: "700", letterSpacing: 1.8 },
  headline: { fontFamily: fonts.sans, fontSize: 22, lineHeight: 30, fontWeight: "600", color: colors.ink },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceBright,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  badgeTentative: { backgroundColor: colors.surfaceBright },
  badgeText: { fontFamily: fonts.sans, fontSize: 13, color: colors.inkSoft },
  lead: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, color: colors.inkSoft, marginTop: 4 },
  sectionTitle: {
    fontFamily: fonts.mono, fontSize: scale.kicker.size,
    textTransform: "uppercase",
    letterSpacing: scale.kicker.tracking,
    color: colors.inkMuted,
    marginTop: 14,
  },
  sectionAside: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkMuted, marginTop: -6 },
  member: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 3,
    padding: 12,
  },
  dot: { width: 9, height: 9, borderRadius: 999, backgroundColor: colors.pink },
  dotTentative: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.warning },
  memberBody: { flex: 1, gap: 2 },
  memberLabel: { fontFamily: fonts.sans, fontSize: 16, color: colors.ink },
  memberQuote: {
    fontFamily: fonts.sans,
    fontSize: 13,
    fontStyle: "italic",
    color: colors.inkSoft,
  },
  meta: { fontFamily: fonts.sans, fontSize: 12, color: colors.inkMuted },
  chevron: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 15 },
  provenance: {
    backgroundColor: colors.surface,
    marginTop: 18,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.surface,
    padding: 12,
    gap: 6,
  },
  provenanceTitle: {
    fontFamily: fonts.mono, fontSize: scale.kicker.size,
    textTransform: "uppercase",
    letterSpacing: scale.kicker.tracking,
    color: colors.inkMuted,
    marginBottom: 2,
  },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel: { fontFamily: fonts.sans, fontSize: 13, color: colors.inkMuted },
  rowValue: { fontFamily: fonts.sans, fontSize: 13, flexShrink: 1, textAlign: "right", color: colors.ink },
  footnote: { marginTop: 18, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: colors.inkMuted },
  verdict: { gap: 8, marginTop: 18 },
  verdictAsk: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 14 },
  verdictRow: { flexDirection: "row", gap: 10 },
  choice: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },
  choiceYes: { borderColor: colors.cyan, backgroundColor: colors.surfaceBright },
  choiceNo: { borderColor: colors.warning, backgroundColor: colors.surfaceBright },
  choiceLabel: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 15, fontWeight: "700" },
  choiceLabelOn: { color: colors.ink },
  verdictNote: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18 },
});
