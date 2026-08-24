import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { MotionSurface } from "@/components/MotionSurface";
import { IdentityComposition } from "@/components/IdentityComposition";
import { IdentitySummary } from "@/components/IdentitySummary";
import { Observatory } from "@/components/Observatory";
import {
  api,
  type IdentityCandidates,
  type IdentityNode,
  type IdentityProjection,
} from "@/lib/api";
import { useSession } from "@/state/session";
import { usePreferences } from "@/state/preferences";
import { colors, fonts } from "@/theme";
import { type as scale } from "@tlon/design";
import { Kicker } from "@/components/Marks";
import { Seal } from "@/components/Seal";
import { HEADINGS } from "@tlon/copy/headings";
import { EMPTY as EMPTY_COPY } from "@tlon/copy/empty";
import { heldFirst, inRoomOf, unhintedHoldsOf } from "@/lib/drawnFrom";
import { SECTIONS, asideOf } from "@tlon/copy/sections";

/**
 * Identity, as something you assemble rather than something you are told.
 *
 * Everything the extractor has ever suggested about you is here at once. What you
 * have kept is lit; what has only been suggested is hollow. Nothing moves between
 * those states except by you tapping it, and it is the same object either way —
 * placing a theme changes how it is drawn, not where it sits.
 *
 * That is the argument the screen makes. A profile page states what you are. This
 * shows what has been noticed, marks which of it you recognised, and leaves the
 * rest visible but unclaimed. Both lists previously sat below a decorative sky of
 * positioned dots that stood for nothing; now the sky is the data.
 */
