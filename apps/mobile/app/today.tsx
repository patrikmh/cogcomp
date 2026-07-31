import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { api, type DailySummary } from "@/lib/api";
import { deviceTimezone, localToday, shiftDay } from "@/lib/dates";
import { useSession } from "@/state/session";

export default function TodayScreen() {
  const token = useSession((s) => s.token);
  const [day, setDay] = useState(localToday());
  const tz = deviceTimezone();

  const summary = useQuery({
    queryKey: ["summary", day, tz],
    queryFn: () => api.dailySummary(token!, day, tz),
    enabled: Boolean(token),
  });

  // The auth gate in _layout redirects before this renders when signed out.
  if (!token) return null;

  const isToday = day === localToday();

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={() => setDay(shiftDay(day, -1))} hitSlop={12}>
          <Text style={styles.navLink}>← Previous</Text>
        </Pressable>
        <Text style={styles.date}>{isToday ? "Today" : day}</Text>
        <Pressable
          onPress={() => setDay(shiftDay(day, 1))}
          hitSlop={12}
          // There is nothing recorded in the future.
          disabled={isToday}
        >
          <Text style={[styles.navLink, isToday && styles.disabled]}>Next →</Text>
        </Pressable>
      </View>

      {summary.isLoading ? (
        <ActivityIndicator style={styles.loader} />
      ) : summary.isError ? (
        <Text style={styles.error}>Could not load this day.</Text>
      ) : (
        <SummaryBody summary={summary.data!} />
      )}
    </ScrollView>
  );
}

function SummaryBody({ summary }: { summary: DailySummary }) {
  if (summary.entry_count === 0) {
    // Stated plainly, with no nudge to write. A day with nothing in it is a
    // fact about the day, not a failure to be corrected.
    return <Text style={styles.quiet}>Nothing recorded.</Text>;
  }

  const confident = summary.inferred.filter((i) => !i.tentative);
  const tentative = summary.inferred.filter((i) => i.tentative);

  return (
    <>
      <Text style={styles.count}>
        {summary.entry_count} {summary.entry_count === 1 ? "entry" : "entries"}
      </Text>

      <Section title="What you wrote">
        {summary.observations.map((observation) => (
          <View key={observation.id} style={styles.card}>
            <Text style={styles.body}>{observation.content}</Text>
            <Text style={styles.meta}>
              {new Date(observation.captured_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          </View>
        ))}
      </Section>

      {summary.recurring.length > 0 && (
        <Section title="Came up more than once">
          {summary.recurring.map((item) => (
            <Text key={`${item.kind}-${item.label}`} style={styles.body}>
              {item.label}{" "}
              <Text style={styles.meta}>in {item.entries} entries</Text>
            </Text>
          ))}
        </Section>
      )}

      {confident.length > 0 && (
        <Section title="Noticed">
          {confident.map((item) => (
            <Inference key={item.id} item={item} />
          ))}
        </Section>
      )}

      {tentative.length > 0 && (
        <Section title="Less sure about">
          {/* Kept in a separate section rather than mixed in and greyed out.
              A low-confidence guess sitting next to a confident one reads as
              equally true no matter how it is styled. */}
          {tentative.map((item) => (
            <Inference key={item.id} item={item} tentative />
          ))}
        </Section>
      )}

      <Text style={styles.footnote}>
        Everything under “Noticed” and “Less sure about” is a guess drawn from
        your entries, not a conclusion about you. Tap one to see which words it
        came from.
      </Text>
    </>
  );
}

function Inference({
  item,
  tentative = false,
}: {
  item: DailySummary["inferred"][number];
  tentative?: boolean;
}) {
  return (
    <View style={[styles.card, tentative && styles.cardTentative]}>
      <Text style={styles.body}>{item.label}</Text>
      <Text style={styles.meta}>
        {item.kind.toLowerCase()} · {Math.round(item.confidence * 100)}% confident
      </Text>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 8, paddingBottom: 40 },
  nav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  navLink: { color: "#3f3f46", fontWeight: "600" },
  disabled: { opacity: 0.3 },
  date: { fontSize: 18, fontWeight: "700" },
  count: { fontSize: 14, color: "#71717a" },
  section: { marginTop: 20, gap: 8 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#71717a",
  },
  card: {
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  cardTentative: { borderStyle: "dashed", borderColor: "#d4d4d8" },
  body: { fontSize: 16, lineHeight: 22 },
  meta: { fontSize: 12, color: "#71717a" },
  quiet: { color: "#71717a", marginTop: 32, textAlign: "center", fontSize: 16 },
  loader: { marginTop: 32 },
  error: { color: "#b91c1c", marginTop: 32, textAlign: "center" },
  footnote: {
    marginTop: 28,
    fontSize: 12,
    lineHeight: 18,
    color: "#a1a1aa",
  },
});
