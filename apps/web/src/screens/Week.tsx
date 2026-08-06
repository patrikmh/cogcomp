import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Meter } from "@/components/Meter";
import { Failed, Loading } from "@/components/States";
import { api } from "@/lib/api";
import { DETECTOR_LABEL, deviceTimezone, localDay, mondayOf, shiftDay } from "@/lib/format";
import { Seal } from "@/lib/seal";

/**
 * A week, as a rhythm.
 *
 * What a week has that a day does not is shape — which days you wrote on and
 * which you did not. So that is the first thing on the screen: seven columns,
 * each as tall as it was busy, written days openable and empty days still
 * visible.
 *
 * Empty days are never filtered out and never styled as gaps to be filled. A
 * week with two entries in it is a fact about the week, and hiding the five
 * blank days would quietly flatter the record.
 *
 * The comparison against the other week is stated as two bars and a sentence of
 * arithmetic — "as many acts as last week", never "better".
 */
export function Week() {
  const tz = deviceTimezone();
  const navigate = useNavigate();
  const [back, setBack] = useState(0);
  const [peek, setPeek] = useState<string | null>(null);

  const monday = mondayOf(shiftDay(localDay(), -7 * back));
  const otherMonday = mondayOf(shiftDay(monday, back === 0 ? -7 : 7));

  const week = useQuery({ queryKey: ["summary", "week", monday, tz], queryFn: () => api.weekly(monday, tz) });
  const other = useQuery({
    queryKey: ["summary", "week", otherMonday, tz],
    queryFn: () => api.weekly(otherMonday, tz),
  });
  const patterns = useQuery({ queryKey: ["patterns"], queryFn: api.patterns });
  const words = useQuery({
    queryKey: ["vocabulary", monday, tz],
    queryFn: () => api.vocabulary(monday, tz, 1),
  });

  if (week.isLoading) return <Loading />;
  if (week.isError || !week.data) return <Failed />;

  const days = week.data.days;
  const acts = week.data.entry_count;
  const written = week.data.active_days;
  const otherActs = other.data?.entry_count ?? 0;
  const otherName = back === 0 ? "last week" : "this week";
  const busiest = Math.max(1, ...days.map((d) => d.entry_count));
  const both = Math.max(acts, otherActs, 1);

  const vs =
    acts === otherActs
      ? `as many acts as ${otherName}`
      : `${Math.abs(acts - otherActs)} ${acts > otherActs ? "more" : "fewer"} than ${otherName}`;

  const kept = (patterns.data ?? []).filter((p) => !p.tentative);
  const forming = (patterns.data ?? []).filter((p) => p.tentative);

  return (
    <div className="scr">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="kicker">
          {back === 0 ? "This week" : "Week of " + monday} · Mon–Sun · {tz}
        </span>
        <span className="row">
          <button className="btn ghost" onClick={() => setBack((b) => b + 1)}>
            ← PREV
          </button>
          <button className="btn ghost" disabled={back === 0} onClick={() => setBack((b) => Math.max(0, b - 1))}>
            NEXT →
          </button>
        </span>
      </div>

      <h1>Writing on {written} of 7 days</h1>
      <p className="t-sum">
        {acts} {acts === 1 ? "act" : "acts"} · {vs}
      </p>

      {/* Two weeks side by side, as lengths. Counts only — no verdict about
          which of them was the better week. */}
      <div className="w-vs">
        <div className="w-vs-row">
          <span className="mono">{back === 0 ? "this week" : "that week"}</span>
          <span className="w-vs-track">
            <i style={{ width: `${Math.round((acts / both) * 100)}%` }} />
          </span>
          <span className="mono n">{acts} acts</span>
        </div>
        <div className="w-vs-row other">
          <span className="mono">{otherName}</span>
          <span className="w-vs-track">
            <i style={{ width: `${Math.round((otherActs / both) * 100)}%` }} />
          </span>
          <span className="mono n">{otherActs} acts</span>
        </div>
      </div>

      <div className="t-sec">
        <span className="kicker">The rhythm</span>
        <span className="rule" />
        <span className="mono">written days open · hover previews</span>
      </div>

      <div className="w-chart">
        {days.map((day) => {
          const n = day.entry_count;
          const label = new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: "short" });
          const newest = day.observations[day.observations.length - 1];
          const preview = newest
            ? `${n} ${n === 1 ? "act" : "acts"} · newest: “${newest.content.split(" ").slice(0, 8).join(" ")}…”`
            : "";
          const inner = (
            <>
              <span className="c">{n || ""}</span>
              <span className="w-seal">{n ? <Seal id={day.date} className="j-seal" /> : null}</span>
              <span
                className="bar"
                style={{ height: n ? Math.round(14 + (n / busiest) * 126) : 4 }}
              />
              <span className="d">{label}</span>
            </>
          );
          return n ? (
            <button
              key={day.date}
              className={`w-col written${day.date === localDay() ? " today" : ""}`}
              title={`Open ${day.date}`}
              onMouseEnter={() => setPeek(preview)}
              onMouseLeave={() => setPeek(null)}
              onClick={() => navigate("/today")}
            >
              {inner}
            </button>
          ) : (
            <div key={day.date} className="w-col">
              {inner}
            </div>
          );
        })}
      </div>

      <p className="w-peek">
        {peek ??
          "Hover a written day to preview it — click to open its record. Empty days stay visible: a quiet week is not a lapse."}
      </p>

      {kept.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">What kept returning</span>
            <span className="rule" />
            <span className="mono">strongest first</span>
          </div>
          {kept.map((p) => (
            <PatternRow key={p.id} pattern={p} />
          ))}
        </>
      )}

      {forming.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">Still forming</span>
            <span className="rule" />
            <span className="mono">tentative — they may not hold</span>
          </div>
          {forming.map((p) => (
            <PatternRow key={p.id} pattern={p} />
          ))}
        </>
      )}

      {/* Not a finding — the person's own words counted back to them. It stays
          when patterns are switched off. */}
      {words.data?.weeks.at(-1) && (
        <p className="rest mono">{words.data.weeks.at(-1)!.description}</p>
      )}
    </div>
  );
}

function PatternRow({ pattern }: { pattern: NonNullable<Awaited<ReturnType<typeof api.patterns>>>[number] }) {
  const strength = pattern.distinct_days / Math.max(1, pattern.occurrences);
  return (
    <Link className={`t-read w-pat${pattern.tentative ? " ghost" : ""}`} to={`/pattern/${pattern.id}`}>
      <span className="w-pow" style={{ width: `${Math.round(strength * 100)}%` }} />
      <span className="t-seal">
        <Seal id={pattern.id} className="j-seal" />
      </span>
      <span className="t-main">
        <b>{pattern.label}</b>
        <span className="mono">{DETECTOR_LABEL[pattern.detector] ?? pattern.detector}</span>
      </span>
      <span className="t-side">
        <Meter confidence={pattern.confidence} />
        <span className="mono">
          {pattern.distinct_days} / {pattern.occurrences}
        </span>
      </span>
    </Link>
  );
}
