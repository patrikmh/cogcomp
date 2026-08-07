import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Meter } from "@/components/Meter";
import { Failed, Loading } from "@/components/States";
import { api, type Inference } from "@/lib/api";
import { useDrawnFrom } from "@/lib/drawn-from";
import { clockOf, deviceTimezone, fmt, localDay, shiftDay } from "@/lib/format";
import { Seal } from "@/lib/seal";

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
  const [offset, setOffset] = useState(0);
  const day = shiftDay(localDay(), offset);

  const summary = useQuery({ queryKey: ["summary", day, tz], queryFn: () => api.daily(day, tz) });
  const drawnFrom = useDrawnFrom();
  const patterns = useQuery({ queryKey: ["patterns"], queryFn: api.patterns });

  const inferred = summary.data?.inferred ?? [];
  const kept = inferred.filter((i) => !i.tentative).sort((a, b) => b.confidence - a.confidence);
  const faint = inferred.filter((i) => i.tentative).sort((a, b) => b.confidence - a.confidence);
  const circling = (patterns.data ?? [])[0];

  return (
    <div className="scr">
      <div className="p-head">
        <div>
          <span className="kicker">
            {offset === 0 ? "Today" : offset === -1 ? "Yesterday" : day} · {tz}
          </span>
          <h1>{new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</h1>
        </div>
        {/* Named days, not "earlier" and "later": the button says where it
            goes, so moving through the week never needs a mental subtraction.
            Ghosted, because navigation is not the point of the screen. */}
        <div className="row">
          <button className="btn ghost" onClick={() => setOffset((o) => o - 1)}>
            ← {weekdayOf(shiftDay(day, -1))}
          </button>
          <button
            className="btn ghost"
            disabled={offset >= 0}
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
          >
            {weekdayOf(shiftDay(day, 1))} →
          </button>
        </div>
      </div>

      {summary.isLoading ? (
        <Loading />
      ) : summary.isError ? (
        <Failed />
      ) : summary.data!.entry_count === 0 ? (
        <>
          <p className="sub">
            {offset > 0 ? "Tomorrow." : new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long" })}.
          </p>
          <div className="empty">Nothing recorded. The day stays empty until it isn&rsquo;t.</div>
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
            {summary.data!.entry_count} {summary.data!.entry_count === 1 ? "act" : "acts"} ·{" "}
            {inferred.length} {inferred.length === 1 ? "reading" : "readings"} drawn
            {circling ? ` · ${(patterns.data ?? []).length} circling` : ""}
          </div>

          <div className="t-sec">
            <span className="kicker">The acts</span>
            <span className="rule" />
            <span className="mono">kept verbatim</span>
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
                </div>
              </div>
            </div>
          ))}

          {kept.length > 0 && (
            <>
              <div className="t-sec">
                <span className="kicker">What they left behind</span>
                <span className="rule" />
                <span className="mono">surest first</span>
              </div>
              {kept.map((r) => (
                <Reading key={r.id} reading={r} />
              ))}
            </>
          )}

          {faint.length > 0 && (
            <>
              <div className="t-sec">
                <span className="kicker">Less sure</span>
                <span className="rule" />
                <span className="mono">unobserved, they grow vague</span>
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

          {circling && (
            <>
              <div className="t-sec">
                <span className="kicker">Circling</span>
                <span className="rule" />
              </div>
              <Link className="t-circle" to="/patterns">
                <b>{circling.label}</b>
                <span className="mono">
                  {circling.distinct_days} of {circling.occurrences} days
                </span>
                <span className="mono go">the pattern →</span>
              </Link>
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
