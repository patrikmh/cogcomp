import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { Meter } from "@/components/Meter";
import { Empty, Failed, Loading } from "@/components/States";
import { api, type GraphNode } from "@/lib/api";
import { apartSidesOf, arcsOf, daysBehindOf, feltThoughtOf, heldReadingsOf, outerReadingsOf, weekdayShapeOf } from "@/lib/drawn-from";
import { DETECTOR_LABEL, dateOf, fmt, stampOf } from "@/lib/format";
import { patternDestination } from "@/lib/patterns";
import { Seal } from "@/lib/seal";
import { useSession } from "@/state/session";
import { Guide } from "@/components/Guide";
import { SECTIONS, asideOf } from "@tlon/copy/sections";

/**
 * What came first.
 *
 * The ordering stated as a sentence is the kind of thing a person cannot argue
 * with unless they can see what it was counting, so this shows the occasions
 * themselves: each pair of entries, in the order they were written, with the
 * gap named. It says *before*, never *because*.
 */
export function PatternDetail() {
  const { id = "" } = useParams();
  const userId = useSession((s) => s.userId);

  const patterns = useQuery({ queryKey: ["patterns"], queryFn: api.patterns });
  const pattern = (patterns.data ?? []).find((p) => p.id === id);
  // Lag and same-day-order both persist their occasions now: lag as day-apart
  // pairs, same-day-order as two moments on one writing day. The ordered
  // promise is kept for both; every other detector has no order to show.
  const ordered =
    pattern?.detector === "lag" || pattern?.detector === "same-day-order";

  // Every finding has a detail page; only the ordered ones have occasions.
  const ordering = useQuery({
    queryKey: ["ordering", id],
    queryFn: () => api.ordering(id),
    enabled: ordered,
  });
  // What the finding is made of: the readings that support it.
  const composition = useQuery({
    queryKey: ["neighbours", id],
    queryFn: () => api.neighbours(id),
    enabled: Boolean(pattern),
  });
  // The entries behind it, for the detectors that do not lay out occasions.
  const evidence = useQuery({
    queryKey: ["explain", id],
    queryFn: () => api.explain(id),
    enabled: Boolean(pattern) && !ordered,
  });
  const experiments = useQuery({
    queryKey: ["experiments", true],
    queryFn: () => api.experiments(true),
    enabled: Boolean(pattern),
  });
  // The thread this finding belongs to, if any. Cached from the Patterns
  // screen when it is warm; the lookup is an id match over what grouping
  // already stored — nothing recomputed, nothing new claimed. Keyed on the
  // user so it cannot fire unauthenticated and cache a 401 as its answer.
  const threads = useQuery({
    queryKey: ["threads", userId],
    queryFn: api.threads,
    enabled: Boolean(pattern && userId),
  });
  const siblings = threads.data
    ?.filter((t) => t.members.some((m) => m.id === id))
    .flatMap((t) => t.members.filter((m) => m.id !== id));

  if (patterns.isLoading) return <Loading label="Reading the finding…" />;
  if (!pattern) return <Failed label="No such finding." />;

  const detector = DETECTOR_LABEL[pattern.detector] ?? pattern.detector;
  const occasions = ordering.data?.occasions ?? [];
  const gap = ordering.data
    ? ordering.data.lag_days === 0
      ? "later the same day"
      : `${ordering.data.lag_days} ${ordering.data.lag_days === 1 ? "day" : "days"}`
    : "";
  const calendar =
    pattern.detector === "weekday"
      ? weekdayShapeOf((evidence.data?.derived_from ?? []).map((entry) => entry.captured_at))
      : [];
  // The distinct writing days behind the evidence, so a recurrence can be
  // walked in context instead of trusted on a count alone.
  const behind = daysBehindOf(
    (evidence.data?.derived_from ?? []).map((entry: { captured_at: string }) => entry.captured_at),
  );
  const peaked = Math.max(0, ...calendar.map((day) => day.count));
  const neighbours = composition.data?.neighbours ?? [];
  const sides =
    pattern.detector === "stated-vs-recorded" ? apartSidesOf(neighbours) : { named: [], done: [] };
  const split = sides.named.length > 0 || sides.done.length > 0;
  const wondered = arcsOf(id, experiments.data?.experiments ?? []);

  return (
    <>
      <span className="kicker">
        Pattern · {detector}
        {pattern.tentative ? " · still forming" : ""}
      </span>
      <div className="guide-heading">
        <h1>{pattern.label}</h1>
        <Guide id="pattern" />
      </div>
      <p className="sub">
        {(INTRO[pattern.detector] ?? INTRO["exact-label"]!)(
          pattern.distinct_days,
          pattern.occurrences,
        )}
      </p>
      <div className="t-sum">
        {pattern.distinct_days} of {pattern.occurrences} · sized against your own record, no
        absolute scale
      </div>

      {siblings && siblings.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">Same thread</span>
            <span className="rule" />
            <span className="mono">grouped by shared evidence words</span>
          </div>
          <div className="t-sum" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {siblings.map((member) => (
              <Link
                key={member.id}
                className={`c${member.tentative ? " ghost" : ""}`}
                to={patternDestination(member).href}
              >
                {DETECTOR_LABEL[member.detector] ?? member.detector}: {member.label}
              </Link>
            ))}
          </div>
        </>
      )}

      {peaked > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.calendar.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("calendar")}</span>
          </div>
          <div className="t-sum" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {calendar.map((day) => (
              <span key={day.weekday} className="mono" style={{ opacity: day.count === peaked ? 1 : 0.55 }}>
                {day.weekday} {day.count}
              </span>
            ))}
          </div>
        </>
      )}

      {split && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.apart.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("apart")}</span>
          </div>
          {sides.named.map((reading) => (
            <Neighbour key={reading.id} reading={reading} role="named" />
          ))}
          {sides.done.map((reading) => (
            <Neighbour key={reading.id} reading={reading} role="recorded" />
          ))}
        </>
      )}

      {!split && neighbours.length > 0 && <Parts neighbours={neighbours} />}

      {ordered ? (
        ordering.isLoading ? (
          <Loading label="Reading the order…" />
        ) : ordering.isError ? (
          <Failed label="Could not load ordered evidence." onRetry={() => void ordering.refetch()} />
        ) : occasions.length === 0 ? (
          // An absence, not a failure. `Failed` carries role="alert", which
          // tells a screen reader something went wrong; nothing did — the
          // ordering simply has no pairs recorded behind it yet.
          <Empty label="No ordered evidence is recorded behind this one yet." />
        ) : (
          <>
            <div className="t-sec">
              <span className="kicker">The acts behind it</span>
              <span className="rule" />
              <span className="mono">
                {occasions.reduce((n, o) => n + o.before.length + o.after.length, 0)} entries ·
                verbatim
              </span>
            </div>
            {occasions.map((occasion) => (
              <div key={occasion.source_day}>
                <div className="t-sec">
                  <span className="kicker">First · {occasion.source_day}</span>
                  <span className="rule" />
                  <span className="mono">
                    {ordering.data?.lag_days === 0 ? "then, the same day" : `then ${gap} later`}
                  </span>
                </div>
                {occasion.before.map((e) => (
                  <Act key={e.id} id={e.id} content={e.content} at={e.captured_at} role="first" />
                ))}
                {occasion.after.map((e) => (
                  <Act key={e.id} id={e.id} content={e.content} at={e.captured_at} role="then" />
                ))}
              </div>
            ))}
          </>
        )
      ) : (
        <>
          <div className="t-sec">
            <span className="kicker">The acts behind it</span>
            <span className="rule" />
            <span className="mono">
              {evidence.data?.derived_from.length ?? 0} entries · verbatim
            </span>
          </div>
          {evidence.isLoading ? (
            <Loading />
          ) : evidence.isError ? (
            <Failed label="Could not load source evidence." onRetry={() => void evidence.refetch()} />
          ) : (
            (evidence.data?.derived_from ?? []).map((e) => (
              <Act key={e.id} id={e.id} content={e.content} at={e.captured_at} />
            ))
          )}
        </>
      )}

      {behind.length > 1 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.behind.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("behind")}</span>
          </div>
          {/* One day never earns this row: the single entry is already shown
              in full above, and a one-link list would only repeat it. */}
          <div className="p-comp">
            {behind.map((day) => (
              <Link className="c" key={day} to={`/today?date=${day}`}>
                {dateOf(`${day}T12:00:00`)}
              </Link>
            ))}
          </div>
        </>
      )}

      {wondered.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.wondered.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("wondered")}</span>
          </div>
          {wondered.map((trial) => (
            <Link key={trial.id} className="t-circle" to={`/experiment/${trial.id}`}>
              <b>{trial.title}</b>
              <span className="mono">{trial.state}</span>
              <span className="mono go">the trial →</span>
            </Link>
          ))}
        </>
      )}

      {ordering.data?.utc_fallback && (
        <p className="mono" style={{ marginTop: 16, color: "var(--faint)" }}>
          Some of these entries never recorded the timezone they were written in, so their days were
          counted in UTC. Near midnight a gap may read as one day more or less than it felt.
        </p>
      )}

      <div className="row" style={{ marginTop: 20 }}>
        <Link className="btn ghost" to="/patterns">
          ← ALL PATTERNS
        </Link>
        <Link className="btn ghost" to="/agents">
          HOW THIS WAS PRODUCED
        </Link>
      </div>
    </>
  );
}

