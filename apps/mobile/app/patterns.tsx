import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";

import { Observatory, Readout } from "@/components/Observatory";
import { api, type Pattern } from "@/lib/api";
import { patternDestination, patternMeta } from "@/lib/patterns";
import { useSession } from "@/state/session";

/**
 * What keeps returning.
 *
 * Recurrence is the one thing a pattern *is*, so it is what drives the picture:
 * a pattern that came up in eight entries is a bigger point than one that came up
 * in three. That is the whole legend, and it needs no key.
 *
 * The count travels with the label everywhere it appears. A pattern shown without
 * "in 4 entries across 3 days" is an assertion about someone; shown with it, it
 * is an observation they can check.
 */
export default function PatternsScreen() {
  const token = useSession((s) => s.token);
  const userId = useSession((s) => s.userId);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: () => api.listPatterns(token!),
    enabled: Boolean(token && userId),
  });

  const mine = useMutation({
    mutationFn: () => api.minePatterns(token!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["patterns", userId] });
      void queryClient.invalidateQueries({ queryKey: ["graph"] });
    },
  });

  if (!token) return null;

  const found: Pattern[] = patterns.data ?? [];
  const busiest = Math.max(...found.map((p) => p.occurrences), 1);
  const current = found.find((p) => p.id === selected) ?? null;

  return (
    <Observatory
      eyebrow="What keeps returning"
      data={found.map((pattern) => ({
        id: pattern.id,
        // Relative to the strongest, so the picture is about this person's own
        // material rather than an absolute scale that means nothing to them.
        weight: pattern.occurrences / busiest,
        tone: "Pattern",
        tentative: pattern.tentative,
      }))}
      selected={selected}
      onSelect={setSelected}
      dotSize={9}
      loading={patterns.isLoading}
      error={patterns.isError ? "Could not load patterns." : null}
      empty="Nothing has come back often enough to call a pattern yet."
      hint={
        found.length > 0
          ? `${found.length} ${found.length === 1 ? "thing" : "things"} recurred. Bigger means more often — turn it, then tap one.`
          : undefined
      }
      detail={
        current && (
          <Readout
            tone="pattern"
            label={current.label}
            meta={patternMeta(current)}
            tentative={current.tentative}
            openLabel={patternDestination(current).label}
            onOpen={() => router.push(patternDestination(current).href)}
          />
        )
      }
      action={{
        label: mine.isPending ? "Looking…" : "Look again",
        onPress: () => mine.mutate(),
        pending: mine.isPending,
      }}
      secondaryAction={{ label: "Open experiments", onPress: () => router.push("/experiments") }}
    />
  );
}
