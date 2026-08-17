import { useQuery } from "@tanstack/react-query";
import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";

import { api } from "@/lib/api";
import { useDrawnFrom } from "@/lib/drawn-from";
import { usePreferences } from "@/state/preferences";
import { dayLabelOf } from "@/lib/format";
import { Seal } from "@/lib/seal";
import { useSession } from "@/state/session";
import { Guide } from "@/components/Guide";
import { Failed } from "@/components/States";
import { HEADINGS } from "@tlon/copy/headings";

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
  const findingsVisible = usePreferences((s) => s.findings);
  const drawnFrom = useDrawnFrom(4, findingsVisible);

  if (entries.isError) return <Failed onRetry={() => void entries.refetch()} />;

  const all = entries.data?.observations ?? [];
  const needle = term.trim().toLowerCase();
  const hits = needle ? all.filter((e) => e.content.toLowerCase().includes(needle)) : [];

  return (
    <div className="scr">
      <span className="kicker">{HEADINGS.search.kicker}</span>
      <div className="guide-heading">
        <h1>{HEADINGS.search.title}</h1>
        <Guide id="search" />
      </div>
      <p className="sub">
        Literal text, newest first. Readings are not searched — they are not your words.
      </p>

      <div className="f-wrap">
        <div className="f-field">
          <span className="f-glyph" aria-hidden>
            <svg viewBox="0 0 24 24">
              <circle cx="10.5" cy="10.5" r="6" />
              <path d="M15 15l5 5" />
            </svg>
          </span>
          <input
            id="q"
            type="text"
            value={term}
            placeholder="A word you remember writing"
            autoComplete="off"
            onChange={(e) => setTerm(e.target.value)}
            autoFocus
          />
        </div>

        <div className="t-sum" style={{ marginTop: 16 }}>
          {entries.isLoading
            ? "Reading the record…"
            : !needle
              ? `${all.length} ${all.length === 1 ? "act" : "acts"} in the record — type to look back through them.`
              : hits.length
                ? `${hits.length} of ${all.length} ${hits.length === 1 ? "act contains" : "acts contain"} “${term.trim()}”.`
                : `No act contains “${term.trim()}”. Nothing was ranked or guessed.`}
        </div>

        <div className="f-res">
          {hits.map((hit) => (
            <div className="j-entry" key={hit.id}>
              <span className="j-time">{dayLabelOf(hit.captured_at)}</span>
              <span className="j-spine">
                <span className="j-dot" />
              </span>
              <div className="j-act">
                <Seal id={hit.id} />
                <div>
                  <p>{highlight(hit.content, needle)}</p>
                  {findingsVisible && (drawnFrom.get(hit.id) ?? []).length > 0 && (
                    <div className="j-meta">
                      <span className="j-from">drawn from this</span>
                      {(drawnFrom.get(hit.id) ?? []).map((r) => (
                        <Link
                          key={r.id}
                          className={`j-chip${r.tentative ? " ghost" : ""}`}
                          to={`/node/${r.id}`}
                        >
                          {r.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
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
