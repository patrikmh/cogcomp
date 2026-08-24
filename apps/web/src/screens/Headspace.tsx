import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { readingBudget } from "@tlon/design/marks";
import { changesOf, conflictedOf, feltThoughtOf, heldReadingsOf, innerFirst, namedReadingOf, outerReadingsOf, returningInnerOf, returningOuterOf, untargetedFeltOf, untitledThoughtOf, untestedOf } from "@/lib/drawn-from";

import { mountHeadspace, type Stage, type Whorl } from "@tlon/headspace";
import { api, type GraphNode, type Inference, type TemporalChanges } from "@/lib/api";
import { patternDestination } from "@/lib/patterns";
import { DETECTOR_LABEL, deviceTimezone, fmt, localDay } from "@/lib/format";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { Guide } from "@/components/Guide";
import { HEADINGS } from "@tlon/copy/headings";
import { SECTIONS, asideOf, type SectionName } from "@tlon/copy/sections";

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
    queryKey: ["summary", localDay(), tz, showFindings],
    queryFn: () => api.daily(localDay(), tz, showFindings),
  });
  const graph = useQuery({ queryKey: ["graph", showFindings], queryFn: () => api.graph(120), enabled: showFindings });
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
    const findings = showFindings;
    const busiest = Math.max(1, ...(findings ? patterns.data ?? [] : []).map((p) => p.occurrences));
    const todayIds = new Set((today.data?.inferred ?? []).map((i) => i.id));

    const asPattern: Whorl[] = (findings ? patterns.data ?? [] : []).map((p) => ({
      id: p.id,
      label: p.label,
      // The datum the whorl is shaped by, etched along its contours.
      meta: `${p.distinct_days} / ${p.occurrences}`,
      weight: p.occurrences / busiest,
      tentative: p.tentative,
      tint: 0xe6b95c,
      href: patternDestination(p).href,
      group: "pattern",
      kicker: `Pattern · ${DETECTOR_LABEL[p.detector] ?? p.detector}`,
      readout: `${p.distinct_days} of ${p.occurrences}`,
      bar: p.occurrences / busiest,
    }));

    const asReading: Whorl[] = readingsOn(
      findings ? graph.data?.nodes ?? [] : [],
      todayIds,
      findings ? (patterns.data ?? []).length : 0,
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
    const todays = findings ? today.data?.inferred ?? [] : [];
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

    return findings ? [you, ...asPattern, ...asToday, ...asReading] : asToday;
  }, [patterns.data, graph.data, today.data, showFindings]);

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
    everything: showFindings ? whorls.length - 1 : whorls.length,
    recurring: whorls.filter((w) => w.group === "pattern").length,
    changed: showFindings ? changes.data?.changes.length ?? 0 : 0,
  };

  const lenses = LENSES.filter((l) => showFindings || !l.finding);
  const active = lenses.some((l) => l.id === lens) ? lens : "today";

  return (
    // The design wraps this screen in its own class: it is a column that owns
    // its height, so the orb takes what the heading and lens row leave rather
    // than growing the page. Without it the lens note shows and the orb is
    // pushed down by a paragraph the design suppresses.
    <div className="headspace">
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
              {showFindings
                ? `Headspace · ${counts.recurring} ${counts.recurring === 1 ? "pattern" : "patterns"} circling · hover a whorl`
                : "Headspace · your recorded day · hover a note"}
            </span>
          )}
        </p>
      </div>

      {/* The contextual way onward, exactly where the design puts it. */}
      <div id="lensAction">
        {active === "everything" && (
          <ConflictedRooms
            nodes={showFindings ? graph.data?.nodes ?? [] : []}
            edges={showFindings ? graph.data?.edges ?? [] : []}
          />
        )}
        {active === "recurring" && (
          <>
            {counts.recurring > 0 && (
              <Link className="btn ghost" to="/patterns">
                OPEN PATTERNS
              </Link>
            )}
            <RecurringRooms nodes={showFindings ? graph.data?.nodes ?? [] : []} />
          </>
        )}
        {active === "changed" && (
          <ChangedRooms
            changes={showFindings ? changes.data?.changes ?? [] : []}
            nodes={showFindings ? graph.data?.nodes ?? [] : []}
          />
        )}
        {active === "today" &&
          (counts.today === 0 ? (
            <Link className="btn ghost" to="/journal">
              WRITE SOMETHING
            </Link>
          ) : (
            <TodayRooms
              readings={showFindings ? today.data?.inferred ?? [] : []}
              edges={showFindings ? graph.data?.edges ?? [] : []}
            />
          ))}
      </div>
    </div>
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

function ConflictedRooms({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: { from_id: string; to_id: string; kind: string }[];
}) {
  const pulled = conflictedOf(nodes, edges);
  const unargued = untestedOf(nodes, edges);
  const untargeted = untargetedFeltOf(nodes, edges);
  const untitled = untitledThoughtOf(nodes, edges);
  if (pulled.length === 0 && unargued.length === 0 && untargeted.length === 0 && untitled.length === 0) {
    return null;
  }
  return (
    <div className="moved">
      <BeliefRoom name="pulled" items={pulled} />
      <BeliefRoom name="unargued" items={unargued} />
      <BeliefRoom name="untargeted" items={untargeted} />
      <BeliefRoom name="untitled" items={untitled} />
    </div>
  );
}

