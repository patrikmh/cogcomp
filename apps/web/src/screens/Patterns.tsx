import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Meter } from "@/components/Meter";
import { Failed, Loading } from "@/components/States";
import { api, type Pattern, type PatternThread, type TemporalChange } from "@/lib/api";
import { DETECTOR_LABEL, dateOf, deviceTimezone, fmt } from "@/lib/format";
import { shiftsForSubjects } from "@/lib/patterns";
import { stripSeries } from "@tlon/design/marks";

import { Seal } from "@/lib/seal";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { heldFirst } from "@/lib/drawn-from";
import { patternDestination } from "@/lib/patterns";
import { HEADINGS } from "@tlon/copy/headings";
import { EMPTY as EMPTY_COPY } from "@tlon/copy/empty";
import { STRIP_CELLS, daysOfFortnight } from "@tlon/design/marks";

/**
 * What keeps returning.
 *
 * Every finding is a row with three things in it: how strong it is against this
 * person's own busiest fortnight (the power bar behind it), what it rests on
 * (the readings it is made of), and *which days* — the strip.
 *
 * The strip is the part that matters. A finding stated as a sentence is
 * something you either take or leave; the same finding as fourteen days you can
 * point at is something you can check. Each cell carries what that day actually
 * encodes, and hovering says it in words rather than leaving it to a legend.
 *
 * Held findings come first, then the ones still forming — kept apart under
 * their own rule, because "this holds" and "this might" are different claims
 * and a reader must never have to infer which they are looking at.
 */
export function Patterns() {
  const userId = useSession((s) => s.userId);
  const client = useQueryClient();
  const showFindings = usePreferences((s) => s.findings);

  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: api.patterns,
    enabled: showFindings,
  });
  const threads = useQuery({
    queryKey: ["threads", userId],
    queryFn: api.threads,
    enabled: showFindings,
  });
  const tz = deviceTimezone();
  const changes = useQuery({
    // Same key Headspace reads, so one fetch serves both screens.
    queryKey: ["temporal", tz],
    queryFn: () => api.changes(tz),
    enabled: showFindings,
  });
  const themes = useQuery({
    queryKey: ["themes", userId],
    queryFn: api.themes,
    enabled: showFindings,
  });
  const mine = useMutation({
    mutationFn: api.minePatterns,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["patterns", userId] });
      void client.invalidateQueries({ queryKey: ["themes", userId] });
      // Mining writes pattern nodes into the graph; the map and the graph
      // screen draw them. The mobile client refreshed this and this one did
      // not.
      void client.invalidateQueries({ queryKey: ["graph"] });
    },
  });

  // No findings-off branch here. FindingsRoute already redirects this route
  // home when the switch is off, so a turned-off state could never render —
  // the mobile client shows one because nothing redirects there.

  if (patterns.isLoading) return <Loading />;
  if (patterns.isError) return <Failed onRetry={() => void patterns.refetch()} />;

  const found = patterns.data ?? [];
  const held = found.filter((p) => !p.tentative).sort((a, b) => b.distinct_days - a.distinct_days);
  const forming = found.filter((p) => p.tentative);
  const strongest = held[0];

  return (
    <>
      <span className="kicker">Patterns · {deviceTimezone()}</span>
      <h1>{HEADINGS.patterns.title}</h1>
      <p className="t-sum">
        {found.length === 0
          ? EMPTY_COPY.patternsWaiting
          : `${held.length} held${
              strongest
                ? ` · strongest is “${strongest.label}” on ${strongest.distinct_days} of ${strongest.occurrences} — sized against your own record, no absolute scale.`
                : "."
            }`}
      </p>

      {held.length > 0 && (threads.data ?? []).length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">One thing, several directions</span>
            <span className="rule" />
            <span className="mono">grouped only by shared evidence words</span>
          </div>
          {(threads.data ?? []).map((thread) => (
            <ThreadCard
              key={thread.subjects.join("\u0000")}
              thread={thread}
              changes={changes.data?.changes ?? []}
            />
          ))}
        </>
      )}

      {held.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">What kept returning</span>
            <span className="rule" />
            <span className="mono">strongest first</span>
          </div>
          {held.map((p) => (
            <Row key={p.id} pattern={p} />
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
            <Row key={p.id} pattern={p} />
          ))}
        </>
      )}

      {(themes.data ?? []).length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">Regions</span>
            <span className="rule" />
            <span className="mono">groups, not pairs</span>
          </div>
          {themes.data!.map((t) => (
            <Link key={t.id} to={`/theme/${t.id}`} className="t-read">
              <span className="t-seal">
                <Seal id={t.id} className="j-seal" />
              </span>
              <span className="t-main">
                <b>{t.label}</b>
                <span className="mono">
                  {t.member_count} things · held since{" "}
                  {dateOf(t.first_seen_at)}
                  {t.epistemic_status === "user_rejected" ? " · you rejected this" : ""}
                </span>
              </span>
            </Link>
          ))}
        </>
      )}

      <button className="btn" disabled={mine.isPending} onClick={() => mine.mutate()}>
        {mine.isPending ? "LOOKING…" : "LOOK AGAIN"}
      </button>
    </>
  );
}

