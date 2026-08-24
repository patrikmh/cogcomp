import { useQuery } from "@tanstack/react-query";
import { useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { DrawnMeta } from "@/components/DrawnMeta";
import { api } from "@/lib/api";
import { patternDestination } from "@/lib/patterns";
import { feltThoughtOf, heldReadingsOf, namedInnerOf, useAmong, useAmongThemes, useDrawnFrom } from "@/lib/drawn-from";
import { usePreferences } from "@/state/preferences";
import { dayLabelOf } from "@/lib/format";
import { Seal } from "@/lib/seal";
import { useSession } from "@/state/session";
import { Guide } from "@/components/Guide";
import { Failed } from "@/components/States";
import { HEADINGS } from "@tlon/copy/headings";
import { SECTIONS, asideOf } from "@tlon/copy/sections";

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
  const [searchParams, setSearchParams] = useSearchParams();
  // A word handed over by another room — a first-time word on Week, say —
  // opens the screen already asking its question, and the address keeps
  // holding that question so the place in the record can be returned to.
  const [term, setTerm] = useState(() => searchParams.get("q") ?? "");
  const changeQuery = (value: string) => {
    setTerm(value);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const q = value.trim();
        if (q) next.set("q", q);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  };
  const entries = useQuery({
    queryKey: ["observations", userId],
    queryFn: () => api.observations(200),
  });
  const findingsVisible = usePreferences((s) => s.findings);
  const drawnFrom = useDrawnFrom(4, findingsVisible);
  const graph = useQuery({
    queryKey: ["graph", "search", userId],
    queryFn: () => api.graph(200),
    enabled: findingsVisible,
  });
  // A found act that sits inside a recurrence should say so here too: search
  // is where a specific moment is revisited, and the pattern it belongs to is
  // exactly the thing its writer could not see from inside one day.
  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: api.patterns,
    enabled: findingsVisible,
  });
  const themes = useQuery({
    queryKey: ["themes", userId],
    queryFn: api.themes,
    enabled: findingsVisible,
  });
  const among = useAmong(patterns.data ?? [], 4, findingsVisible);
  const amongThemes = useAmongThemes(themes.data ?? [], 4, findingsVisible);

  if (entries.isError) return <Failed onRetry={() => void entries.refetch()} />;

  const all = entries.data?.observations ?? [];
  const needle = term.trim().toLowerCase();
  const hits = needle ? all.filter((e) => e.content.toLowerCase().includes(needle)) : [];
  const named = findingsVisible ? namedInnerOf(needle, graph.data?.nodes ?? []) : [];
  const namedFelt = feltThoughtOf(named);
  const namedHolds = heldReadingsOf(named);

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
            onChange={(e) => changeQuery(e.target.value)}
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

        {named.length > 0 && (
          <>
            <div className="t-sec">
              <span className="kicker">{SECTIONS.named.title}</span>
              <span className="rule" />
              <span className="mono">{asideOf("named")}</span>
            </div>
            {namedFelt.length > 0 && (
              <>
                <div className="t-sec">
                  <span className="kicker">{SECTIONS.inside.title}</span>
                  <span className="rule" />
                  <span className="mono">{asideOf("inside")}</span>
                </div>
                {namedFelt.map((reading) => (
                  <Link key={reading.id} className="t-read" to={`/node/${reading.id}`}>
                    <span className="t-main">
                      <b>{reading.label}</b>
                      <span className="mono">{reading.kind.toLowerCase()}</span>
                    </span>
                  </Link>
                ))}
              </>
            )}
            {namedHolds.length > 0 && (
              <>
                <div className="t-sec">
                  <span className="kicker">{SECTIONS.holds.title}</span>
                  <span className="rule" />
                  <span className="mono">{asideOf("holds")}</span>
                </div>
                {namedHolds.map((reading) => (
                  <Link key={reading.id} className="t-read" to={`/node/${reading.id}`}>
                    <span className="t-main">
                      <b>{reading.label}</b>
                      <span className="mono">{reading.kind.toLowerCase()}</span>
                    </span>
                  </Link>
                ))}
              </>
            )}
          </>
        )}

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
                    <DrawnMeta readings={drawnFrom.get(hit.id) ?? []} />
                  )}
                  {findingsVisible && (among.get(hit.id)?.length ?? 0) > 0 && (
                    <div className="j-meta">
                      <span className="j-from">this act is among</span>
                      {among.get(hit.id)!.map((pattern) => (
                        <Link
                          key={pattern.id}
                          className={`j-chip${pattern.tentative ? " ghost" : ""}`}
                          to={patternDestination(pattern).href}
                        >
                          {pattern.label.split(" · ")[0]}
                        </Link>
                      ))}
                    </div>
                  )}
                  {findingsVisible && (amongThemes.get(hit.id)?.length ?? 0) > 0 && (
                    <div className="j-meta">
                      <span className="j-from">this act is in</span>
                      {amongThemes.get(hit.id)!.map((theme) => (
                        <Link
                          key={theme.id}
                          className={`j-chip${theme.tentative ? " ghost" : ""}`}
                          to={`/theme/${theme.id}`}
                        >
                          {theme.label}
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
