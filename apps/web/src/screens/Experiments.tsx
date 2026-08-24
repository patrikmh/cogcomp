import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Meter } from "@/components/Meter";
import { Empty, Failed, Loading } from "@/components/States";
import { api, type Experiment } from "@/lib/api";
import { eligibleHeld, untriedOf } from "@/lib/drawn-from";
import { deviceTimezone, localDay, stampOf } from "@/lib/format";
import { Seal, seed } from "@/lib/seal";
import { usePreferences } from "@/state/preferences";
import { SECTIONS, asideOf } from "@tlon/copy/sections";

/**
 * Experiments: trials someone writes for themselves.
 *
 * The app never proposes one, never scores the outcome, and never interprets
 * the result. It holds the lifecycle and the evidence; the question and the
 * verdict are the person's.
 */
export function Experiments() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const findingsVisible = usePreferences((s) => s.findings);
  const graph = useQuery({
    queryKey: ["graph", "experiments"],
    queryFn: () => api.graph(200),
    enabled: findingsVisible,
  });
  const list = useQuery({
    queryKey: ["experiments", findingsVisible],
    queryFn: () => api.experiments(findingsVisible),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const create = useMutation({
    mutationFn: () =>
      api.createExperiment({
        id: crypto.randomUUID(),
        title: "Untitled trial",
        hypothesis: "I wonder whether…",
        action: "What I will do",
        success_criterion: "What would count as useful to notice",
        start_date: localDay(),
        duration_days: 14,
        timezone: deviceTimezone(),
        cadence: "daily",
      }),
    onSuccess: (created) => {
      void client.invalidateQueries({ queryKey: ["experiments"] });
      navigate(`/experiment/${created.id}`);
    },
  });

  // `GET /v1/experiments` returns rows without their check-ins; the arcs are a
  // picture of check-in density, so the detail of each is fetched. A handful of
  // trials is a handful of requests — and an arc drawn from a count the list
  // does not carry would have been an empty arc that looked like a real one.
  const details = useQueries({
    queries: (list.data?.experiments ?? []).map((x) => ({
      queryKey: ["experiment", x.id, findingsVisible],
      queryFn: () => api.experiment(x.id, findingsVisible),
    })),
  });
  const checkinsOf = new Map(
    details.filter((d) => d.data).map((d) => [d.data!.id, d.data!.checkins?.length ?? 0]),
  );
  const detailById = new Map(details.map((d, i) => [list.data?.experiments[i]?.id, d]));

  if (list.isLoading) return <Loading />;
  if (list.isError) return <Failed onRetry={() => void list.refetch()} />;

  const all = list.data?.experiments ?? [];
  const order: Record<string, number> = { active: 0, paused: 1, draft: 2, completed: 3, cancelled: 4 };
  const sorted = [...all].sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9));
  const running = all.filter((x) => x.state === "active").length;
  const done = all.filter((x) => x.state === "completed").length;
  const untried = findingsVisible
    ? untriedOf(graph.data?.nodes ?? [], all)
    : [];

  return (
    <>
      <span className="kicker">Experiments</span>
      <h1>Things you decided to try</h1>
      <p className="t-sum">
        {all.length} {all.length === 1 ? "experiment" : "experiments"} · {running} running · {done}{" "}
        completed — you judge them, the app doesn&rsquo;t. Nothing here is proposed, scored, or
        judged for you.
      </p>

      {all.length === 0 ? (
        <Empty label="No experiments yet." />
      ) : (
        <>
          <div className="t-sec">
            <span className="kicker">Your arcs</span>
            <span className="rule" />
            <span className="mono">active first</span>
          </div>
          {sorted.map((x) => (
            <Row
              key={x.id}
              experiment={x}
              checkins={checkinsOf.get(x.id)}
              detailError={detailById.get(x.id)?.isError}
              onRetry={() => void detailById.get(x.id)?.refetch()}
            />
          ))}
        </>
      )}

      {untried.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.untried.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("untried")}</span>
          </div>
          {untried.map((reading) => (
            <Link key={reading.id} className="t-read" to={`/node/${reading.id}`}>
              <span className="t-main">
                <b>{reading.label}</b>
                <span className="mono">{reading.kind.toLowerCase()}</span>
              </span>
            </Link>
          ))}
        </>
      )}

      <div className="row" style={{ marginTop: 22 }}>
        <button className="btn" disabled={create.isPending} onClick={() => create.mutate()}>
          WRITE AN EXPERIMENT
        </button>
      </div>
      <p className="mono" style={{ marginTop: 12 }}>
        1–42 days. Check-ins are ordinary journal entries — the arcs show their shape, not exact
        dates.
      </p>
    </>
  );
}

