import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Chip, Kicker } from "@/components/Marks";
import { DAY_STAGGER_CAP_MS, DAY_STAGGER_MS, Rise } from "@/components/Rise";
import { MotionSurface } from "@/components/MotionSurface";
import { Seal } from "@/components/Seal";
import Svg, { Path } from "react-native-svg";
import { RecordButton } from "@/components/RecordButton";
import { ApiError, api, type ObservationResponse, type Pattern } from "@/lib/api";
import { deviceTimezone } from "@/lib/dates";
import { useAmong, useDrawnFrom } from "@/lib/drawnFrom";
import { patternDestination } from "@/lib/patterns";
import { uuidv7 } from "@/lib/ids";
import { useSession } from "@/state/session";
import { forgetCapture, pendingCaptures, rememberCapture, type PendingCapture } from "@/state/pendingCapture";
import { usePreferences } from "@/state/preferences";
import { colors, fonts } from "@/theme";
import { type as scale } from "@tlon/design";
import { radii } from "@tlon/design";
import { HEADINGS } from "@tlon/copy/headings";
import { EMPTY as EMPTY_COPY } from "@tlon/copy/empty";

/**
 * The journal.
 *
 * Two things live here and they are not equal: writing something down, and
 * looking at what you have written. Writing wins — the field is under your thumb,
 * with nothing stacked above it explaining what a journal is.
 *
 * What you have written is the sky above it. Every entry is a point, the newest
 * largest, and the newest is already selected — so saving something shows it back
 * to you rather than dropping it into a list. Tapping any point reads it out;
 * tapping the readout goes to what was drawn from it.
 *
 * The previous version opened with a kicker, a title, a subtitle and a framed
 * decorative field before reaching the input, then listed every entry below. All
 * of that was explaining a screen that stops needing explanation once it shows
 * less at once.
 */