/**
 * One subject, seen by every detector that found it.
 *
 * The grouping is arithmetic over the stored graph — members share a normalised
 * evidence word, and nothing else. The card says so rather than implying a
 * synthesis: each member keeps its own claim, its own confidence, and its own
 * way in, so a person who doubts the group can doubt one row at a time.
 */
function ThreadCard({ thread, changes }: { thread: PatternThread; changes: readonly TemporalChange[] }) {
  // A shift that shares a subject word is shown as another direction on the
  // same thread — matched by exact normalised label only, and still phrased as
  // the comparison it is, linking to the Week screen where the two windows live.
  const shifts = shiftsForSubjects(changes, thread.subjects);
  return (
    <div className="p-row">
      <div className="p-head">
        <b>{thread.subjects.join(" · ")}</b>
        <span className="mono">
          {thread.members.length} findings, {thread.members.filter((m) => !m.tentative).length} held
        </span>
      </div>
      <div className="p-comp">
        {thread.members.map((member) => (
          <Link
            key={member.id}
            className={`c${member.tentative ? " ghost" : ""}`}
            to={patternDestination(member).href}
          >
            {DETECTOR_LABEL[member.detector] ?? member.detector}: {member.label}
          </Link>
        ))}
      </div>
      {shifts.length > 0 && (
        <div className="p-comp">
          <span className="clab">changed lately</span>
          {shifts.map((shift) => (
            <Link key={`${shift.kind}:${shift.label}`} className={`c${shift.confidence < 0.5 ? " ghost" : ""}`} to="/week">
              {shift.description}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ pattern }: { pattern: Pattern }) {
  const [peek, setPeek] = useState<string | null>(null);
  // Days against the fortnight, as the design divides it — its fixtures read
  // `days: 9, busiest: 14`, and 14 is the window the strip below draws. This
  // divided occurrences by the busiest finding, which compares a count of
  // mentions to a different count of mentions and makes the strongest finding
  // always full.
  const strength = Math.min(pattern.distinct_days / STRIP_CELLS, 1);
  const composition = useQuery({
    queryKey: ["neighbours", pattern.id],
    queryFn: () => api.neighbours(pattern.id),
  });
  const made = [...(composition.data?.neighbours ?? [])].sort(heldFirst);

  return (
    <div className={`p-row${pattern.tentative ? " ghost" : ""}`}>
      {/* How strong this is against the person's own busiest, drawn behind the
          row rather than stated as a number nobody can calibrate. */}
      <span className="p-pow" style={{ width: `${Math.round(strength * 100)}%` }} />

      {/* Where a tap lands depends on what found it: only the lag detector can
          keep the ordering screen's promise, so everything else opens the
          explain screen — the same decision the phone makes. */}
      <Link className="p-top" to={patternDestination(pattern).href}>
        <span className="t-seal">
          <Seal id={pattern.id} className="j-seal" />
        </span>
        <div className="p-head">
          <b>{pattern.label}</b>
          <span className="mono">{DETECTOR_LABEL[pattern.detector] ?? pattern.detector}</span>
        </div>
        <div className="p-met">
          <Meter confidence={pattern.confidence} />
          <span className="mono">
            {daysOfFortnight(pattern.distinct_days).replace(" of ", " / ")}
          </span>
        </div>
      </Link>


      <div className="p-stripwrap">
        <Strip pattern={pattern} onPeek={setPeek} />
        <div className="p-peek">
          {peek ?? <Legend pattern={pattern} />}
        </div>
        <p className="mono">Illustrative placement only — cells are not calendar days or counted dates. Exact counts and source evidence are on the finding.</p>
      </div>

      {/* What the finding is made of, linked to their own evidence. A finding
          nobody can decompose is a finding nobody can argue with. */}
      <div className="p-comp">
        <span className="clab">drawn from</span>
        {made.length === 0 ? (
          <span className="c gone">nothing drawn from entries yet</span>
        ) : (
          made.map((r) => (
            <Link key={r.id} className={`c${r.tentative ? " ghost" : ""}`} to={`/node/${r.id}`}>
              {/* The confidence travels with the chip, as the design has it. A
                  finding is made of readings the app is more and less sure of,
                  and a chip that hides that makes them all look equally solid. */}
              {r.label} · {fmt(r.confidence ?? 0)}
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * What the strip's colours mean, in the finding's own terms.
 *
 * A two-sided finding needs both halves named or the second colour is a riddle;
 * a one-sided one needs no legend at all, just the count. Stated rather than
 * left to a key the reader has to hunt for.
 */
function Legend({ pattern }: { pattern: Pattern }) {
  if (pattern.detector === "stated-vs-recorded") {
    return (
      <>
        <span className="p-sw ink" />
        stated · <span className="p-sw sand" />
        recorded — the two rarely meet. Illustrative cells, not calendar dates. Hover a cell.
      </>
    );
  }
  if (pattern.detector === "lag" || pattern.detector === "same-day-order") {
    return (
      <>
        <span className="p-sw ink" />
        first · <span className="p-sw line" />
        then — never in the same entry. Illustrative cells, not calendar dates. Hover a cell.
      </>
    );
  }
  return (
    <>
      <span className="p-sw ink" />
      {pattern.distinct_days} of the {pattern.occurrences} it rests on — illustrative placement, not calendar dates. Hover a cell.
    </>
  );
}

/**
 * Fourteen days, and what each of them held.
 *
 * Which days are lit comes from the finding's own counts, distributed by a hash
 * of its id — deterministic, so the strip never changes shape between renders.
 * It is a shape of the finding's density, not a claim about specific dates, and
 * the peek says only what the cell encodes.
 */
function Strip({ pattern, onPeek }: { pattern: Pattern; onPeek: (peek: string | null) => void }) {
  const { lit, second } = stripSeries(pattern);

  return (
    <div className="p-strip">
      {lit.map((on, i) => {
        const other = second[i];
        const label = on
          ? `illustrative cell ${i + 1} of 14 · counted recurrence, not a calendar date`
          : other
            ? `illustrative cell ${i + 1} of 14 · the other side of the pair, not a calendar date`
            : `illustrative cell ${i + 1} of 14 · neither; not a calendar date`;
        return (
          <div
            key={i}
            className={`p-cell${!on && !other ? " dim" : ""}`}
            onMouseEnter={() => onPeek(label)}
            onMouseLeave={() => onPeek(null)}
          >
            <span
              className={`p-bar${
                other && !on ? (pattern.detector === "stated-vs-recorded" ? " r" : " b") : on && pattern.detector === "stated-vs-recorded" ? " s" : ""
              }`}
              style={{
                animationDelay: `${i * 26}ms`,
                ...(other && !on && pattern.detector === "stated-vs-recorded"
                  ? { height: "55%" }
                  : {}),
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** A deterministic 14-cell distribution seeded by id, so a strip is stable. */

/**
 * The two series a strip draws: what was counted, and — for a two-sided finding
 * — the other half of the pair.
 *
 * Only an ordering and a stated-against-recorded have a second side. For
 * everything else the second series is empty, because a recurrence has no other
 * half and drawing one would invent a distinction the finding never made.
 *
 * Extracted so it can be tested. It cannot be reached with real data: a lag
 * finding needs the same reading on both days, and the extractor gives the same
 * sentence different kinds on different days often enough that no pair clears
 * the detector's floor. That is worth knowing on its own, and it is no reason
 * to leave the drawing untested.
 */

export { stripSeries } from "@tlon/design/marks";