/**
 * The state name the stylesheet knows.
 *
 * The design was drawn before the lifecycle had five states; its vocabulary is
 * running / drafted / completed. Mapped in one place rather than letting the
 * API's identifiers leak into class names the stylesheet has never heard of —
 * `.x-state.active` would simply have rendered unstyled.
 */
const LOOK: Record<Experiment["state"], string> = {
  active: "running",
  paused: "drafted",
  draft: "drafted",
  completed: "completed",
  cancelled: "completed",
};

/** One trial, with its arc: a cell per day, lit where a check-in landed. */
function Row({
  experiment,
  checkins,
  detailError,
  onRetry,
}: {
  experiment: Experiment;
  checkins?: number;
  detailError?: boolean;
  onRetry: () => void;
}) {
  const look = LOOK[experiment.state];
  return (
    <div className={`p-row x-row ${look}`}>
      <Link className="p-top" to={`/experiment/${experiment.id}`} title={`open ${experiment.title}`}>
        <span className="t-seal">
          <Seal id={experiment.id} className="j-seal" />
        </span>
        <div className="p-head">
          <b>{experiment.title}</b>
          <span className="mono">
            {experiment.cadence} · {experiment.duration_days} days
            {/* What it was set against, as the design shows it. An experiment
                with no reading behind it is just a task. */}
            {(experiment.links ?? []).length > 0 &&
              ` · from ${experiment.links!.map((l) => l.label ?? "a removed reading").join(", ")}`}
          </span>
        </div>
        <div className="p-met">
          {/* The design's vocabulary, not the API's. `LOOK` already existed for
              the row's class and the label was still printing the raw state, so
              a paused trial announced itself as "PAUSED" on a screen whose only
              words for this are running, drafted and completed. */}
          <span className={`x-state ${look}`}>{look}</span>
          <span className="mono">
            {detailError ? <Failed label="Could not load check-ins." onRetry={onRetry} /> : `${checkins ?? 0} of ${experiment.duration_days} check-ins`}
          </span>
        </div>
      </Link>
      {checkins !== undefined && !detailError && <Arc experiment={experiment} checkins={checkins} look={look} />}
    </div>
  );
}

function Arc({
  experiment,
  checkins,
  look,
  big,
}: {
  experiment: Experiment;
  checkins: number;
  look: string;
  big?: boolean;
}) {
  // Exactly as many lit cells as there are check-ins, placed deterministically.
  //
  // This used to light each cell with probability `checkins / duration`, which
  // meant the strip showed a number of check-ins that was merely likely — one
  // check-in across fourteen days lit nothing at all, so a person who had come
  // back to their own experiment saw an empty arc and the words "1 of 14"
  // beside it. Which days are lit is still illustrative, and the caption says
  // so; how many are lit is now a fact.
  const lit = litCells(experiment.id, experiment.duration_days, checkins, experiment.state);
  return (
    <div className={`x-strip ${look}${big ? " big" : ""}`}>
      {Array.from({ length: experiment.duration_days }, (_, i) => {
        const on = lit.has(i);
        return (
          <div key={i} className={`x-cell${on ? " on" : ""}`}>
            <span className="x-bar" style={on ? { animationDelay: `${i * 24}ms` } : undefined} />
          </div>
        );
      })}
    </div>
  );
}

