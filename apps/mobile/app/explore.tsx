import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";

import { GraphPanel } from "@/components/GraphPanel";
import { Observatory, Readout } from "@/components/Observatory";
import { api, type Subgraph } from "@/lib/api";
import { useSession } from "@/state/session";
import { HEADINGS } from "@tlon/copy/headings";
import { EMPTY as EMPTY_COPY } from "@tlon/copy/empty";

/**
 * The graph, as a thing in space.
 *
 * Previously a settled force layout on a flat canvas. The forces were doing two
 * jobs at once — separating nodes so they could be tapped, and implying that
 * proximity meant relatedness. The second was never true: a spring layout puts
 * things near each other for reasons that have nothing to do with what they mean,
 * and people read adjacency as significance.
 *
 * Here position carries no meaning at all: a node sits where its own id puts it,
 * so the same graph settles the same way every time, and the *edges* carry the
 * relationships. Nothing is implied by where a thing sits.
 *
 * The web draws this as a flat panel and so does this now. The sphere inside a
 * head silhouette was this client's own, and it made two claims the app does not
 * get to make — that the record is a picture of a mind, and that turning it
 * reveals something. Both clients read positions from the same `seed`, so a node
 * is in the same place in both.
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
      eyebrow={HEADINGS.explore.kicker}
      // The design titles this with what the screen claims rather than what it
      // is called, and the claim is the whole point of the screen: nothing here
      // is settled, so nothing can be read into where a thing sits.
      guide="explore"
      title={HEADINGS.explore.title}
      stage={
        nodes.length > 0 && !graph.isLoading ? (
          <GraphPanel
            nodes={nodes.map((node) => ({
              id: node.id,
              label: node.label,
              kind: node.kind,
              tentative: Boolean(node.tentative),
            }))}
            edges={(subgraph?.edges ?? []).map((edge) => ({
              from: edge.from_id,
              to: edge.to_id,
            }))}
            onSelect={(node) => setSelected(node.id)}
          />
        ) : undefined
      }
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
      empty={EMPTY_COPY.explore}
      hint={
        subgraph?.truncated
          ? `Showing ${subgraph.returned} of ${subgraph.total_nodes}. Position carries no meaning — the edges carry the relationships.`
          : "Position carries no meaning — the edges carry the relationships. Tap a point to name it."
      }
      detail={
        current && (
          <Readout
            tone={current.kind}
            sealId={current.id}
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