/** What this kind of finding is, and what it is not. */
const INTRO: Record<string, (days: number, all: number) => string> = {
  "exact-label": (d, a) =>
    `This came up on ${d} of the ${a} it rests on. Recurrence is not significance — only that it kept returning.`,
  weekday: (d) =>
    `It landed on the same weekday ${d} times. A shape in the calendar, not a reason for one.`,
  lag: (d) =>
    `One came before the other on ${d} occasions. That ordering is all this shows — nothing here says one produced the other.`,
  "same-day-order": (d) =>
    `One came earlier in the day than the other on ${d} of them. Order within a day, and nothing more.`,
  "stated-vs-recorded": () =>
    "You named this on more days than the record saw it, and the two rarely met. It stays a gap, not a verdict.",
};

function Neighbour({
  reading,
  role,
}: {
  reading: GraphNode & { cites_entries?: number };
  role?: "named" | "recorded";
}) {
  return (
    <Link
      className={`t-read${reading.tentative ? " ghost" : ""}`}
      to={`/node/${reading.id}`}
    >
      <span className="t-seal">
        <Seal id={reading.id} className="j-seal" />
      </span>
      <span className="t-main">
        <b>{reading.label}</b>
        <span className="mono">
          {role ? `${role} · ` : ""}
          {reading.kind.toLowerCase()} · {reading.tentative ? "less sure" : "kept"}
          {reading.cites_entries
            ? ` · drawn from ${reading.cites_entries} ${
                reading.cites_entries === 1 ? "entry" : "entries"
              }`
            : ""}
        </span>
      </span>
      <span className="t-side">
        <Meter confidence={reading.confidence ?? 0} />
        <span className="mono">{fmt(reading.confidence ?? 0)}</span>
      </span>
    </Link>
  );
}

