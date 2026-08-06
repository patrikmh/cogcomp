import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { Empty, Failed, Loading } from "@/components/States";
import { api } from "@/lib/api";
import { seed } from "@/lib/seal";

/**
 * What ran while you were not looking.
 *
 * Every attempt, including the ones that did nothing — "nothing ran" and
 * "something ran and found nothing" are different answers to someone asking why
 * their graph changed. Counts only; the log must never become a second copy of
 * someone's private writing.
 */
export function Agents() {
  const client = useQueryClient();
  const runs = useQuery({ queryKey: ["agent-runs"], queryFn: () => api.agentRuns(50) });
  const run = useMutation({
    mutationFn: api.runAgents,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["agent-runs"] }),
  });

  return (
    <>
      <div className="p-head">
        <div>
          <span className="kicker">Machinery</span>
          <h1>Agent activity</h1>
        </div>
        <button className="btn" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "RUNNING…" : "RUN NOW"}
        </button>
      </div>

      {runs.isLoading ? (
        <Loading />
      ) : runs.isError ? (
        <Failed />
      ) : (runs.data ?? []).length === 0 ? (
        <Empty label="Nothing has run yet." />
      ) : (
        runs.data!.map((r) => (
          <div className="card" key={r.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>{r.agent}</b>
              <span className="mono" style={{ color: statusColor(r.status) }}>
                {r.status}
              </span>
            </div>
            <span className="mono" style={{ color: "var(--faint)" }}>
              {new Date(r.started_at).toLocaleString()} · {r.version} · {r.trigger}
              {r.error ? ` · ${r.error}` : ""}
            </span>
            <div className="mono" style={{ marginTop: 6 }}>
              {summarise(r.summary)}
            </div>
          </div>
        ))
      )}
    </>
  );
}

const statusColor = (status: string) =>
  status === "failed" ? "var(--rust)" : status === "skipped" ? "var(--sand)" : "var(--live)";

const summarise = (summary: Record<string, unknown>) =>
  Object.entries(summary)
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
    .join(" · ") || "nothing to report";

/** The dashboard: what is in the graph, and a way into any of it. */
export function Graph() {
  const summary = useQuery({ queryKey: ["graph-summary"], queryFn: api.graphSummary });

  if (summary.isLoading) return <Loading />;
  if (summary.isError || !summary.data) return <Failed />;

  const total = summary.data.counts.reduce((n, c) => n + c.count, 0);
  return (
    <>
      <div className="p-head">
        <div>
          <span className="kicker">Machinery</span>
          <h1>Graph</h1>
        </div>
        <span className="mono">{total} nodes</span>
      </div>
      {summary.data.counts.map((c) => (
        <div className="card" key={c.kind}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>{c.kind.toLowerCase()}</b>
            <span className="mono">{c.count}</span>
          </div>
          <div className="p-stripwrap">
            <span
              className="p-bar"
              style={{ width: `${Math.round((c.count / Math.max(1, total)) * 100)}%` }}
            />
          </div>
        </div>
      ))}
      <Link className="btn" to="/explore">
        OPEN THE EXPLORER →
      </Link>
    </>
  );
}

/**
 * The graph in space.
 *
 * Positions are seeded from node ids, never from a force simulation: a spring
 * layout puts things near each other for reasons that have nothing to do with
 * meaning, and people read adjacency as significance. The edges carry the
 * relationships; the positions carry nothing.
 */
export function Explore() {
  const graph = useQuery({ queryKey: ["graph"], queryFn: () => api.graph(200) });

  if (graph.isLoading) return <Loading />;
  if (graph.isError || !graph.data) return <Failed />;

  const nodes = graph.data.nodes.filter((n) => n.kind !== "Observation");
  const at = new Map(
    nodes.map((n) => {
      const rnd = seed(n.id);
      return [n.id, { x: 60 + rnd() * 680, y: 60 + rnd() * 420 }] as const;
    }),
  );

  return (
    <>
      <div className="p-head">
        <div>
          <span className="kicker">Machinery</span>
          <h1>Explore</h1>
        </div>
        <span className="mono">{nodes.length} in view</span>
      </div>
      <svg id="explore" viewBox="0 0 800 540" role="img" aria-label="The graph, as points and threads">
        {graph.data.edges.map((e, i) => {
          const a = at.get(e.from_id);
          const b = at.get(e.to_id);
          if (!a || !b) return null;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--line2)" />;
        })}
        {nodes.map((n) => {
          const p = at.get(n.id)!;
          return (
            <g key={n.id}>
              <circle
                cx={p.x}
                cy={p.y}
                r={n.tentative ? 4 : 6}
                fill={n.tentative ? "none" : "var(--kept)"}
                stroke={n.tentative ? "var(--sand)" : "none"}
              />
              <text x={p.x + 10} y={p.y + 4} fill="var(--dim)" fontSize="11">
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="rest mono">
        Position means nothing here — points sit where their id puts them. The threads are the
        relationships.
      </p>
    </>
  );
}