export default function IdentityScreen() {
  const token = useSession((s) => s.token);
  const userId = useSession((s) => s.userId);
  const router = useRouter();
  // The design sizes this `min(64vh, 440px)` and lets it fill the screen. This
  // client pinned it at 280, which on a phone left the composition floating in
  // the middle of its own stage — a picture of everything known about someone,
  // drawn smaller than the counts underneath it. Width is capped too, which the
  // design gets for free from the viewport.
  const { width, height } = useWindowDimensions();
  const compositionSize = Math.min(height * 0.64, 440, width * 0.92);
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [room, setRoom] = useState<"all" | "inside" | "holds" | "around">("all");
  const showFindings = usePreferences((s) => s.findings);
  const preferencesReady = usePreferences((s) => s.ready);
  const findingsVisible = preferencesReady && showFindings;

  const scope = ["identity", userId] as const;
  const projection = useQuery<IdentityProjection>({
    queryKey: scope,
    queryFn: () => api.identity(token!, true),
    enabled: Boolean(token && userId) && findingsVisible,
  });
  const candidates = useQuery<IdentityCandidates>({
    queryKey: [...scope, "candidates"],
    queryFn: () => api.identityCandidates(token!),
    enabled: Boolean(token && userId) && findingsVisible,
  });
  const graph = useQuery({
    queryKey: ["graph", userId],
    queryFn: () => api.graph(token!, { limit: 200 }),
    enabled: Boolean(token && userId) && findingsVisible,
  });

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: scope });
  };
  const release = useMutation({
    mutationFn: (id: string) => api.updateIdentitySelection(token!, id, "removed"),
    onSuccess: invalidate,
  });
  const place = useMutation({
    mutationFn: (id: string) => api.selectIdentity(token!, id),
    onSuccess: invalidate,
  });

  if (!token) return null;

  // Queries retain cached data when disabled, so make the visibility boundary
  // explicit before any identity renderer consumes it.
  const kept = findingsVisible ? projection.data?.nodes ?? [] : [];
  const keptIds = new Set(kept.map((node: IdentityNode) => node.id));
  const offered = (findingsVisible ? candidates.data?.candidates ?? [] : []).filter(
    (node: IdentityNode) => !keptIds.has(node.id),
  );
  const everything = [...kept, ...offered];
  const scoped = inRoomOf(everything, room);
  const scopedKept = scoped.filter((node) => keptIds.has(node.id));
  const scopedOffered = scoped.filter((node) => !keptIds.has(node.id));
  // A removed reading is one the record still holds but no longer asserts — the
  // tombstone the note below the figures is about.
  const removedCount = everything.filter(
    (node: IdentityNode) => node.status === "removed",
  ).length;
  const current = scoped.find((node) => node.id === selected) ?? null;
  const isKept = current ? keptIds.has(current.id) : false;
  const unhinted = findingsVisible
    ? unhintedHoldsOf(everything, graph.data?.nodes ?? [], graph.data?.edges ?? []).slice(0, 3)
    : [];

  return (
    <Observatory
      eyebrow={HEADINGS.identity.kicker}
      guide="identity"
      title={HEADINGS.identity.title}
      // The web's composition rather than a head full of points: rings that
      // draw themselves on, the kept ones inked and doubled, the tentative ones
      // thin and faded, you at the centre already there.
      stage={
        <IdentityComposition
          size={compositionSize}
          rings={ringsForComposition(scopedKept, scopedOffered, keptIds).map((node: IdentityNode) => ({
            id: node.id,
            label: node.label,
            kind: node.kind,
            confidence: node.confidence ?? 0,
            kept: keptIds.has(node.id),
            tentative: !keptIds.has(node.id) && node.status !== "removed",
            // A reading you took back. The composition has always been able to
            // draw one — dashed, faint, and not stroked on, because it is not
            // arriving — but was passed `false` unconditionally, so the summary
            // promised that removed readings stay as a tombstone while the
            // picture beside it could never show one.
            removed: node.status === "removed",
          }))}
          onSelect={(ring) => setSelected(ring.id)}
        />
      }
      // What the picture is made of, counted — the design's four figures and
      // the sentence saying what "kept" actually buys you. The hint underneath
      // said "0 kept · 0 suggested" and stopped there, which is the size of the
      // record without the reason anyone would care about the distinction.
      belowStage={
        <>
          <IdentitySummary
            kept={kept.length}
            tentative={offered.length}
            kinds={new Set(everything.map((node: IdentityNode) => node.kind)).size}
            removed={removedCount}
          />
          {findingsVisible && everything.length > 0 && (
            <IdentityRooms
              room={room}
              onRoom={setRoom}
              inside={inRoomOf(everything, "inside").length}
              holds={inRoomOf(everything, "holds").length}
              around={inRoomOf(everything, "around").length}
            />
          )}
          {unhinted.length > 0 && (
            <View style={styles.unhinted}>
              <Kicker heading>{SECTIONS.unhinted.title}</Kicker>
              {unhinted.map((node) => (
                <MotionSurface
                  key={node.id}
                  onPress={() => router.push(`/node/${node.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${node.label} — held, not named from a thought, open this reading`}
                >
                  <Text style={styles.unhintedLabel}>{node.label}</Text>
                  <Text style={styles.unhintedMeta}>
                    {node.kind.toLowerCase()} · {asideOf("unhinted", true)}
                  </Text>
                </MotionSurface>
              ))}
            </View>
          )}
        </>
      }
      data={scoped.map((node: IdentityNode) => ({
        id: node.id,
        // Kept themes carry full weight; unplaced ones are present but slight.
        weight: keptIds.has(node.id) ? 0.95 : 0.4,
        tone: node.kind,
        // Hollow means unclaimed — the same grammar as a tentative inference, and
        // for the same reason: it is not yours until you say it is.
        tentative: !keptIds.has(node.id),
      }))}
      selected={selected}
      onSelect={setSelected}
      dotSize={9}
      loading={findingsVisible && (projection.isLoading || candidates.isLoading)}
      error={
        findingsVisible && (projection.isError || candidates.isError)
          ? "Could not load identity."
          : null
      }
      empty={
        findingsVisible
          ? EMPTY_COPY.identity
          : "Findings are turned off. Your journal is still kept."
      }
      // The figures above already say how many of each there are. The design
      // spends this line on how to read the picture instead — hovering on the
      // web, tapping here.
      hint={
        room === "all"
          ? "Tap a ring to see what it is. The dense core is you."
          : `Tap a ring. ${asideOf(room, true) ?? ""}`.trim()
      }
      detail={
        current && (
          <View style={styles.detail}>
            {/* Its own mark, as everywhere else. This screen has its own detail
                block rather than the shared Readout because it carries Place and
                Release, so the head has to be repeated here — the same head. */}
            <View style={styles.detailHead}>
              <Seal id={current.id} size={26} />
              <Kicker>
                {current.kind} · {isKept ? "kept" : "suggested"}
                {current.tentative ? " · tentative" : ""}
              </Kicker>
            </View>
            <Text style={styles.label} numberOfLines={2}>
              {current.label}
            </Text>
            <View style={styles.actions}>
              <MotionSurface
                onPress={() =>
                  isKept ? release.mutate(current.id) : place.mutate(current.id)
                }
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text style={styles.act}>{isKept ? "Release" : "Place"}</Text>
              </MotionSurface>
              <MotionSurface
                onPress={() => router.push(`/node/${current.id}`)}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text style={styles.act}>Evidence</Text>
              </MotionSurface>
            </View>
          </View>
        )
      }
    />
  );
}