function Parts({ neighbours }: { neighbours: (GraphNode & { cites_entries?: number })[] }) {
  const felt = feltThoughtOf(neighbours);
  const holds = heldReadingsOf(neighbours);
  const around = outerReadingsOf(neighbours);
  const rooms = [
    { name: "inside" as const, items: felt },
    { name: "holds" as const, items: holds },
    { name: "around" as const, items: around },
  ].filter((room) => room.items.length > 0);
  const leftover = rooms.length === 0 ? neighbours : [];

  return (
    <>
      <div className="t-sec">
        <span className="kicker">{SECTIONS.parts.title}</span>
        <span className="rule" />
        <span className="mono">{asideOf("parts")}</span>
      </div>
      {rooms.map((room) => (
        <div key={room.name}>
          <div className="t-sec">
            <span className="kicker">{SECTIONS[room.name].title}</span>
            <span className="rule" />
            <span className="mono">{asideOf(room.name)}</span>
          </div>
          {room.items.map((reading) => (
            <Neighbour key={reading.id} reading={reading} />
          ))}
        </div>
      ))}
      {leftover.map((reading) => (
        <Neighbour key={reading.id} reading={reading} />
      ))}
    </>
  );
}

/** One entry behind the finding, in the stream's own language. */
function Act({
  id,
  content,
  at,
  role,
}: {
  id: string;
  content: string;
  at: string;
  /** "first" or "then", for orderings only. */
  role?: string;
}) {
  return (
    <Link className="t-read" to={`/node/${id}`}>
      <span className="t-seal">
        <Seal id={id} className="j-seal" />
      </span>
      <span className="t-main">
        <b>{content}</b>
        <span className="mono">
          {/* Only an ordering finding has a first and a then. A recurrence has
              neither, and labelling every act "first" there was a claim about
              sequence the finding does not make. */}
          {role ? `${role} · ` : ""}
          {stampOf(at)}
        </span>
      </span>
    </Link>
  );
}
