import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { MotionSurface } from "@/components/MotionSurface";
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
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const scope = ["identity", userId] as const;
  const projection = useQuery<IdentityProjection>({
    queryKey: scope,
    queryFn: () => api.identity(token!),
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
  const current = everything.find((node) => node.id === selected) ?? null;
  const isKept = current ? keptIds.has(current.id) : false;

  return (
    <Observatory
      eyebrow="What you keep close"
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
      empty="Nothing has been suggested yet. This fills in as you write."
      hint={`${kept.length} kept · ${offered.length} suggested. Filled is yours — tap one.`}
      detail={
        current && (
          <View style={styles.detail}>
            <Text style={styles.kind}>
              {current.kind.toLowerCase()} · {isKept ? "kept" : "suggested"}
              {current.tentative ? " · tentative" : ""}
            </Text>
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
