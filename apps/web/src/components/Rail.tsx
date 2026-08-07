import { useEffect, type ReactElement } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { usePreferences } from "@/state/preferences";

/**
 * The rail: collapsed to its symbols, unfurling on hover.
 *
 * Monoline icons on a 24 viewBox, the same stroke language as the wordmark.
 * The labels are load-bearing — a column of unlabelled glyphs is a puzzle, and
 * a screen reader finds nothing in it — so they are always in the DOM and the
 * collapse is visual only.
 *
 * Ported from the prototype's `NAV`/`IC` tables, including the single-key
 * shortcuts, which skip while a text field has focus or a modifier is held.
 */
const IC: Record<string, ReactElement> = {
  head: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="4.6" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  journal: (
    <>
      <path d="M5 5.5h14" />
      <path d="M5 10h14" />
      <path d="M5 14.5h9" />
      <path d="M5 19h11" />
    </>
  ),
  talk: <path d="M4 6.5h16v9.5h-9l-4 3.8v-3.8H4z" />,
  today: (
    <>
      <circle cx="12" cy="12" r="6.4" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </>
  ),
  week: (
    <>
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <path d="M7 6.5v5" />
      <path d="M12 6.5v5" />
      <path d="M17 6.5v5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  patterns: <path d="M2.5 12c3.2-6 6.3 6 9.5 0s6.3 6 9.5 0" />,
  identity: (
    <>
      <circle cx="12" cy="13.5" r="6.2" />
      <circle cx="9.4" cy="4.2" r="1.1" fill="currentColor" />
      <circle cx="14.6" cy="4.2" r="1.1" fill="currentColor" />
    </>
  ),
  exps: (
    <>
      <path d="M12 3v7" />
      <path d="M12 10c0 5.5-6 5-6 11" />
      <path d="M12 10c0 5.5 6 5 6 11" />
    </>
  ),
  agents: <path d="M2.5 12h4l2.2-5.5 4.3 11 2.2-5.5h6.3" />,
  graph: (
    <>
      <circle cx="6" cy="6.5" r="2.2" />
      <circle cx="18" cy="9" r="2.2" />
      <circle cx="9.5" cy="18" r="2.2" />
      <path d="M8 7.6l7.8 1" />
      <path d="M7.2 8.5l1.4 7.3" />
      <path d="M16.4 10.8l-5 5.6" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16" />
      <circle cx="9" cy="7" r="1.8" fill="currentColor" />
      <path d="M4 12h16" />
      <circle cx="15" cy="12" r="1.8" fill="currentColor" />
      <path d="M4 17h16" />
      <circle cx="7" cy="17" r="1.8" fill="currentColor" />
    </>
  ),
};

type Item =
  | { grp: string }
  | { id: string; route: string; label: string; key: string; isNew?: boolean };

const NAV: Item[] = [
  { grp: "Capture" },
  { id: "head", route: "/", label: "Headspace", key: "H" },
  { id: "journal", route: "/journal", label: "Journal", key: "J" },
  { id: "talk", route: "/talk", label: "Talk it through", key: "T" },
  { grp: "Looking back" },
  { id: "today", route: "/today", label: "Today", key: "D" },
  { id: "week", route: "/week", label: "This week", key: "W" },
  { id: "search", route: "/search", label: "Find an entry", key: "F", isNew: true },
  { grp: "Findings" },
  { id: "patterns", route: "/patterns", label: "Patterns", key: "P" },
  { id: "identity", route: "/identity", label: "Identity", key: "I" },
  { grp: "Self-authorship" },
  { id: "exps", route: "/experiments", label: "Experiments", key: "X" },
  { grp: "Machinery" },
  { id: "agents", route: "/agents", label: "Agent activity", key: "A" },
  { id: "graph", route: "/graph", label: "Graph", key: "G" },
  { id: "settings", route: "/settings", label: "Settings", key: "S" },
];

/** Counts shown beside each destination, supplied by whoever has the data. */
export type RailCounts = Partial<Record<string, string>>;

export function Rail({ counts = {} }: { counts?: RailCounts }) {
  const location = useLocation();
  const navigate = useNavigate();
  const showFindings = usePreferences((s) => s.findings);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey) return;
      const target = ev.target as HTMLElement | null;
      if (target && /input|textarea/i.test(target.tagName)) return;
      const hit = NAV.find(
        (it) => "key" in it && it.key.toLowerCase() === ev.key.toLowerCase(),
      );
      if (hit && "route" in hit) navigate(hit.route);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <nav id="rail" aria-label="Primary">
      <div className="logo">
        <img className="mark" src="/assets/tlon-mark.png" alt="" />
        <img className="word" src="/assets/tlon-logo.png" alt="Tlön" />
      </div>
      <div id="railitems">
        {NAV.map((item, i) => {
          if ("grp" in item) {
            // With findings switched off the whole group goes, rather than
            // leaving a heading over nothing.
            if (item.grp === "Findings" && !showFindings) return null;
            return (
              <div className="grp" key={`grp-${i}`}>
                <span className="kicker">{item.grp}</span>
              </div>
            );
          }
          if (!showFindings && (item.route === "/patterns" || item.route === "/identity")) {
            return null;
          }
          const active =
            item.route === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(item.route);
          return (
            <Link
              key={item.route}
              to={item.route}
              data-route={item.route}
              title={`${item.label} (${item.key})`}
              aria-current={active ? "page" : undefined}
            >
              <span className="key">
                <svg viewBox="0 0 24 24">{IC[item.id]}</svg>
              </span>
              <span className="lbl">
                {item.label}
                {/* The design marks this one new. It is a claim with a shelf
                    life — take it off when it stops being true. */}
                {"isNew" in item && item.isNew && <span className="new">NEW</span>}
              </span>
              <span className="n">{counts[item.id] ?? ""}</span>
            </Link>
          );
        })}
      </div>
      <div className="foot">
        <span className="kicker">Hover to unfurl · press a key</span>
      </div>
    </nav>
  );
}
