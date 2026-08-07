import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Meter } from "@/components/Meter";

import { Failed, Loading } from "@/components/States";
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

  if (runs.isLoading) return <Loading />;
  if (runs.isError) return <Failed />;

  const all = runs.data ?? [];
  const wrote = all.filter((r) => r.status === "succeeded").length;
  const skipped = all.filter((r) => r.status === "skipped").length;
  const failed = all.filter((r) => r.status === "failed").length;

  return (
    <>
      <span className="kicker">Agent activity</span>
      <h1>What was decided while you were away</h1>
      <p className="sub">One line per attempt. Counts only — never what you wrote.</p>

      {/* "Nothing ran" and "something ran and found nothing" are different
          answers to someone asking why their graph changed. */}
      <div className="card" style={{ borderColor: "var(--line2)" }}>
        <p style={{ margin: 0 }}>
          {all.length === 0
            ? "Nothing has run yet."
            : `${all.length} ${all.length === 1 ? "attempt" : "attempts"} recorded: ${wrote} did work, ${skipped} had nothing to work on, ${failed} failed.`}
        </p>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "RUNNING…" : "RUN NOW"}
        </button>
        <span className="mono">A run you asked for always looks, and always reports.</span>
      </div>

      <h2>Every run</h2>
      <div className="cards">
        {all.map((r) => (
          <div className="card" key={r.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="row" style={{ gap: 10 }}>
                <i
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: statusColor(r.status),
                    display: "block",
                  }}
                />
                <b>{r.agent}</b>
              </span>
              <span className="mono">
                {new Date(r.started_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · {r.version}
              </span>
            </div>
            <p className="mono" style={{ margin: "10px 0 0" }}>
              {statusLabel(r.status)} · {summarise(r.summary)}
              {r.error ? ` · ${r.error}` : ""}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}

const statusLabel = (status: string) =>
  status === "failed"
    ? "failed"
    : status === "skipped"
      ? "nothing new to work on"
      : "wrote";

const statusColor = (status: string) =>
  status === "failed" ? "var(--rust)" : status === "skipped" ? "var(--sand)" : "var(--live)";

const summarise = (summary: Record<string, unknown>) =>
  Object.entries(summary)
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
    .join(" · ") || "nothing to report";

/** The dashboard: what is in the graph, and a way into any of it. */
export function Graph() {
  const summary = useQuery({ queryKey: ["graph-summary"], queryFn: api.graphSummary });
  const graph = useQuery({ queryKey: ["graph"], queryFn: () => api.graph(200) });
  const [tentativeOnly, setTentativeOnly] = useState(false);

  if (summary.isLoading) return <Loading />;
  if (summary.isError || !summary.data) return <Failed />;

  const total = summary.data.counts.reduce((n, c) => n + c.count, 0);
  const nodes = (graph.data?.nodes ?? []).filter((n) => n.kind !== "Observation");
  const tentative = nodes.filter((n) => n.tentative);
  const shown = tentativeOnly ? tentative : nodes;

  return (
    <>
      <span className="kicker">Graph · developer</span>
      <h1>
        {total} {total === 1 ? "node" : "nodes"}
      </h1>

      <div className="row" style={{ gap: 10 }}>
        {summary.data.counts.map((c) => (
          <span className="pill" key={c.kind}>
            {c.kind.toLowerCase()} <span className="mono">{c.count}</span>
          </span>
        ))}
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button
          className={`pill${tentativeOnly ? " tent" : ""}`}
          aria-pressed={tentativeOnly}
          onClick={() => setTentativeOnly(!tentativeOnly)}
        >
          tentative only · {tentative.length}
        </button>
        <Link className="btn ghost" to="/explore">
          OPEN EXPLORER
        </Link>
      </div>

      <h2>Any node, by name</h2>
      <div className="cards">
        {shown.map((n) => (
          <Link key={n.id} className={`card${n.tentative ? " hollow" : ""}`} to={`/node/${n.id}`}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>{n.label}</b>
              <span className="mono">{n.kind.toLowerCase()}</span>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <Meter confidence={n.confidence ?? 0} />
              <span className="mono">{(n.confidence ?? 0).toFixed(2)}</span>
            </div>
          </Link>
        ))}
      </div>
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
      <p className="sub">
        Points sit where their id puts them, never where a force settled them — a spring layout
        places things near each other for reasons that have nothing to do with meaning, and people
        read adjacency as significance. The threads are the relationships.
      </p>
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

    </>
  );
}
