import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

import { Meter } from "@/components/Meter";
import { Failed, Loading } from "@/components/States";
import { api, type Inference } from "@/lib/api";
import { circlingOf, circlingThemesOf, innerReadingsOf, outerReadingsOf, returningInnerOf, useDrawnFrom } from "@/lib/drawn-from";
import { clockOf, dayFromRoute, deviceTimezone, fmt, localDay, shiftDay } from "@/lib/format";
import { Seal } from "@/lib/seal";
import { Guide } from "@/components/Guide";
import { SECTIONS, asideOf } from "@tlon/copy/sections";
import { EMPTY as EMPTY_COPY } from "@tlon/copy/empty";
import { usePreferences } from "@/state/preferences";

/**
 * One day, as it happened.
 *
 * The acts first, kept verbatim and stamped with their seals — then what they
 * left behind, surest first, then the ones the app is less sure of, then what
 * is circling above the day.
 *
 * The three sections are the argument, and they are never merged: an entry is
 * something you wrote, a confident reading is a guess the app will stand
 * behind, and a tentative one is a guess it will not. A reader must never have
 * to work out which of the three they are looking at.
 */
export function Today() {
  const tz = deviceTimezone();
  const showFindings = usePreferences((s) => s.findings);
  const [params, setParams] = useSearchParams();
  const today = localDay();
  const day = dayFromRoute(params.get("date"), today);
  const openDay = (next: string) => {
    const resolved = dayFromRoute(next, today);
    if (resolved >= today) setParams({}, { replace: true });
    else setParams({ date: resolved }, { replace: true });
  };

  const summary = useQuery({
    queryKey: ["summary", day, tz, showFindings],
    queryFn: () => api.daily(day, tz, showFindings),
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const drawnFrom = useDrawnFrom(4, showFindings);
  const patterns = useQuery({
    queryKey: ["patterns"],
    queryFn: api.patterns,
    enabled: showFindings,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const themes = useQuery({
    queryKey: ["themes"],
    queryFn: api.themes,
    enabled: showFindings,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });

  const inferred = showFindings ? summary.data?.inferred ?? [] : [];
  const readings = inferred.filter((item) => item.kind !== "Pattern" && item.kind !== "Theme");
  const bySurety = (a: Inference, b: Inference) => b.confidence - a.confidence;
  const inside = innerReadingsOf(readings).filter((i) => !i.tentative).sort(bySurety);
  const cameBack = returningInnerOf(readings);
  const kept = outerReadingsOf(readings).filter((i) => !i.tentative).sort(bySurety);
  const faint = readings.filter((i) => i.tentative).sort(bySurety);
  const circlingList = showFindings ? circlingOf(inferred, patterns.data ?? []) : [];
  const regionList = showFindings ? circlingThemesOf(inferred, themes.data ?? []) : [];

  return (
    <div className="scr">
      {/* One line, as the design has it: which day, and the way out of it. This
          carried a heading as well — the date twice, once relative and once
          spelled out, on a screen whose subject is a single day and which
          therefore does not need announcing. */}
      <div className="row" style={{ justifyContent: "space-between" }}>
        {/* The guide sits beside the kicker here, as the design has it: this
            screen has no heading of its own, because the day names itself. */}
        <span className="row" style={{ gap: 10 }}>
        <span className="kicker">
          {day === today ? "Today" : day === shiftDay(today, -1) ? "Yesterday" : null}
          {day >= shiftDay(today, -1) ? " · " : ""}
          {new Date(`${day}T12:00:00`).toLocaleDateString([], {
            weekday: "short",
            day: "numeric",
            month: "short",
          })}{" "}
          ({tz})
        </span>
        <Guide id="today" />
        </span>
        {/* Named days, not "earlier" and "later": the button says where it
            goes, so moving through the week never needs a mental subtraction.
            Ghosted, because navigation is not the point of the screen. */}
        <span className="row">
          <button className="btn ghost" onClick={() => openDay(shiftDay(day, -1))}>
            ← {weekdayOf(shiftDay(day, -1))}
          </button>
          <button
            className="btn ghost"
            disabled={day >= today}
            onClick={() => openDay(shiftDay(day, 1))}
          >
            {weekdayOf(shiftDay(day, 1))} →
          </button>
        </span>
      </div>

      {summary.isLoading ? (
        <Loading />
      ) : summary.isError ? (
        <Failed onRetry={() => void summary.refetch()} />
      ) : summary.data!.entry_count === 0 ? (
        <>
          <p className="sub">
            {new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long" })}.
          </p>
          <div className="empty">{EMPTY_COPY.day}</div>
        </>
      ) : (
        <>
          <p className="sub">
            {/* The day is named here, as the design has it. "As it happened" is
                about a particular day, and the sentence should say which. */}
            Not objects in space — a heterogeneous series of independent acts.{" "}
            {new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long" })}, as it
            happened.
          </p>
          <div className="t-sum">
            {summary.data!.entry_count} {summary.data!.entry_count === 1 ? "act" : "acts"}
            {showFindings && (
              <>
                {" · "}{readings.length} {readings.length === 1 ? "reading" : "readings"} drawn
                {circlingList.length > 0 ? ` · ${circlingList.length} circling` : ""}
                {regionList.length > 0 ? ` · ${regionList.length} ${regionList.length === 1 ? "region" : "regions"}` : ""}
              </>
            )}
          </div>

          <div className="t-sec">
            <span className="kicker">{SECTIONS.acts.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("acts")}</span>
          </div>
          {summary.data!.observations.map((o, i) => (
            <div className={`j-entry${i === 0 ? " latest" : ""}`} key={o.id}>
              <span className="j-time">{clockOf(o.captured_at)}</span>
              <span className="j-spine">
                <span className="j-dot" />
              </span>
              <div className="j-act">
                <Seal id={o.id} />
                <div>
                  <p>{o.content}</p>
                  {showFindings && (
                    <div className="j-meta">
                      <span className="j-from">
                        {(drawnFrom.get(o.id)?.length ?? 0) > 0 ? "drawn from this" : "nothing drawn from this yet"}
                      </span>
                      {(drawnFrom.get(o.id) ?? []).map((r) => (
                        <Link
                          key={r.id}
                          className={`j-chip${r.tentative ? " ghost" : ""}`}
                          to={`/node/${r.id}`}
                        >
                          {r.label} · {fmt(r.confidence)}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {inside.length > 0 && (
            <>
              <div className="t-sec">
                <span className="kicker">{SECTIONS.inside.title}</span>
                <span className="rule" />
                <span className="mono">{asideOf("inside")}</span>
              </div>
              {inside.map((r) => (
                <Reading key={r.id} reading={r} />
              ))}
            </>
          )}

          {cameBack.length > 0 && (
            <>
              <div className="t-sec">
                <span className="kicker">{SECTIONS.cameBack.title}</span>
                <span className="rule" />
                <span className="mono">{asideOf("cameBack")}</span>
              </div>
              {cameBack.map((r) => (
                <Reading key={r.id} reading={r} />
              ))}
            </>
          )}

          {kept.length > 0 && (
            <>
              <div className="t-sec">
                <span className="kicker">{SECTIONS.kept.title}</span>
                <span className="rule" />
                <span className="mono">{asideOf("kept")}</span>
              </div>
              {kept.map((r) => (
                <Reading key={r.id} reading={r} />
              ))}
            </>
          )}

          {faint.length > 0 && (
            <>
              <div className="t-sec">
                <span className="kicker">{SECTIONS.lessSure.title}</span>
                <span className="rule" />
                <span className="mono">{asideOf("lessSure")}</span>
              </div>
              {faint.map((r) => (
                <Reading key={r.id} reading={r} />
              ))}
            </>
          )}

          {summary.data!.recurring.length > 0 && (
            <>
              <div className="t-sec">
                <span className="kicker">Came up more than once</span>
                <span className="rule" />
              </div>
              {summary.data!.recurring.map((r) => (
                <div className="t-read" key={`${r.kind}:${r.label}`}>
                  <span className="t-main">
                    <b>{r.label}</b>
                    <span className="mono">
                      {r.kind.toLowerCase()} · {r.entries} times today
                    </span>
                  </span>
                </div>
              ))}
            </>
          )}

          {circlingList.length > 0 && (
            <>
              <div className="t-sec">
                <span className="kicker">{SECTIONS.circling.title}</span>
                <span className="rule" />
                <span className="mono">this day belongs to</span>
              </div>
              {circlingList.map((pattern) => (
                <Link key={pattern.id} className="t-circle" to={`/pattern/${pattern.id}`}>
                  <b>{pattern.label}</b>
                  <span className="mono">
                    {pattern.distinct_days} of {pattern.occurrences} days
                  </span>
                  <span className="mono go">the pattern →</span>
                </Link>
              ))}
            </>
          )}

          {regionList.length > 0 && (
            <>
              <div className="t-sec">
                <span className="kicker">{SECTIONS.regions.title}</span>
                <span className="rule" />
                <span className="mono">{asideOf("regions")}</span>
              </div>
              {regionList.map((theme) => (
                <Link key={theme.id} className="t-circle" to={`/theme/${theme.id}`}>
                  <b>{theme.label}</b>
                  <span className="mono">{theme.member_count} things</span>
                  <span className="mono go">the region →</span>
                </Link>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** The short weekday name a nav button carries, e.g. "TUE". */
function weekdayOf(day: string) {
  return new Date(`${day}T12:00:00`)
    .toLocaleDateString([], { weekday: "short" })
    .toUpperCase();
}

function Reading({ reading }: { reading: Inference }) {
  return (
    <Link className={`t-read${reading.tentative ? " ghost" : ""}`} to={`/node/${reading.id}`}>
      <span className="t-seal">
        <Seal id={reading.id} className="j-seal" />
      </span>
      <span className="t-main">
        <b>{reading.label}</b>
        <span className="mono">
          {reading.kind.toLowerCase()} · {reading.cites_entries}{" "}
          {reading.cites_entries === 1 ? "entry" : "entries"}
        </span>
      </span>
      <span className="t-side">
        <Meter confidence={reading.confidence} />
        <span className="mono">{fmt(reading.confidence)}</span>
      </span>
    </Link>
  );
}
