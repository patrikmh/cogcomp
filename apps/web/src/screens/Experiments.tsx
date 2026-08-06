import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Empty, Failed, Loading } from "@/components/States";
import { api } from "@/lib/api";
import { deviceTimezone, localDay } from "@/lib/format";

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

  return (
    <>
      <div className="p-head">
        <div>
          <span className="kicker">Experiments</span>
          <h1>Try a question, in your own words</h1>
        </div>
        <button className="btn go on" disabled={create.isPending} onClick={() => create.mutate()}>
          WRITE AN EXPERIMENT
        </button>
      </div>

      {list.isLoading ? (
        <Loading />
      ) : list.isError ? (
        <Failed />
      ) : (list.data?.experiments ?? []).length === 0 ? (
        <Empty label="No experiments yet." />
      ) : (
        list.data!.experiments.map((x) => (
          <Link key={x.id} to={`/experiment/${x.id}`} className="card x-row">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>{x.title}</b>
              <span className="mono x-state">{x.state}</span>
            </div>
            <span className="mono" style={{ color: "var(--faint)" }}>
              {x.duration_days} days · {x.cadence}
            </span>
          </Link>
        ))
      )}
    </>
  );
}

export function ExperimentDetail() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ["experiment", id], queryFn: () => api.experiment(id) });

  const move = useMutation({
    mutationFn: (target: "start" | "pause" | "resume" | "cancel") =>
      api.experimentTransition(id, target, detail.data!.revision),
    onSuccess: (updated) => {
      // The transition answers with the whole experiment, so the cache can take
      // it directly rather than refetching.
      client.setQueryData(["experiment", id], updated);
      void client.invalidateQueries({ queryKey: ["experiments"] });
    },
  });

  if (detail.isLoading) return <Loading />;
  if (detail.isError || !detail.data) return <Failed />;
  const x = detail.data;

  return (
    <>
      <div className="p-head">
        <div>
          <span className="kicker">Experiment · {x.state}</span>
          <h1>{x.title}</h1>
        </div>
      </div>

      <div className="card">
        <span className="kicker">Hypothesis</span>
        <p>{x.hypothesis}</p>
        <span className="kicker">Action</span>
        <p>{x.action}</p>
        <span className="kicker">What would count</span>
        <p>{x.success_criterion}</p>
      </div>

      <div className="row">
        {x.state === "draft" && (
          <button className="btn go on" onClick={() => move.mutate("start")}>
            START
          </button>
        )}
        {x.state === "active" && (
          <button className="btn" onClick={() => move.mutate("pause")}>
            PAUSE
          </button>
        )}
        {x.state === "paused" && (
          <button className="btn" onClick={() => move.mutate("resume")}>
            RESUME
          </button>
        )}
      </div>

      {(x.checkins ?? []).length > 0 && (
        <>
          <div className="grp">
            <span className="kicker">Check-ins</span>
          </div>
          {x.checkins!.map((c) => (
            <div className="quote" key={c.id}>
              <p>{c.content}</p>
            </div>
          ))}
        </>
      )}

      {x.outcome && (
        <div className="card">
          <span className="kicker">Outcome</span>
          <p>{x.outcome.assessment.replace("_", " ")}</p>
          <span className="mono" style={{ color: "var(--faint)" }}>
            Final check-in selected by you. No score or interpretation.
          </span>
        </div>
      )}
    </>
  );
}
