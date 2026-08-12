import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { readingBudget } from "@tlon/design/marks";

import { mountHeadspace, type Stage, type Whorl } from "@/lib/headspace";
import { api } from "@/lib/api";
import { DETECTOR_LABEL, deviceTimezone, fmt, localDay } from "@/lib/format";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { Guide } from "@/components/Guide";
import { HEADINGS } from "@tlon/copy/headings";

/**
 * Headspace — a contour map of the record.
 *
 * One scene, four kinds of thing in it: the patterns, the readings you have
 * kept, today's fresh notes, and you at the centre. The lenses do not navigate
 * and do not rebuild — they change what is *visible*, which is why switching
 * one repopulates the head instead of taking you somewhere else.
 *
 * The order of the lenses is the argument. A day is a fact, the whole record is
 * a record, a recurrence is a claim, a change is a comparison between windows.
 * Each step is further from what was actually written.
 *
 * You never leave the map. The point of view stays put under every lens.
 */
type Lens = "today" | "everything" | "recurring" | "changed";

export function Headspace() {
  const tz = deviceTimezone();
  const userId = useSession((s) => s.userId);
  const showFindings = usePreferences((s) => s.findings);
  const motion = usePreferences((s) => s.motion);
  const setMotion = usePreferences((s) => s.setMotion);
  const [lens, setLens] = useState<Lens>("everything");
  const [focus, setFocus] = useState<Whorl | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);

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

  /* Everything in the map, built once from all four sources. */
  const whorls = useMemo<Whorl[]>(() => {
    const busiest = Math.max(1, ...(patterns.data ?? []).map((p) => p.occurrences));
    const todayIds = new Set((today.data?.inferred ?? []).map((i) => i.id));

    const asPattern: Whorl[] = (patterns.data ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      // The datum the whorl is shaped by, etched along its contours.
      meta: `${p.distinct_days} / ${p.occurrences}`,
      weight: p.occurrences / busiest,
      tentative: p.tentative,
      tint: 0xe6b95c,
      href:
        p.detector === "lag" || p.detector === "same-day-order"
          ? `/pattern/${p.id}`
          : `/node/${p.id}`,
      group: "pattern",
      kicker: `Pattern · ${DETECTOR_LABEL[p.detector] ?? p.detector}`,
      readout: `${p.distinct_days} of ${p.occurrences}`,
      bar: p.occurrences / busiest,
    }));

    const asReading: Whorl[] = readingsOn(
      graph.data?.nodes ?? [],
      todayIds,
      (patterns.data ?? []).length,
    ).map((n) => ({
        id: n.id,
        label: n.label,
        meta: n.confidence ? fmt(n.confidence) : "",
        weight: n.confidence ?? 0.5,
        tentative: n.tentative,
        tint: n.tentative ? 0xd8c79a : 0xa7c3c8,
        href: `/node/${n.id}`,
        group: "reading",
        kicker: `${n.kind} · ${n.tentative ? "less sure" : "kept"}`,
        readout: n.confidence ? fmt(n.confidence) : "",
        bar: n.confidence ?? 0,
      }));

    // Today is one whorl, not one per reading. The map is a landscape of what
    // the record holds; today is a single place on it, and scattering four
    // hillocks across the plain made the day look like four unrelated things.
    const todays = today.data?.inferred ?? [];
    const acts = today.data?.entry_count ?? 0;
    const asToday: Whorl[] = todays.length
      ? [
          {
            id: "today",
            label: `today · ${todays.length} ${todays.length === 1 ? "reading" : "readings"}`,
            meta: String(todays.length),
            weight: todays.length / 14,
            tentative: false,
            tint: 0xc6e070,
            href: "/today",
            group: "today",
            kicker: "Today · drawn since midnight",
            readout: `${acts} ${acts === 1 ? "act" : "acts"}`,
            bar: Math.min(1, todays.length / 14),
          },
        ]
      : [];

    // The point of view. Bigger than anything drawn around it, and it never
    // leaves the map.
    const you: Whorl = {
      id: "you",
      label: "everything ever suggested",
      meta: "",
      weight: 1,
      tentative: false,
      tint: 0xeef1ec,
      href: "/identity",
      group: "you",
      kicker: "You · the point of view",
      readout: "open identity",
      bar: 0,
    };

    return [you, ...asPattern, ...asToday, ...asReading];
  }, [patterns.data, graph.data, today.data]);

  /* One scene. Rebuilt only when the material itself changes. */
  useEffect(() => {
    if (!host.current || whorls.length <= 1) return;
    const mounted = mountHeadspace(host.current, whorls, setFocus);
    stage.current = mounted;
    mounted.setPaused(!motion);
    return () => {
      stage.current = null;
      mounted.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whorls]);

  // The lens changes what is visible, never what exists.
  useEffect(() => {
    stage.current?.setVisible(VISIBLE[lens]);
  }, [lens, whorls]);

  useEffect(() => {
    stage.current?.setPaused(!motion);
  }, [motion]);

  const counts: Record<Lens, number> = {
    today: whorls.filter((w) => w.group === "today").length,
    everything: whorls.length - 1,
    recurring: whorls.filter((w) => w.group === "pattern").length,
    changed: changes.data?.changes.length ?? 0,
  };

  const lenses = LENSES.filter((l) => showFindings || !l.finding);
  const active = lenses.some((l) => l.id === lens) ? lens : "today";

  return (
    <>
      <span className="kicker">{HEADINGS.headspace.kicker}</span>
      <div className="row">
        <h1 id="lensTitle">{LENS_LABEL[active]}</h1>
        <Guide id="headspace" lens={LENS_LABEL[active]} />
      </div>
      <p className="sub" id="lensNote">
        {noteFor(active, counts, tz, changes.data?.not_enough_material ?? false)}
      </p>

      <div className="tabs" id="lenses">
        {lenses.map((option) => (
          <button
            key={option.id}
            data-on={active === option.id ? "" : undefined}
            onClick={() => {
              setLens(option.id);
              setFocus(null);
            }}
          >
            {option.label}
            <span className="count">{counts[option.id]}</span>
          </button>
        ))}
      </div>

      <div id="orbwrap" ref={host}>
        <button
          id="motion-toggle"
          className="mtog"
          type="button"
          aria-pressed={!motion}
          title="Pause the headspace's ambient motion"
          onClick={() => setMotion(!motion)}
        >
          <span className="dot" aria-hidden />
          <span className="lbl">{motion ? "Pause" : "Resume"}</span>
        </button>

        <p id="readout" className={focus ? "hover" : undefined}>
          {focus ? (
            <>
              <span className="rk">{focus.kicker}</span>
              <span className="ln">
                <b>{focus.label}</b>
                {focus.bar > 0 && (
                  <s>
                    <i
                      className={focus.tentative ? "t" : undefined}
                      style={{ width: `${Math.round(focus.bar * 100)}%` }}
                    />
                  </s>
                )}
                <span className="k">{focus.readout}</span>
              </span>
            </>
          ) : (
            <span className="rk">
              Headspace · {counts.recurring}{" "}
              {counts.recurring === 1 ? "pattern" : "patterns"} circling · hover a whorl
            </span>
          )}
        </p>
      </div>

      {/* The contextual way onward, exactly where the design puts it. */}
      <div id="lensAction" style={{ marginTop: 18 }}>
        {active === "recurring" && counts.recurring > 0 && (
          <Link className="btn ghost" to="/patterns">
            OPEN PATTERNS
          </Link>
        )}
        {active === "changed" && (
          <p className="mono" style={{ margin: 0 }}>
            {counts.changed === 0 ? "Nothing to open yet." : "Counts only — what it means is yours."}
          </p>
        )}
        {active === "today" && counts.today === 0 && (
          <Link className="btn ghost" to="/journal">
            WRITE SOMETHING
          </Link>
        )}
      </div>
    </>
  );
}

