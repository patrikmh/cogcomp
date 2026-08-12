import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";

import { Observatory, Readout } from "@/components/Observatory";
import { api, type Pattern } from "@/lib/api";
import { patternDestination, patternMeta } from "@/lib/patterns";
import { usePreferences } from "@/state/preferences";
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
  const showFindings = usePreferences((s) => s.findings);
  const setFindings = usePreferences((s) => s.setFindings);

  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: () => api.listPatterns(token!),
    enabled: Boolean(token && userId) && showFindings,
  });

  const mine = useMutation({
    mutationFn: () => api.minePatterns(token!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["patterns", userId] });
      void queryClient.invalidateQueries({ queryKey: ["graph"] });
    },
  });

  if (!token) return null;

  if (!showFindings) {
    // A screen that says what it is not showing, and undoes it in one tap. The
    // person turned this off; nothing here should argue with that, and nothing
    // should make finding the way back a hunt through settings.
    return (
      <Observatory
        eyebrow="What keeps returning"
        data={[]}
        selected={null}
        onSelect={() => undefined}
        detail={null}
        empty="Patterns are turned off. Everything you have written is still kept, and nothing here has been deleted."
        action={{ label: "Show patterns again", onPress: () => void setFindings(true) }}
      />
    );
  }

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
            sealId={current.id}
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