export default function JournalScreen() {
  const token = useSession((s) => s.token);
  const userId = useSession((s) => s.userId);
  const signOut = useSession((s) => s.signOut);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [pendingVoice, setPendingVoice] = useState<PendingCapture[]>([]);
  const [pendingText, setPendingText] = useState<PendingCapture[]>([]);
  const restoreGeneration = useRef(0);
  const voiceIds = useRef(new Map<string, string>());
  const showFindings = usePreferences((s) => s.findings);
  const preferencesReady = usePreferences((s) => s.ready);
  const findingsVisible = preferencesReady && showFindings;
  const timezone = deviceTimezone();
  useEffect(() => {
    const generation = ++restoreGeneration.current;
    setDraft("");
    setPendingVoice([]);
    setPendingText([]);
    if (!userId) return;
    void pendingCaptures(userId).then((captures) => {
      if (generation !== restoreGeneration.current || useSession.getState().userId !== userId) return;
      setPendingText(captures.filter((capture) => capture.source === "text"));
      setPendingVoice(captures.filter((capture) => capture.source === "voice"));
    });
  }, [userId]);

  const observations = useQuery({
    queryKey: ["observations", userId],
    queryFn: () => api.listObservations(token!),
    enabled: Boolean(token && userId),
  });

  // Derived provenance is opt-in and must not be fetched or read from the
  // React Query cache while findings are hidden. Observations remain raw journal
  // content and continue to render normally.
  const drawnFrom = useDrawnFrom(token, userId, 4, findingsVisible);
  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: () => api.listPatterns(token!),
    enabled: Boolean(token && userId) && findingsVisible,
  });
  const foundPatterns: Pattern[] = patterns.data ?? [];
  const among = useAmong(token, userId, foundPatterns, 4, findingsVisible);

  const capture = useMutation({
    mutationFn: async ({ content, id }: { content: string; id: string }) => {
      // An existing envelope is reused only when Retry supplies its ID. Normal
      // submissions mint a fresh ID before reaching this mutation.
      const existing = (await pendingCaptures(userId!)).find((item) => item.id === id);
      const envelope: PendingCapture = existing ?? { id, userId: userId!, content, source: "text", capturedAt: new Date().toISOString(), timezone };
      await rememberCapture(envelope);
      if (useSession.getState().userId === userId) setPendingText((items) => items.some((item) => item.id === envelope.id) ? items : [...items, envelope]);
      return api.createObservation(token!, { ...envelope, content: envelope.content! });
    },
    onSuccess: async (created, { content }) => {
      if (useSession.getState().userId !== userId) return;
      await forgetCapture(userId!, created.id);
      setPendingText((items) => items.filter((item) => item.id !== created.id));
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: ["observations", userId] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
    },
  });

  const captureVoice = useMutation({
    mutationFn: async ({ uri, id }: { uri: string; id: string }) => {
      const existing = (await pendingCaptures(userId!)).find((item) => item.id === id);
      const envelope: PendingCapture = existing ?? { id, userId: userId!, source: "voice", uri, capturedAt: new Date().toISOString(), timezone };
      await rememberCapture(envelope);
      if (useSession.getState().userId === userId) setPendingVoice((items) => items.some((item) => item.id === envelope.id) ? items : [...items, envelope]);
      return api.createVoiceObservation(token!, { id: envelope.id, uri: envelope.uri!, capturedAt: envelope.capturedAt, timezone: envelope.timezone });
    },
    onSuccess: async (_, { id, uri }) => {
      if (useSession.getState().userId !== userId) return;
      await forgetCapture(userId!, id);
      setPendingVoice((items) => items.filter((item) => item.id !== id));
      voiceIds.current.delete(uri);
      void queryClient.invalidateQueries({ queryKey: ["observations", userId] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
    },
  });

  // The auth gate in _layout redirects before this renders when signed out.
  if (!token) return null;

  const entries: ObservationResponse[] = observations.data?.observations ?? [];
  const drafting = draft.trim().length > 0;
  // Grouped by the day they were written, newest first — the web's `groups`.
  const days = entries.reduce<{ day: string; list: ObservationResponse[] }[]>((acc, entry) => {
    const day = dayLabel(entry.captured_at);
    const group = acc.find((g) => g.day === day);
    if (group) group.list.push(entry);
    else acc.push({ day, list: [entry] });
    return acc;
  }, []);

  return (
    <View style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content}>
      {/* The stream, as the web has it: a head with the entries floating
          inside it was this client's own idea and not the product's. Days are
          headed and ruled, each act carries its seal, its time and what was
          drawn from it. */}
      <View style={styles.head}>
        <Kicker>{HEADINGS.journal.kicker}</Kicker>
        <Text style={styles.count}>
          {observations.isSuccess
            ? `${entries.length} ${entries.length === 1 ? "act" : "acts"} kept`
            : ""}
        </Text>
      </View>

      {entries.length === 0 && observations.isSuccess ? (
        <Text style={styles.empty}>{EMPTY_COPY.journal}</Text>
      ) : (
        days.map((group, gi) => (
          <View key={group.day}>
            <View style={styles.day}>
              <Kicker heading>{group.day}</Kicker>
              <View style={styles.rule} />
            </View>
            {group.list.map((entry, i) => (
              // Delayed by its day, not by its position in the stream: the
              // design cascades `.j-day` at 55ms and lets the acts inside a day
              // arrive with it, so a day reads as a day rather than as a list
              // of separately arriving lines.
              <Rise
                key={entry.id}
                index={gi}
                stagger={DAY_STAGGER_MS}
                cap={DAY_STAGGER_CAP_MS}
              >
                <View style={styles.entry}>
                  <Text style={styles.time}>{shortTime(entry.captured_at)}</Text>
                  {/* A hairline with a dot on it, filled on the latest act and
                      hollow on the rest — the design's `.j-spine`. This was a
                      2px cyan bar, which spent the colour this product reserves
                      for what is live on saying "here is a list". */}
                  <View style={styles.spine}>
                    <View style={styles.spineLine} />
                    <View style={[styles.spineDot, gi === 0 && i === 0 && styles.spineDotLatest]} />
                  </View>
                  <View style={styles.act}>
                    <Seal id={entry.id} size={gi === 0 && i === 0 ? 58 : 52} />
                    <View style={styles.actBody}>
                      <MotionSurface
                        style={styles.entryTextControl}
                        onPress={() => router.push(`/node/${entry.id}`)}
                        accessibilityRole="button"
                        accessibilityLabel={entry.content}
                      >
                        {gi === 0 && i === 0 && <Kicker>Latest · saved</Kicker>}
                        <Text style={[styles.entryText, gi === 0 && i === 0 && styles.entryTextLatest]}>
                          {entry.content}
                        </Text>
                      </MotionSurface>
                      {findingsVisible && (drawnFrom.get(entry.id)?.length ?? 0) > 0 ? (
                        <View style={styles.chipRow}>
                          {/* On the newest entry only, and only while the words
                              are still the ones in front of you: the kicker asks
                              rather than announces. Everywhere else it states.
                              A product that never nags cannot open a queue, but
                              it can ask once, about the thing you just wrote,
                              where saying no costs a tap. */}
                          <Kicker>
                            {gi === 0 && i === 0 ? "Drawn from this · does it fit?" : "Drawn from this"}
                          </Kicker>
                          <View style={styles.chips}>
                            {drawnFrom.get(entry.id)!.slice(0, 4).map((r) => (
                              <Chip
                                key={r.id}
                                label={r.label}
                                confidence={r.confidence}
                                tentative={r.tentative}
                                onPress={() => router.push(`/node/${r.id}`)}
                              />
                            ))}
                          </View>
                        </View>
                      ) : findingsVisible ? (
                        <Text style={styles.readoutOpen}>nothing drawn from this yet</Text>
                      ) : null}
                      {findingsVisible && (among.get(entry.id)?.length ?? 0) > 0 && (
                        <View style={styles.chipRow}>
                          <Kicker>This act is among</Kicker>
                          <View style={styles.chips}>
                            {among.get(entry.id)!.slice(0, 3).map((pattern) => (
                              <Chip
                                key={pattern.id}
                                label={pattern.label.split(" · ")[0] ?? pattern.label}
                                confidence={pattern.confidence}
                                tentative={pattern.tentative}
                                onPress={() => router.push(patternDestination(pattern).href)}
                              />
                            ))}
                          </View>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              </Rise>
            ))}
          </View>
        ))
      )}

      {/* Looking for something you wrote starts from where your words are. */}
      {entries.length > 0 && (
        <MotionSurface
          onPress={() => router.push("/search")}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={styles.findLink}>Find an entry →</Text>
        </MotionSurface>
      )}

    </ScrollView>

    {/* Pinned above the tab bar, as the design pins it. It used to sit at the
        end of the stream, so writing something meant scrolling past everything
        already written to reach the box — the one action the screen exists for
        was the hardest thing on it to get to.

        One row: the words, the microphone, and a way to keep them. */}
    <View style={styles.dock}>
      <View style={styles.cap}>
        <TextInput
          style={styles.capText}
          value={draft}
          onChangeText={setDraft}
          placeholder="Write what happened"
          placeholderTextColor={colors.inkMuted}
          multiline
          editable={!capture.isPending}
          accessibilityLabel="Journal entry"
        />
        {(pendingText.length > 0 || pendingVoice.length > 0) && (
          <View style={styles.recovery}>
            {pendingText.map((item) => item.content && <View key={item.id} style={styles.recoveryRow}>
              <Text style={styles.recoveryText}>An entry is waiting to be saved.</Text>
              <MotionSurface disabled={capture.isPending} onPress={() => capture.mutate({ content: item.content!, id: item.id })} accessibilityRole="button" accessibilityLabel="Retry journal entry"><Text style={styles.recoveryAction}>Retry</Text></MotionSurface>
              <MotionSurface onPress={async () => { await forgetCapture(userId!, item.id); setPendingText((items) => items.filter((candidate) => candidate.id !== item.id)); }} accessibilityRole="button" accessibilityLabel="Discard journal entry"><Text style={styles.recoveryAction}>Discard</Text></MotionSurface>
            </View>)}
            {pendingVoice.map((item) => (
              <View key={item.id} style={styles.recoveryRow}>
                <Text style={styles.recoveryText}>A recording is waiting to be saved.</Text>
                <MotionSurface disabled={captureVoice.isPending} onPress={() => item.uri && captureVoice.mutate({ uri: item.uri, id: item.id })} accessibilityRole="button" accessibilityLabel="Retry recording"><Text style={styles.recoveryAction}>Retry</Text></MotionSurface>
                <MotionSurface onPress={async () => { await forgetCapture(userId!, item.id); setPendingVoice((items) => items.filter((candidate) => candidate.id !== item.id)); }} accessibilityRole="button" accessibilityLabel="Discard recording"><Text style={styles.recoveryAction}>Discard</Text></MotionSurface>
              </View>
            ))}
          </View>
        )}
        <RecordButton
          compact
          tone="dark"
          disabled={capture.isPending}
          onRecorded={async (uri) => {
            const id = voiceIds.current.get(uri) ?? uuidv7();
            voiceIds.current.set(uri, id);
            await captureVoice.mutateAsync({ uri, id });
          }}
        />
        {/* Only once there are words to keep. With nothing written the only
            sensible action is to speak, and offering both asks a question that
            answers itself. */}
        {drafting && (
          <MotionSurface
            style={styles.send}
            disabled={capture.isPending}
            onPress={() => {
              const content = draft.trim();
              // Every new submission gets its own immutable envelope. Only the
              // explicit Retry action supplies an existing pending ID.
              capture.mutate({ content, id: uuidv7() });
            }}
            accessibilityRole="button"
            accessibilityLabel="Save this entry"
          >
            <Svg width={22} height={22} viewBox="0 0 24 24">
              <Path
                d="M4 12h15M13 6l6 6-6 6"
                fill="none"
                stroke={capture.isPending ? colors.inkMuted : colors.ink}
                strokeWidth={1.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </MotionSurface>
        )}
      </View>

      <Text style={styles.capState} accessibilityLiveRegion="polite">
        {capture.isPending
          ? "Keeping it…"
          : capture.isError
            ? capture.error instanceof ApiError
              ? capture.error.message
              : "Could not save. Your words are still here — try again."
            : captureVoice.isError
              ? captureVoice.error instanceof ApiError
                ? captureVoice.error.message
                : "Could not save that recording."
              : "Kept on your account · ready"}
      </Text>
    </View>
    </View>
  );
}

/** Just the clock time. The date is almost always today, and when it is not the
 *  constellation has already said so by drawing the point small. */
function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  /** The design's `#dock`: pinned, ruled off from the stream above it. */
  dock: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: colors.room,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  cap: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  capText: {
    // A zero basis, or the textarea claims its intrinsic width on web and
    // shoulders the microphone out of the row — the same trap the tab bar hit.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 44,
    maxHeight: 180,
    paddingVertical: 11,
    color: colors.ink,
    fontFamily: fonts.sans,
    fontSize: scale.body.size,
    lineHeight: scale.body.line,
    outlineStyle: "none",
  } as object,
  send: {
    width: 44,
    height: 44,
    // The row bottom-aligns its controls; this one carries its own alignment
    // because MotionSurface wraps it and the wrapper is what the row lays out.
    alignSelf: "flex-end",
    alignItems: "center",
    justifyContent: "center",
  },
  recovery: { paddingBottom: 6, gap: 4 },
  recoveryText: { color: colors.warning, fontFamily: fonts.sans, fontSize: 12 },
  recoveryRow: { flexDirection: "row", gap: 18 },
  recoveryAction: { color: colors.cyan, fontFamily: fonts.sans, fontWeight: "700" },
  capState: {
    paddingTop: 8,
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  screen: { flex: 1, backgroundColor: colors.room },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 10, paddingTop: 8 },
  sky: { alignItems: "center", justifyContent: "center" },
  readout: { flexDirection: "row", gap: 12, paddingVertical: 4 },
  spine: { width: 22, alignSelf: "stretch" },
  spineLine: {
    position: "absolute",
    left: "50%",
    top: 24,
    bottom: 0,
    width: 1,
    backgroundColor: colors.line,
  },
  spineDot: {
    position: "absolute",
    left: 8,
    top: 25,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.room,
  },
  spineDotLatest: { borderColor: colors.ink, backgroundColor: colors.ink },
  spineDraft: { backgroundColor: colors.violet },
  chipDraft: {
    color: colors.violet,
    fontFamily: fonts.sans, fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  count: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 12 },
  empty: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, paddingVertical: 10 },
  day: { flexDirection: "row", alignItems: "baseline", gap: 14, marginTop: 30, marginBottom: 4 },
  rule: { flex: 1, height: 1, backgroundColor: colors.line },
  // Time down the left, a hairline spine, then the act — the web's j-entry.
  entry: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 8 },
  entryTextControl: { alignSelf: "stretch" },
  // Right-aligned against the spine, dropped to meet the first line of the act
  // rather than the top of its seal — the design's `.j-time`.
  time: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: 0.6,
    minWidth: 40,
    textAlign: "right",
    paddingTop: 20,
  },
  act: { flex: 1, flexDirection: "row", gap: 10, alignItems: "flex-start" },
  actBody: { flex: 1, gap: 6 },
  entryText: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 15.5, lineHeight: 24 },
  /** The design sets the newest act larger and in full ink — `.j-entry.latest
   *  .j-act p` is 19/30. The seal already grew for it; the words did not,
   *  so the promotion read as a bigger stamp on the same paragraph. */
  entryTextLatest: { color: colors.ink, fontSize: 19, lineHeight: 30 },
  chipRow: { gap: 6 },
  readoutBody: { flex: 1, gap: 5 },
  drawn: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  // Wraps, as the design's `.j-meta` wraps and as Today and Find already do.
  // Without it the readings drawn from an entry ran off the side of the phone:
  // the first two showed, the third was clipped mid-word, and the rest were
  // simply not on the screen. An entry that produced four readings looked like
  // it had produced two and a half.
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  chip: {
    color: colors.cyan,
    fontFamily: fonts.sans, fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  chipQuiet: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2 },
  findLink: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 12, paddingVertical: 6 },
  readoutOpen: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  readoutHint: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  readoutText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, lineHeight: 23 },
  input: {
    backgroundColor: colors.roomRaised,
    // Only the left edge is lit, and it is the same cyan as the point the entry
    // will become. The field reads as the mouth of the sky above it rather than
    // as a form control that happens to be nearby.
    borderLeftWidth: 2,
    borderLeftColor: colors.lineStrong,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: colors.line,
    borderRightColor: colors.line,
    borderBottomColor: colors.line,
    borderRadius: radii.surface,
    color: colors.ink,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fonts.sans, fontSize: 17,
    lineHeight: 24,
    minHeight: 96,
    textAlignVertical: "top",
  },
  inputActive: { borderLeftColor: colors.violet, backgroundColor: colors.surface },
  button: {
    backgroundColor: colors.violet,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: "center",
  },
  buttonLabel: { color: colors.room, fontFamily: fonts.sans, fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.35 },
  error: { color: colors.danger, fontFamily: fonts.sans, fontSize: 13 },
  talk: { paddingVertical: 6 },
  talkLabel: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 14, fontWeight: "700" },
});

