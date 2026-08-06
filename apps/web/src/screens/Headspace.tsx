import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Empty } from "@/components/States";
import { api } from "@/lib/api";
import { deviceTimezone, localDay } from "@/lib/format";
import { mountHeadspace, type Stage, type Whorl } from "@/lib/headspace";
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
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const motion = usePreferences((s) => s.motion);
  const setMotion = usePreferences((s) => s.setMotion);
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

  // One scene, rebuilt when the material changes; the lens only toggles what is
  // visible, so switching lens repopulates the head rather than navigating.
  useEffect(() => {
    if (!host.current || points.length === 0) return;
    const whorls: Whorl[] = points.map((p) => ({
      id: p.id,
      label: p.label,
      meta: p.meta,
      weight: p.weight,
      tentative: p.tentative,
      tint: TINT[p.kind] ?? 0xa7c3c8,
      href: p.href,
      group: "reading",
    }));
    const mounted = mountHeadspace(host.current, whorls, (id) => setFocus(id));
    stage.current = mounted;
    mounted.setPaused(!motion);
    return () => {
      stage.current = null;
      mounted.dispose();
    };
    // The scene is rebuilt when the lens changes, because the lens changes what
    // is in it. Motion is applied through the handle instead, below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, points.length]);

  useEffect(() => {
    stage.current?.setPaused(!motion);
  }, [motion]);

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

      <div id="orbwrap" ref={host}>
        {points.length === 0 && <Empty label={EMPTY[active]} />}
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

        <button
          id="motion-toggle"
          aria-pressed={!motion}
          onClick={() => setMotion(!motion)}
          title="Ambient motion"
        >
          {motion ? "PAUSE" : "RESUME"}
        </button>
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

/** The whorl takes the colour of what it is, on hover only. */
const TINT: Record<string, number> = {
  pattern: 0xe6b95c,
  emotion: 0xa7c3c8,
  need: 0xc6e070,
  value: 0xc6e070,
  activity: 0xa7c3c8,
  person: 0xd8c79a,
  place: 0xd8c79a,
  new: 0xc6e070,
  more: 0xc6e070,
  less: 0xd8c79a,
  absent: 0x5f6b68,
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
