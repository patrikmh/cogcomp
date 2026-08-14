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
import { colors, fonts } from "@/theme";
import { type as scale } from "@tlon/design";
import { Kicker } from "@/components/Marks";
import { Seal } from "@/components/Seal";
import { HEADINGS } from "@tlon/copy/headings";
import { EMPTY as EMPTY_COPY } from "@tlon/copy/empty";

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

  const scope = ["identity", userId] as const;
  const projection = useQuery<IdentityProjection>({
    queryKey: scope,
    queryFn: () => api.identity(token!, true),
    enabled: Boolean(token && userId),
  });
  const candidates = useQuery<IdentityCandidates>({
    queryKey: [...scope, "candidates"],
    queryFn: () => api.identityCandidates(token!),
    enabled: Boolean(token && userId),
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

  const kept = projection.data?.nodes ?? [];
  const keptIds = new Set(kept.map((node: IdentityNode) => node.id));
  const offered = (candidates.data?.candidates ?? []).filter(
    (node: IdentityNode) => !keptIds.has(node.id),
  );
  const everything = [...kept, ...offered];
  // A removed reading is one the record still holds but no longer asserts — the
  // tombstone the note below the figures is about.
  const removedCount = everything.filter(
    (node: IdentityNode) => node.status === "removed",
  ).length;
  const current = everything.find((node) => node.id === selected) ?? null;
  const isKept = current ? keptIds.has(current.id) : false;

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
          rings={ringsForComposition(kept, offered, keptIds).map((node: IdentityNode) => ({
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
        <IdentitySummary
          kept={kept.length}
          tentative={offered.length}
          kinds={new Set(everything.map((node: IdentityNode) => node.kind)).size}
          removed={removedCount}
        />
      }
      data={everything.map((node: IdentityNode) => ({
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
      loading={projection.isLoading || candidates.isLoading}
      error={
        projection.isError || candidates.isError ? "Could not load identity." : null
      }
      empty={EMPTY_COPY.identity}
      // The figures above already say how many of each there are. The design
      // spends this line on how to read the picture instead — hovering on the
      // web, tapping here.
      hint="Tap a ring to see what it is. The dense core is you."
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

const styles = StyleSheet.create({
  detailHead: { flexDirection: "row", alignItems: "center", gap: 9 },
  detail: { gap: 5 },
  kind: {
    color: colors.inkMuted,
    fontFamily: fonts.monoMedium, fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
  },
  label: { color: colors.ink, fontFamily: fonts.sans, fontSize: 19, lineHeight: 26 },
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
  const surestFirst = (a: IdentityNode, b: IdentityNode) =>
    (b.confidence ?? 0) - (a.confidence ?? 0);
  // The projection's own status, as the web reads it: a reading you took
  // back is "removed" there, which is not the same field as the epistemic
  // status the extractor set.
  const removed = (n: IdentityNode) => n.status === "removed";
  const mine = kept.filter((n) => keptIds.has(n.id)).sort(surestFirst);
  const theirs = offered.filter((n) => !keptIds.has(n.id) && !removed(n)).sort(surestFirst);
  // The tombstones go last and outside the budget of seven: they are the
  // record of something taken back, and dropping them to make room for a
  // live reading would lose exactly what the summary says is never lost.
  const tombs = [...kept, ...offered].filter(removed).sort(surestFirst).slice(0, 2);
  return [...[...mine, ...theirs].slice(0, 7), ...tombs];
}
