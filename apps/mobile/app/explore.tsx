import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";

import { Observatory, Readout } from "@/components/Observatory";
import { api, type Subgraph } from "@/lib/api";
import { useSession } from "@/state/session";

/**
 * The graph, as a thing in space.
 *
 * Previously a settled force layout on a flat canvas. The forces were doing two
 * jobs at once — separating nodes so they could be tapped, and implying that
 * proximity meant relatedness. The second was never true: a spring layout puts
 * things near each other for reasons that have nothing to do with what they mean,
 * and people read adjacency as significance.
 *
 * Here position carries no meaning at all. Points sit on a sphere by id, evenly
 * spread, and the *edges* carry the relationships — visibly, as threads you can
 * follow. Nothing is implied by where a thing sits, which is the honest version.
 * Turning the object is how you see behind things.
 */
export default function ExploreScreen() {
  const token = useSession((s) => s.token);
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);

  const graph = useQuery({
    queryKey: ["graph", "explore"],
    queryFn: () => api.graph(token!, { limit: 200 }),
    enabled: Boolean(token),
  });

  if (!token) return null;

  const subgraph: Subgraph | undefined = graph.data;
  const nodes = subgraph?.nodes ?? [];
  const current = nodes.find((n) => n.id === selected) ?? null;

  return (
    <Observatory
      eyebrow="Everything, connected"
      data={nodes.map((node) => ({
        id: node.id,
        // Entries are the fixed points the inferences hang off, so they read as
        // the heaviest things present regardless of any confidence score.
        weight: node.kind === "Observation" ? 1 : (node.confidence ?? 0.5),
        tone: node.kind,
        tentative: Boolean(node.tentative),
        // Confirmed readings pull into a core, rejected ones drift out and dim.
        status: node.epistemic_status,
      }))}
      links={(subgraph?.edges ?? []).map((edge) => ({
        from: edge.from_id,
        to: edge.to_id,
      }))}
      selected={selected}
      onSelect={setSelected}
      loading={graph.isLoading}
      error={graph.isError ? "Could not load the graph." : null}
      empty="Nothing to explore yet. Write an entry and the graph starts here."
      hint={
        subgraph?.truncated
          ? `Showing ${subgraph.returned} of ${subgraph.total_nodes}. Filled is observed, hollow is a guess.`
          : "Filled is something you wrote. Hollow is a guess. Drag to turn it."
      }
      detail={
        current && (
          <Readout
            tone={current.kind}
            label={current.label}
            meta={
              current.confidence !== null
                ? `${Math.round(current.confidence * 100)}% confident`
                : undefined
            }
            tentative={Boolean(current.tentative)}
            onOpen={() => router.push(`/node/${current.id}`)}
          />
        )
      }
    />
  );
}
