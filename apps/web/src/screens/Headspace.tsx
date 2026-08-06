import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Empty } from "@/components/States";
import { api } from "@/lib/api";
import { deviceTimezone, localDay } from "@/lib/format";
import { sealRings } from "@/lib/seal";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";

/**
 * Headspace — where things stand.
 *
 * Four lenses over one picture: a day is a fact, the whole record is a record,
 * a recurrence is a claim, a change is a comparison between two windows. Each
 * step is further from what was actually written, and the row makes that
 * distance visible rather than presenting them as equally solid.
 *
 * The contour whorls are the same harmonic language as the entry seals, one
 * scale up. The three.js topographic stage from the prototype lands next; this
 * renders the same shapes in SVG so the screen is real and data-backed now.
 */
type Lens = "today" | "all" | "patterns" | "changed";

const LENSES: { id: Lens; label: string; finding: boolean }[] = [
  { id: "today", label: "Today", finding: false },
  { id: "all", label: "Everything", finding: false },
  { id: "patterns", label: "Recurring", finding: true },
  { id: "changed", label: "Changed", finding: true },
];

export function Headspace() {
  const tz = deviceTimezone();
  const userId = useSession((s) => s.userId);
  const showFindings = usePreferences((s) => s.findings);
  const [lens, setLens] = useState<Lens>("today");
  const [focus, setFocus] = useState<string | null>(null);
  const available = LENSES.filter((l) => showFindings || !l.finding);
  const active = available.some((l) => l.id === lens) ? lens : "today";

  const today = useQuery({
    queryKey: ["summary", localDay(), tz],
    queryFn: () => api.daily(localDay(), tz),
  });
  const graph = useQuery({ queryKey: ["graph"], queryFn: () => api.graph(120) });
  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: api.patterns,
    enabled: showFindings,
  });
  const changes = useQuery({
    queryKey: ["temporal", tz],
    queryFn: () => api.changes(tz),
    enabled: showFindings,
  });

  const points = pointsFor(active, today.data, graph.data, patterns.data, changes.data);
  const current = points.find((p) => p.id === focus) ?? null;

  return (
    <>
      <div className="tabs" id="lenses">
        {available.map((option) => (
          <button
            key={option.id}
            className="btn"
            data-on={active === option.id ? "" : undefined}
            onClick={() => {
              setLens(option.id);
              // The previous selection is not in the new lens, and a readout
              // describing something no longer on screen is worse than none.
              setFocus(null);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div id="orbwrap">
        {points.length === 0 ? (
          <Empty label={EMPTY[active]} />
        ) : (
          <svg viewBox="0 0 900 520" role="img" aria-label="Your headspace as a contour map">
            {points.map((point, i) => {
              const x = 120 + ((i * 173) % 660);
              const y = 90 + ((i * 97) % 340);
              return (
                <g
                  key={point.id}
                  transform={`translate(${x} ${y}) scale(${0.7 + point.weight * 1.1})`}
                  onMouseEnter={() => setFocus(point.id)}
                  onFocus={() => setFocus(point.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={point.label}
                  style={{ cursor: "pointer" }}
                >
                  {sealRings(point.id).map((d, k) => (
                    <path
                      key={k}
                      d={d}
                      transform="translate(-32 -32)"
                      fill="none"
                      stroke={point.tone}
                      strokeWidth={focus === point.id ? 1.6 : 1}
                      opacity={point.tentative ? 0.45 : 0.9}
                    />
                  ))}
                </g>
              );
            })}
          </svg>
        )}
      </div>

      <div id="readout">
        {current ? (
          <>
            <span className="kicker">{current.kind}</span>
            <b>{current.label}</b>
            <div className="mono" style={{ color: "var(--dim)" }}>
              {current.meta}
            </div>
            {current.href && (
              <Link className="btn" to={current.href}>
                WHERE THIS CAME FROM →
              </Link>
            )}
          </>
        ) : (
          <span className="mono" style={{ color: "var(--faint)" }}>
            {HINT[active]}
          </span>
        )}
      </div>
    </>
  );
}

const EMPTY: Record<Lens, string> = {
  today: "Nothing recorded today.",
  all: "Nothing here yet. It fills in as you write.",
  patterns: "Nothing has come back often enough to call recurring.",
  changed: "Nothing moved between this week and last.",
};

const HINT: Record<Lens, string> = {
  today: "Today, as it stands. Point at one to read it.",
  all: "Everything drawn from your entries. Filled is confident, hollow is a guess.",
  patterns: "What keeps returning. Bigger means more often.",
  changed: "Counts only — what it means is yours.",
};

interface Point {
  id: string;
  label: string;
  kind: string;
  meta: string;
  weight: number;
  tone: string;
  tentative: boolean;
  href?: string;
}

function pointsFor(
  lens: Lens,
  today: Awaited<ReturnType<typeof api.daily>> | undefined,
  graph: Awaited<ReturnType<typeof api.graph>> | undefined,
  patterns: Awaited<ReturnType<typeof api.patterns>> | undefined,
  changes: Awaited<ReturnType<typeof api.changes>> | undefined,
): Point[] {
  if (lens === "today") {
    return (today?.inferred ?? []).map((i) => ({
      id: i.id,
      label: i.label,
      kind: i.kind.toLowerCase(),
      meta: `${i.cites_entries} ${i.cites_entries === 1 ? "entry" : "entries"} · ${i.confidence.toFixed(2)}`,
      weight: i.confidence,
      tone: i.tentative ? "var(--sand)" : "var(--kept)",
      tentative: i.tentative,
      href: `/node/${i.id}`,
    }));
  }
  if (lens === "all") {
    return (graph?.nodes ?? [])
      .filter((n) => n.kind !== "Observation")
      .slice(0, 24)
      .map((n) => ({
        id: n.id,
        label: n.label,
        kind: n.kind.toLowerCase(),
        meta: n.confidence ? n.confidence.toFixed(2) : "",
        weight: n.confidence ?? 0.5,
        tone: n.tentative ? "var(--sand)" : "var(--kept)",
        tentative: n.tentative,
        href: `/node/${n.id}`,
      }));
  }
  if (lens === "patterns") {
    const busiest = Math.max(1, ...(patterns ?? []).map((p) => p.occurrences));
    return (patterns ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      kind: "pattern",
      meta: `${p.distinct_days} days · ${p.confidence.toFixed(2)}`,
      weight: p.occurrences / busiest,
      tone: "var(--pattern)",
      tentative: p.tentative,
      href: p.detector === "lag" || p.detector === "same-day-order" ? `/pattern/${p.id}` : `/node/${p.id}`,
    }));
  }
  return (changes?.changes ?? []).map((c) => ({
    // A change is a comparison between windows, not a node — there is nothing
    // to open, and the readout is the whole of it.
    id: `${c.kind}:${c.label}`,
    label: c.label,
    kind: c.shift,
    meta: c.description,
    weight: Math.min(1, Math.abs(c.recent_days - c.earlier_days) / 7 + 0.3),
    tone: "var(--live)",
    tentative: c.shift === "absent",
  }));
}
