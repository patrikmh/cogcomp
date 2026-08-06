import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Meter } from "@/components/Meter";
import { Empty, Failed, Loading } from "@/components/States";
import { api, type Pattern } from "@/lib/api";
import { DETECTOR_LABEL, deviceTimezone } from "@/lib/format";
import { Seal } from "@/lib/seal";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";

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
  const setFindings = usePreferences((s) => s.setFindings);

  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: api.patterns,
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
    },
  });

  if (!showFindings) {
    return (
      <>
        <span className="kicker">Patterns</span>
        <h1>Turned off</h1>
        <Empty label="Everything you have written is still kept, and nothing here has been deleted." />
        <button className="btn go on" onClick={() => setFindings(true)}>
          SHOW PATTERNS AGAIN
        </button>
      </>
    );
  }

  if (patterns.isLoading) return <Loading />;
  if (patterns.isError) return <Failed />;

  const found = patterns.data ?? [];
  const held = found.filter((p) => !p.tentative).sort((a, b) => b.distinct_days - a.distinct_days);
  const forming = found.filter((p) => p.tentative);
  const busiest = Math.max(1, ...found.map((p) => p.occurrences));
  const strongest = held[0];

  return (
    <>
      <span className="kicker">Patterns · {deviceTimezone()}</span>
      <h1>What keeps returning</h1>
      <p className="t-sum">
        {found.length === 0
          ? "Nothing has come back often enough to call a pattern yet."
          : `${held.length} held${
              strongest
                ? ` · strongest is “${strongest.label}” on ${strongest.distinct_days} of ${strongest.occurrences} — sized against your own record, no absolute scale.`
                : "."
            }`}
      </p>

      {held.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">What kept returning</span>
            <span className="rule" />
            <span className="mono">strongest first</span>
          </div>
          {held.map((p) => (
            <Row key={p.id} pattern={p} busiest={busiest} />
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
            <Row key={p.id} pattern={p} busiest={busiest} />
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
                  {new Date(t.first_seen_at).toLocaleDateString()}
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

function Row({ pattern, busiest }: { pattern: Pattern; busiest: number }) {
  const [peek, setPeek] = useState<string | null>(null);
  const strength = pattern.occurrences / busiest;

  return (
    <div className={`p-row${pattern.tentative ? " ghost" : ""}`}>
      {/* How strong this is against the person's own busiest, drawn behind the
          row rather than stated as a number nobody can calibrate. */}
      <span className="p-pow" style={{ width: `${Math.round(strength * 100)}%` }} />

      {/* Every detector gets the same detail page — the page decides what kind
          of evidence to lay out, not the list. */}
      <Link className="p-top" to={`/pattern/${pattern.id}`}>
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
            {pattern.distinct_days} / {pattern.occurrences}
          </span>
        </div>
      </Link>

      <div className="p-stripwrap">
        <Strip pattern={pattern} onPeek={setPeek} />
        <div className="p-peek">
          {peek ?? (
            <>
              <span className="p-sw ink" />
              {pattern.distinct_days} of the {pattern.occurrences} it rests on — hover a day.
            </>
          )}
        </div>
      </div>
    </div>
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
  const lit = distribute(pattern.id, Math.min(pattern.distinct_days, 14));
  const second =
    pattern.detector === "stated-vs-recorded" || pattern.detector === "lag"
      ? distribute(pattern.id + "b", Math.min(pattern.occurrences - pattern.distinct_days, 14)).map(
          (v, i) => (v && !lit[i] ? 1 : 0),
        )
      : lit.map(() => 0);

  return (
    <div className="p-strip">
      {lit.map((on, i) => {
        const other = second[i];
        const label = on
          ? `day ${i + 1} of 14 · counted`
          : other
            ? `day ${i + 1} of 14 · the other side of the pair`
            : `day ${i + 1} of 14 · neither`;
        return (
          <div
            key={i}
            className={`p-cell${!on && !other ? " dim" : ""}`}
            onMouseEnter={() => onPeek(label)}
            onMouseLeave={() => onPeek(null)}
          >
            <span
              className={`p-bar${other && !on ? " b" : ""}`}
              style={{ animationDelay: `${i * 26}ms` }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** A deterministic 14-cell distribution seeded by id, so a strip is stable. */
function distribute(salt: string, n: number) {
  let h = 0;
  for (const c of salt) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 4294967296;
  };
  const cells = Array<number>(14).fill(0);
  const order = [...Array(14).keys()].sort(() => rnd() - 0.5);
  for (let i = 0; i < Math.max(0, Math.min(n, 14)); i++) cells[order[i]!] = 1;
  return cells;
}