const LENSES: { id: Lens; label: string; finding: boolean }[] = [
  { id: "today", label: "Today", finding: false },
  { id: "everything", label: "Everything", finding: false },
  { id: "recurring", label: "Recurring", finding: true },
  { id: "changed", label: "Changed", finding: true },
];

const LENS_LABEL: Record<Lens, string> = {
  today: "Today",
  everything: "Everything",
  recurring: "Recurring",
  changed: "Changed",
};

/** Which groups each lens shows. You are in every one of them. */
const VISIBLE: Record<Lens, Whorl["group"][]> = {
  today: ["you", "today"],
  everything: ["you", "today", "reading", "pattern"],
  recurring: ["you", "pattern"],
  changed: ["you"],
};

function noteFor(lens: Lens, counts: Record<Lens, number>, tz: string, thin: boolean) {
  if (lens === "today") {
    return counts.today === 0
      ? `Nothing recorded today (${tz}).`
      : `${counts.today} ${counts.today === 1 ? "note" : "notes"} since midnight (${tz}). Nothing else is shown.`;
  }
  if (lens === "everything") {
    return `${counts.everything} in the record. Each whorl is drawn like the wordmark — a contour map shaped by what it is: a pattern by how often it returns, a reading by how sure; fainter where still tentative.`;
  }
  if (lens === "recurring") {
    return counts.recurring === 0
      ? "Nothing has come back often enough to call recurring."
      : `${counts.recurring} ${counts.recurring === 1 ? "pattern" : "patterns"} returned in more than one week. Counts, not verdicts.`;
  }
  return thin
    ? "Not enough written across both weeks to compare them yet."
    : `${counts.changed} moved between this week and last.`;
}

/**
 * The readings the map places, and only those.
 *
 * Today's are drawn from their own source and observations are acts rather than
 * readings, so both are excluded here; the cap is what the map can hold without
 * becoming a fog. Shared with the rail so the count beside "Headspace" is the
 * number of things actually on it.
 */
export function readingsOn<T extends { id: string; kind: string }>(
  nodes: T[],
  todayIds: Set<string>,
  patternCount = 0,
) {
  const eligible = nodes.filter(
    (n) => n.kind !== "Observation" && n.kind !== "Pattern" && !todayIds.has(n.id),
  );
  // The map holds about as much as the design's map holds, whatever the record
  // holds. The camera frames the whole massif, so every extra whorl shrinks all
  // the others: at twenty-six readings the patterns stop reading as massifs and
  // the survey labels stop being legible, which is the map losing the two things
  // it exists to show. Patterns are never dropped — they are the point — so the
  // readings give way to them.
  return eligible.slice(0, readingBudget(patternCount));
}

/** How many whorls the map holds: you, the patterns, today, and the readings. */
export function headspaceCount(
  patterns: { id: string }[],
  inferred: { id: string }[],
  nodes: { id: string; kind: string }[],
) {
  const todayIds = new Set(inferred.map((i) => i.id));
  return 1 + patterns.length + inferred.length + readingsOn(nodes, todayIds, patterns.length).length;
}