/** Today, Yesterday, or the date — the web's `dayLabelOf`, in this client's
 *  words. Grouping by a raw ISO day would be accurate and unreadable. */
function dayLabel(iso: string): string {
  // Local days throughout, not UTC ones.
  //
  // The grouping compared `toISOString` dates — which are UTC — and then
  // formatted them with `toLocaleDateString`, which is not. An entry written at
  // one in the morning is the previous day in UTC and this day where the person
  // was, so it was filed under "Yesterday" and then dated with today: the
  // journal showed "TODAY · SATURDAY 15 AUGUST" and "YESTERDAY · SATURDAY 15
  // AUGUST", one above the other.
  const localDayOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const day = localDayOf(new Date(iso));
  const today = localDayOf(new Date());
  const yesterday = localDayOf(new Date(Date.now() - 86400000));
  // The design names the day *and* dates it — "Today · Wednesday 4 February".
  // "Today" alone is unambiguous only while you are reading it today; scrolled
  // back a week it is the one heading that cannot be checked against anything.
  // Assembled part by part rather than asked for whole. Requesting all three
  // at once hands the order to the runtime's locale, which on a US default
  // returns "Saturday, August 15" — the month before the day, and a comma the
  // design does not have. The parts are still localised; only their order is
  // ours, and it is the design's.
  const at = new Date(iso);
  const weekday = at.toLocaleDateString([], { weekday: "long" });
  const dayNumber = at.toLocaleDateString([], { day: "numeric" });
  const month = at.toLocaleDateString([], { month: "long" });
  const dated = `${weekday} ${dayNumber} ${month}`;
  if (day === today) return `Today · ${dated}`;
  if (day === yesterday) return `Yesterday · ${dated}`;
  return dated;
}
