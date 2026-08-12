import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Meter } from "@/components/Meter";

import { Failed, Loading } from "@/components/States";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { seed } from "@/lib/seal";
import { toneFor } from "@tlon/design";
import { Guide } from "@/components/Guide";

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
      <div className="guide-heading">
        <h1>What was decided while you were away</h1>
        <Guide id="agents" />
      </div>
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
      <div className="guide-heading">
        <h1>
          {total} {total === 1 ? "node" : "nodes"}
        </h1>
        <Guide id="graph" />
      </div>

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
              <span className="mono">
                {n.kind.toLowerCase()} · {fmt(n.confidence ?? 0)}
              </span>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <Meter confidence={n.confidence ?? 0} />
              {/* What it rests on, as the design has it. The number this used to
                  repeat here is the one the meter beside it already draws. */}
              <span className="mono">
                {n.cites_entries ?? 0} {n.cites_entries === 1 ? "entry" : "entries"}
              </span>
            </div>
            {/* The design puts a line under a dashed card saying why it is
                dashed — "unobserved 34 days — growing vague". That phrasing
                belongs to a model where a reading decays as it goes unseen, and
                this one does not have it: `tentative` here is confidence below
                0.5, full stop. So the line stays and the reason is the true
                one. A card that looks uncertain should say what makes it so. */}
            {n.tentative && (
              <div className="mono" style={{ marginTop: 8, color: "var(--faint)" }}>
                below half — held as tentative, not as knowledge
              </div>
            )}
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
  const [peek, setPeek] = useState<string | null>(null);

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
      {/* Kicker and heading as direct children, as the design has them. The
          count that used to sit up here in a row of its own is gone with the
          row: the graph screen already says how many nodes there are, and this
          screen's caption says what it is for. */}
      <span className="kicker">Explore · developer</span>
      {/* The design titles this with what the screen claims rather than what it
          is called: position here is seeded, not settled. */}
      <div className="guide-heading">
        <h1>Fixed positions, seeded by id</h1>
        <Guide id="explore" />
      </div>
      <p className="sub">
        Position carries no meaning — the same graph settles the same way every time. The edges
        carry the relationships.
      </p>
      {/* The svg goes inside `#explore`, because that is what the stylesheet
          draws the panel on — border, ground and a fixed height. With the id on
          the svg itself the rule matched nothing and the graph floated on the
          page with no edges to it. */}
      <div id="explore">
        <svg viewBox="0 0 800 540" role="img" aria-label="The graph, as points and threads">
          {graph.data.edges.map((e, i) => {
            const a = at.get(e.from_id);
            const b = at.get(e.to_id);
            if (!a || !b) return null;
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--line2)" />;
          })}
          {/* No standing labels. The design drew six points and could name them
              all; a real graph holds a hundred, and a hundred names laid over
              each other is less legible than none. The name is on hover, in the
              caption below, where there is room for it. */}
          {nodes.map((n) => {
            const p = at.get(n.id)!;
            return (
              <Link
                key={n.id}
                to={`/node/${n.id}`}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setPeek(`${n.label} · ${n.kind.toLowerCase()}`)}
                onMouseLeave={() => setPeek(null)}
              >
                <title>{n.label}</title>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={n.tentative ? 4 : 6}
                  // Hollow when tentative, filled when the record stands
                  // behind it. The colour comes from the shared rule so both
                  // clients answer "what does this colour mean" the same way.
                  fill={n.tentative ? "none" : toneFor({ kind: n.kind })}
                  stroke={n.tentative ? toneFor({ tentative: true }) : "none"}
                />
              </Link>
            );
          })}
        </svg>
      </div>
      <p className="mono" style={{ marginTop: 10 }}>
        {peek ?? "Hover a point to name it. Every node opens to its evidence."}
      </p>
    </>
  );
}
