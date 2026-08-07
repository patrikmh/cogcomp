import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Meter } from "@/components/Meter";
import { Empty, Failed, Loading } from "@/components/States";
import { api, type Experiment } from "@/lib/api";
import { deviceTimezone, localDay } from "@/lib/format";
import { Seal, seed } from "@/lib/seal";

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
  const list = useQuery({ queryKey: ["experiments"], queryFn: api.experiments });

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
      queryKey: ["experiment", x.id],
      queryFn: () => api.experiment(x.id),
    })),
  });
  const checkinsOf = new Map(
    details.filter((d) => d.data).map((d) => [d.data!.id, d.data!.checkins?.length ?? 0]),
  );

  if (list.isLoading) return <Loading />;
  if (list.isError) return <Failed />;

  const all = list.data?.experiments ?? [];
  const order: Record<string, number> = { active: 0, paused: 1, draft: 2, completed: 3, cancelled: 4 };
  const sorted = [...all].sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9));
  const running = all.filter((x) => x.state === "active").length;
  const done = all.filter((x) => x.state === "completed").length;

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
            <Row key={x.id} experiment={x} checkins={checkinsOf.get(x.id) ?? 0} />
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
function Row({ experiment, checkins }: { experiment: Experiment; checkins: number }) {
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
          </span>
        </div>
        <div className="p-met">
          <span className={`x-state ${look}`}>{experiment.state}</span>
          <span className="mono">
            {checkins} of {experiment.duration_days} check-ins
          </span>
        </div>
      </Link>
      <Arc experiment={experiment} checkins={checkins} look={look} />
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
  // The arc's shape is deterministic per experiment — illustrative of density
  // rather than a claim about which specific days were checked in on, which the
  // caption says out loud.
  const rnd = seed(experiment.id);
  const density = checkins / Math.max(1, experiment.duration_days);
  return (
    <div className={`x-strip ${look}${big ? " big" : ""}`}>
      {Array.from({ length: experiment.duration_days }, (_, i) => {
        const on = experiment.state !== "draft" && rnd() < density;
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
  const client = useQueryClient();
  const navigate = useNavigate();
  const [arming, setArming] = useState(false);
  const [assessment, setAssessment] = useState<string | null>(null);
  const [final, setFinal] = useState<string | null>(null);

  const detail = useQuery({ queryKey: ["experiment", id], queryFn: () => api.experiment(id) });

  const took = (updated: Experiment) => {
    // The transition answers with the whole experiment, so the cache takes it
    // directly rather than refetching.
    client.setQueryData(["experiment", id], updated);
    void client.invalidateQueries({ queryKey: ["experiments"] });
  };
  const move = useMutation({
    mutationFn: (target: "start" | "pause" | "resume" | "cancel") =>
      api.experimentTransition(id, target, detail.data!.revision),
    onSuccess: took,
  });
  const complete = useMutation({
    mutationFn: () =>
      api.completeExperiment(id, detail.data!.revision, assessment!, final!),
    onSuccess: took,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteExperiment(id, detail.data!.revision),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["experiments"] });
      navigate("/experiments");
    },
  });

  if (detail.isLoading) return <Loading />;
  if (detail.isError || !detail.data) return <Failed />;

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
          {checkins.map((c) => (
            <div className="t-read" key={c.id}>
              <span className="t-seal">
                <Seal id={c.id} className="j-seal" />
              </span>
              <span className="t-main">
                <b>{c.content}</b>
                <span className="mono">{new Date(c.captured_at).toLocaleString()}</span>
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
          <span className="mono">
            Final check-in selected by you. No score, no interpretation.
          </span>
        </div>
      )}
    </>
  );
}