function BeliefRoom({
  name,
  items,
}: {
  name: "pulled" | "unargued" | "untargeted" | "untitled";
  items: GraphNode[];
}) {
  if (items.length === 0) return null;
  return (
    <>
      <div className="t-sec">
        <span className="kicker">{SECTIONS[name].title}</span>
        <span className="rule" />
        <span className="mono">{asideOf(name)}</span>
      </div>
      {items.map((reading) => (
        <Link key={reading.id} className="p-comp" to={`/node/${reading.id}`}>
          <span className="ln">
            <b>{reading.label}</b>
            <span className="k">{reading.kind.toLowerCase()}</span>
          </span>
        </Link>
      ))}
    </>
  );
}

function TodayRooms({
  readings,
  edges,
}: {
  readings: Inference[];
  edges: { from_id: string; to_id: string; kind: string }[];
}) {
  const felt = feltThoughtOf(readings);
  const holds = heldReadingsOf(readings);
  const around = outerReadingsOf(readings);
  const untargeted = untargetedFeltOf(readings, edges);
  const untitled = untitledThoughtOf(readings, edges);
  if (
    felt.length === 0 &&
    holds.length === 0 &&
    around.length === 0 &&
    untargeted.length === 0 &&
    untitled.length === 0
  ) {
    return null;
  }
  return (
    <div className="moved">
      <RecurringRoom name="inside" items={felt} />
      <RecurringRoom name="holds" items={holds} />
      <RecurringRoom name="around" items={around} />
      <RecurringRoom name="untargeted" items={untargeted} />
      <RecurringRoom name="untitled" items={untitled} />
    </div>
  );
}

function RecurringRooms({ nodes }: { nodes: GraphNode[] }) {
  const cameBack = returningInnerOf(nodes);
  const again = returningOuterOf(nodes);
  if (cameBack.length === 0 && again.length === 0) return null;
  return (
    <div className="moved">
      <RecurringRoom name="cameBack" items={cameBack} />
      <RecurringRoom name="again" items={again} />
    </div>
  );
}

function RecurringRoom({
  name,
  items,
}: {
  name: Extract<SectionName, "cameBack" | "again" | "inside" | "holds" | "around" | "untargeted" | "untitled">;
  items: { id: string; kind: string; label: string; cites_entries?: number }[];
}) {
  if (items.length === 0) return null;
  return (
    <>
      <div className="t-sec">
        <span className="kicker">{SECTIONS[name].title}</span>
        <span className="rule" />
        <span className="mono">{asideOf(name)}</span>
      </div>
      {items.map((reading) => (
        <Link key={reading.id} className="p-comp" to={`/node/${reading.id}`}>
          <span className="ln">
            <b>{reading.label}</b>
            <span className="k">
              {reading.kind.toLowerCase()}
              {reading.cites_entries
                ? ` · ${reading.cites_entries} ${reading.cites_entries === 1 ? "entry" : "entries"}`
                : ""}
            </span>
          </span>
        </Link>
      ))}
    </>
  );
}

type Moved = TemporalChanges["changes"][number];

function ChangedRooms({ changes, nodes }: { changes: Moved[]; nodes: GraphNode[] }) {
  const rooms = changesOf(changes);
  if (rooms.inside.length === 0 && rooms.around.length === 0) {
    return (
      <p className="mono" style={{ margin: 0 }}>
        Nothing to open yet.
      </p>
    );
  }
  return (
    <div className="moved">
      <ChangedRoom name="inside" items={rooms.inside} nodes={nodes} />
      <ChangedRoom name="around" items={rooms.around} nodes={nodes} />
    </div>
  );
}

function ChangedRoom({
  name,
  items,
  nodes,
}: {
  name: Extract<SectionName, "inside" | "around">;
  items: Moved[];
  nodes: GraphNode[];
}) {
  if (items.length === 0) return null;
  return (
    <>
      <div className="t-sec">
        <span className="kicker">{SECTIONS[name].title}</span>
        <span className="rule" />
        <span className="mono">{asideOf(name)}</span>
      </div>
      {items.map((change) => {
        const door = namedReadingOf(change.kind, change.label, nodes);
        const line = (
          <span className="ln">
            <b>{change.label}</b>
            <span className="k">{change.shift}</span>
          </span>
        );
        return door ? (
          <Link key={`${change.kind}:${change.label}:${change.shift}`} className="p-comp" to={`/node/${door.id}`}>
            {line}
          </Link>
        ) : (
          <p key={`${change.kind}:${change.label}:${change.shift}`} className="p-comp">
            {line}
          </p>
        );
      })}
    </>
  );
}

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
export function readingsOn<
  T extends { id: string; kind: string; confidence?: number | null },
>(nodes: T[], todayIds: Set<string>, patternCount = 0) {
  const eligible = nodes.filter(
    (n) => n.kind !== "Observation" && n.kind !== "Pattern" && !todayIds.has(n.id),
  );
  // The map holds about as much as the design's map holds, whatever the record
  // holds. The camera frames the whole massif, so every extra whorl shrinks all
  // the others: at twenty-six readings the patterns stop reading as massifs and
  // the survey labels stop being legible, which is the map losing the two things
  // it exists to show. Patterns are never dropped — they are the point — so the
  // readings give way to them. Felt and thought take the remaining seats first:
  // extraction fills the graph with coffee, and a survey of the record that
  // drew only that would hide the inner world the map exists to walk.
  return [...eligible].sort(innerFirst).slice(0, readingBudget(patternCount));
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