export function ExperimentDetail() {
  const { id = "" } = useParams();
  const findingsVisible = usePreferences((s) => s.findings);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [arming, setArming] = useState(false);
  const [assessment, setAssessment] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [final, setFinal] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["experiment", id, findingsVisible],
    queryFn: () => api.experiment(id, findingsVisible),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const graph = useQuery({
    queryKey: ["graph"],
    queryFn: () => api.graph(200),
    enabled: findingsVisible && detail.data?.state === "draft",
  });
  const patterns = useQuery({
    queryKey: ["patterns"],
    queryFn: api.patterns,
    enabled: findingsVisible && detail.data?.state === "draft",
  });

  const took = (updated: Experiment) => {
    // The transition answers with the whole experiment, so the cache takes it
    // directly rather than refetching.
    client.setQueryData(["experiment", id, findingsVisible], updated);
    void client.invalidateQueries({ queryKey: ["experiments"] });
  };
  const move = useMutation({
    mutationFn: (target: "start" | "pause" | "resume" | "cancel") =>
      api.experimentTransition(id, target, detail.data!.revision, findingsVisible),
    onSuccess: took,
  });
  const complete = useMutation({
    mutationFn: () =>
      api.completeExperiment(id, detail.data!.revision, assessment!, final!, note, findingsVisible),
    onSuccess: took,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteExperiment(id, detail.data!.revision),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["experiments"] });
      navigate("/experiments");
    },
  });
  const link = useMutation({
    mutationFn: (nodeId: string) =>
      api.linkExperiment(id, nodeId, detail.data!.revision, findingsVisible),
    onSuccess: took,
  });

  if (detail.isLoading) return <Loading />;
  if (detail.isError || !detail.data) return <Failed onRetry={() => void detail.refetch()} />;

  const x = detail.data;
  const look = LOOK[x.state];
  const checkins = x.checkins ?? [];

  return (
    <>
      <span className="kicker">Experiment · {x.cadence}</span>
      <h1>{x.title}</h1>
      <div className="row" style={{ gap: 12 }}>
        <span className={`x-state ${look}`}>{x.state}</span>
        <span className="mono">
          {x.duration_days} days · from {x.start_date} · {x.timezone}
        </span>
      </div>

      <div className="t-sum">
        {checkins.length} of {x.duration_days} check-ins · {x.cadence} · you decide what it means
      </div>
      <div className="row" style={{ gap: 14 }}>
        <Meter confidence={Math.min(1, checkins.length / Math.max(1, x.duration_days))} />
        <span className="mono">
          {Math.round((checkins.length / Math.max(1, x.duration_days)) * 100)}% of the days have a
          check-in
        </span>
      </div>

      <Arc experiment={x} checkins={checkins.length} look={look} big />
      <p className="x-cap mono">
        The arc shows the shape of your check-ins, not exact dates.
      </p>

      <div className="t-sec">
        <span className="kicker">What you wrote down</span>
        <span className="rule" />
        <span className="mono">yours, unedited</span>
      </div>
      <div className="cards">
        <div className="card">
          <span className="kicker">Hypothesis</span>
          <p>{x.hypothesis}</p>
        </div>
        <div className="card">
          <span className="kicker">Action</span>
          <p>{x.action}</p>
        </div>
        <div className="card">
          <span className="kicker">What would count</span>
          <p>{x.success_criterion}</p>
        </div>
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        {x.state === "draft" && (
          <button className="btn" onClick={() => move.mutate("start")}>
            START
          </button>
        )}
        {x.state === "active" && (
          <button className="btn ghost" onClick={() => move.mutate("pause")}>
            PAUSE
          </button>
        )}
        {x.state === "paused" && (
          <button className="btn ghost" onClick={() => move.mutate("resume")}>
            RESUME
          </button>
        )}
        {(x.state === "active" || x.state === "paused") && (
          <button className="btn ghost" onClick={() => move.mutate("cancel")}>
            CANCEL
          </button>
        )}
        {/* Two taps for anything that cannot be undone. */}
        <button
          className="btn ghost warn"
          onClick={() => (arming ? remove.mutate() : setArming(true))}
        >
          {arming ? "TAP AGAIN TO CONFIRM" : "DELETE"}
        </button>
      </div>

      {checkins.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">Check-ins</span>
            <span className="rule" />
            <span className="mono">ordinary journal entries</span>
          </div>
          {/* A check-in is an ordinary entry, and the design makes each one a
              link to it — this rendered them as plain rows, so the one screen
              that lists the acts a trial rests on was the one place you could
              not open them. While the trial is running there is a control here
              too, and a button cannot sit inside a link, so the row stays a row
              and the words carry the link instead. */}
          {checkins.map((c) => (
            <div className="t-read" key={c.id}>
              <span className="t-seal">
                <Seal id={c.id} className="j-seal" />
              </span>
              <span className="t-main">
                <Link to={`/node/${c.id}`}>
                  <b>{c.content}</b>
                </Link>
                <span className="mono">{stampOf(c.captured_at)}</span>
              </span>
              {x.state === "active" && (
                <span className="t-side">
                  <button
                    className={`btn ghost${final === c.id ? " on" : ""}`}
                    onClick={() => setFinal(c.id)}
                  >
                    {final === c.id ? "SELECTED FINAL CHECK-IN" : "SELECT AS FINAL CHECK-IN"}
                  </button>
                </span>
              )}
            </div>
          ))}
        </>
      )}

      {findingsVisible && (x.links ?? []).length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">What it tests</span>
            <span className="rule" />
            <span className="mono">the readings this was set against</span>
          </div>
          {x.links!.map((linked) => (
            <Link className="t-read" key={linked.node_id} to={`/node/${linked.node_id}`}>
              <span className="t-main">
                <b>{linked.label ?? "a reading that is no longer here"}</b>
                <span className="mono">
                  {linked.availability ? (linked.kind ?? "").toLowerCase() : "removed since"}
                </span>
              </span>
            </Link>
          ))}
        </>
      )}

      {findingsVisible && x.state === "draft" && (
        <Against
          already={new Set((x.links ?? []).map((linked) => linked.node_id))}
          held={(graph.data?.nodes ?? []).filter(eligibleHeld)}
          patterns={(patterns.data ?? []).filter((pattern) => !pattern.tentative)}
          busy={link.isPending}
          onLink={(nodeId) => link.mutate(nodeId)}
        />
      )}

      {x.state === "active" && (
        <>
          <div className="t-sec">
            <span className="kicker">Complete with a qualitative assessment</span>
            <span className="rule" />
            <span className="mono">your judgement, not a score</span>
          </div>
          <div className="row">
            {(["met", "partly_met", "not_met", "unclear"] as const).map((value) => (
              <button
                key={value}
                className={`btn ghost${assessment === value ? " on" : ""}`}
                role="radio"
                aria-checked={assessment === value}
                onClick={() => setAssessment(value)}
              >
                {value.replace("_", " ")}
              </button>
            ))}
          </div>
          {/* The four words are a vocabulary, not the whole reading. What
              actually happened rarely fits one of them, and the note is where
              the person says it in their own words — kept verbatim, never
              parsed into a score. */}
          <div className="x-assess">
            <textarea
              value={note}
              placeholder="What actually happened, in your words (optional)"
              rows={3}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn"
              disabled={!assessment || !final || complete.isPending}
              onClick={() => complete.mutate()}
            >
              COMPLETE EXPERIMENT
            </button>
            <span className="mono">
              {!final
                ? "Choose the check-in that ends it."
                : !assessment
                  ? "Say how it went, in your words."
                  : "Nothing is scored — this is your reading of it."}
            </span>
          </div>
        </>
      )}

      {x.outcome && (
        <div className="card" style={{ marginTop: 18 }}>
          <span className="kicker">Outcome</span>
          <p>{x.outcome.assessment.replace("_", " ")}</p>
          {x.outcome.note && <p className="quote">{x.outcome.note}</p>}
          <span className="mono">
            Final check-in selected by you. No score, no interpretation.
          </span>
        </div>
      )}
    </>
  );
}

