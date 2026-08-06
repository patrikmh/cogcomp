import { useQuery } from "@tanstack/react-query";
import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";

import { Empty, Failed, Loading } from "@/components/States";
import { api } from "@/lib/api";
import { dayLabelOf } from "@/lib/format";
import { useSession } from "@/state/session";

/**
 * Find an entry.
 *
 * A literal substring match over the person's own words, newest first, with the
 * count stated. Deliberately not ranked by relevance: a silent ranking decides
 * for someone what mattered, and this is the one screen whose whole job is to
 * give them back exactly what they wrote.
 */
export function Search() {
  const userId = useSession((s) => s.userId);
  const [term, setTerm] = useState("");
  const entries = useQuery({
    queryKey: ["observations", userId],
    queryFn: () => api.observations(200),
  });

  const needle = term.trim().toLowerCase();
  const hits = needle
    ? (entries.data?.observations ?? []).filter((e) => e.content.toLowerCase().includes(needle))
    : [];

  return (
    <>
      <div className="p-head">
        <div>
          <span className="kicker">Find an entry</span>
          <h1>Your own words</h1>
        </div>
      </div>

      <div className="f-wrap">
        <input
          className="f-field"
          value={term}
          placeholder="A word you remember writing"
          onChange={(e) => setTerm(e.target.value)}
          autoFocus
        />
      </div>

      {entries.isLoading ? (
        <Loading />
      ) : entries.isError ? (
        <Failed />
      ) : !needle ? (
        <Empty label="Type something you remember writing." />
      ) : hits.length === 0 ? (
        <Empty label={`Nothing matches “${term.trim()}”.`} />
      ) : (
        <>
          <div className="sub mono">
            {hits.length} {hits.length === 1 ? "entry" : "entries"} · newest first
          </div>
          {hits.map((hit) => (
            <Link key={hit.id} to={`/node/${hit.id}`} className="card f-res">
              <p>{highlight(hit.content, needle)}</p>
              <span className="mono" style={{ color: "var(--faint)" }}>
                {dayLabelOf(hit.captured_at)}
              </span>
            </Link>
          ))}
        </>
      )}
    </>
  );
}

/** React escapes for us, so the match is marked by splitting rather than by
 *  building HTML — no escaping bug is possible here. */
function highlight(content: string, needle: string) {
  const parts: (string | ReactElement)[] = [];
  let rest = content;
  let key = 0;
  for (;;) {
    const at = rest.toLowerCase().indexOf(needle);
    if (at < 0) break;
    parts.push(rest.slice(0, at));
    parts.push(<mark key={key++}>{rest.slice(at, at + needle.length)}</mark>);
    rest = rest.slice(at + needle.length);
  }
  parts.push(rest);
  return parts;
}
