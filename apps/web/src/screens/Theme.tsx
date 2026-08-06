import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { Failed, Loading } from "@/components/States";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";

/**
 * A region of a life, opened.
 *
 * A pattern says one thing keeps coming back; an association says two things
 * travel together. This says something neither can — that a *group* of things
 * is one area of your life — which makes it the densest claim here and the one
 * with the most room to be wrong. So it shows its working: the members, and how
 * many associations formed the region.
 */
export function Theme() {
  const { id = "" } = useParams();
  const theme = useQuery({ queryKey: ["theme", id], queryFn: () => api.theme(id) });

  if (theme.isLoading) return <Loading label="Reading the region…" />;
  if (theme.isError || !theme.data) return <Failed label="Could not load this region." />;

  const region = theme.data;
  return (
    <>
      <div className="p-head">
        <div>
          <span className="kicker">A region, not a diagnosis</span>
          <h1>{region.label}</h1>
        </div>
        <span className="mono">
          {region.member_count} things · {fmt(region.confidence)}
        </span>
      </div>

      <p className="sub">
        These came up in the same entries as each other, often enough to form a group. That is a
        shape in what you wrote — not a part of your life the app has decided something about.
      </p>

      <div className="grp">
        <span className="kicker">What is in it</span>
      </div>
      {region.members.map((member) => (
        <Link key={member.id} to={`/node/${member.id}`} className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>{member.label}</b>
            <span className="mono">
              {member.kind.toLowerCase()} · {fmt(member.confidence)}
            </span>
          </div>
        </Link>
      ))}

      <div className="card">
        <span className="kicker">How this was formed</span>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="mono">Associations inside it</span>
          <span className="mono">
            {region.associations.length} {region.associations.length === 1 ? "pair" : "pairs"}
          </span>
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="mono">Held since</span>
          <span className="mono">{new Date(region.first_seen_at).toLocaleDateString()}</span>
        </div>
      </div>

      <p className="rest mono">
        Regions are built from things appearing together and nothing else. No direction, no cause,
        and no claim about which of them came first.
      </p>
    </>
  );
}