function Against({
  already,
  held,
  patterns,
  busy,
  onLink,
}: {
  already: Set<string>;
  held: { id: string; kind: string; label: string }[];
  patterns: { id: string; label: string }[];
  busy: boolean;
  onLink: (nodeId: string) => void;
}) {
  const readings = held.filter((reading) => !already.has(reading.id));
  const live = patterns.filter((pattern) => !already.has(pattern.id));
  return (
    <>
      <div className="t-sec">
        <span className="kicker">Set it against</span>
        <span className="rule" />
        <span className="mono">{asideOf("wondered")}</span>
      </div>
      <p className="t-sum">A reading you hold, or a live pattern. The app does not propose one.</p>
      {readings.map((reading) => (
        <button
          key={reading.id}
          className="t-read"
          type="button"
          disabled={busy}
          onClick={() => onLink(reading.id)}
        >
          <span className="t-main">
            <b>{reading.label}</b>
            <span className="mono">{reading.kind.toLowerCase()} · you hold this</span>
          </span>
        </button>
      ))}
      {live.map((pattern) => (
        <button
          key={pattern.id}
          className="t-read"
          type="button"
          disabled={busy}
          onClick={() => onLink(pattern.id)}
        >
          <span className="t-main">
            <b>{pattern.label}</b>
            <span className="mono">live pattern</span>
          </span>
        </button>
      ))}
      {readings.length === 0 && live.length === 0 && (
        <p className="mono">Nothing live to set this against yet.</p>
      )}
    </>
  );
}

/**
 * Which days of an arc are lit, and how many.
 *
 * Which days is illustrative and the caption says so; how many is a fact, and
 * sits beside "6 of 14 check-ins" where anyone can compare the two.
 */
export function litCells(
  id: string,
  duration: number,
  checkins: number,
  state: string,
): Set<number> {
  if (state === "draft") return new Set();
  const rnd = seed(id);
  const order = Array.from({ length: duration }, (_, i) => i).sort(() => rnd() - 0.5);
  return new Set(order.slice(0, Math.min(checkins, duration)));
}