function IdentityRooms({
  room,
  onRoom,
  inside,
  holds,
  around,
}: {
  room: "all" | "inside" | "holds" | "around";
  onRoom: (room: "all" | "inside" | "holds" | "around") => void;
  inside: number;
  holds: number;
  around: number;
}) {
  if (inside + holds + around === 0) return null;
  return (
    <View style={styles.rooms}>
      <RoomChip label="All" selected={room === "all"} onPress={() => onRoom("all")} />
      {inside > 0 && (
        <RoomChip
          label={`${SECTIONS.inside.title} · ${inside}`}
          selected={room === "inside"}
          onPress={() => onRoom(room === "inside" ? "all" : "inside")}
        />
      )}
      {holds > 0 && (
        <RoomChip
          label={`${SECTIONS.holds.title} · ${holds}`}
          selected={room === "holds"}
          onPress={() => onRoom(room === "holds" ? "all" : "holds")}
        />
      )}
      {around > 0 && (
        <RoomChip
          label={`${SECTIONS.around.title} · ${around}`}
          selected={room === "around"}
          onPress={() => onRoom(room === "around" ? "all" : "around")}
        />
      )}
    </View>
  );
}

function RoomChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <MotionSurface
      style={[styles.room, selected && styles.roomOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Text style={[styles.roomLabel, selected && styles.roomLabelOn]}>{label}</Text>
    </MotionSurface>
  );
}

const styles = StyleSheet.create({
  rooms: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 20,
  },
  room: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 2,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  roomOn: { borderColor: colors.ink },
  roomLabel: {
    color: colors.inkSoft,
    fontFamily: fonts.mono,
    fontSize: scale.meta.size,
  },
  roomLabelOn: { color: colors.ink },
  unhinted: { marginTop: 14, paddingHorizontal: 20, gap: 6 },
  unhintedLabel: { color: colors.ink, fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 20 },
  unhintedMeta: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: scale.meta.size,
  },
  detailHead: { flexDirection: "row", alignItems: "center", gap: 9 },
  detail: { gap: 5 },
  kind: {
    color: colors.inkMuted,
    fontFamily: fonts.mono, fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
  },
  label: { color: colors.ink, fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: "row", gap: 22, paddingTop: 2 },
  act: { color: colors.cyan, fontFamily: fonts.sans, fontSize: 13, fontWeight: "700" },
});

/**
 * The seven the composition draws, and in what order.
 *
 * The web's rule, for the web's reason: kept readings first, surest-first inside
 * each group, and never more than seven. Beyond that the loops stop reading as
 * nested contours and become a scribble — forty-three of them is a ball of wool.
 * Sorting by confidence alone would also bury what someone actually kept beneath
 * whatever the extractor was most literal about.
 */
function ringsForComposition(
  kept: IdentityNode[],
  offered: IdentityNode[],
  keptIds: Set<unknown>,
): IdentityNode[] {
  // The projection's own status, as the web reads it: a reading you took
  // back is "removed" there, which is not the same field as the epistemic
  // status the extractor set.
  const removed = (n: IdentityNode) => n.status === "removed";
  const mine = kept.filter((n) => keptIds.has(n.id)).sort(heldFirst);
  const theirs = offered.filter((n) => !keptIds.has(n.id) && !removed(n)).sort(heldFirst);
  // The tombstones go last and outside the budget of seven: they are the
  // record of something taken back, and dropping them to make room for a
  // live reading would lose exactly what the summary says is never lost.
  const tombs = [...kept, ...offered].filter(removed).sort(heldFirst).slice(0, 2);
  return [...[...mine, ...theirs].slice(0, 7), ...tombs];
}
