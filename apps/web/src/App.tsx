import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { Rail, type RailCounts } from "@/components/Rail";
import { api, onSessionLost } from "@/lib/api";
import { deviceTimezone, localDay, mondayOf } from "@/lib/format";
import { Headspace, headspaceCount } from "@/screens/Headspace";
import { Experiments, ExperimentDetail } from "@/screens/Experiments";
import { Identity } from "@/screens/Identity";
import { Journal } from "@/screens/Journal";
import { Login } from "@/screens/Login";
import { Agents, Explore, Graph } from "@/screens/Machinery";
import { Node } from "@/screens/Node";
import { PatternDetail } from "@/screens/PatternDetail";
import { Patterns } from "@/screens/Patterns";
import { Search } from "@/screens/Search";
import { Settings } from "@/screens/Settings";
import { First, Words } from "@/screens/Static";
import { Talk } from "@/screens/Talk";
import { Theme } from "@/screens/Theme";
import { Today } from "@/screens/Today";
import { Week } from "@/screens/Week";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";

export function App() {
  const { token, ready, restore } = useSession();
  const location = useLocation();

  useEffect(() => {
    void restore();
    // A token the server has forgotten must not leave someone inside the app
    // with every screen showing its own unrelated error.
    onSessionLost(() => useSession.setState({ token: null, userId: null }));
  }, [restore]);



  if (!ready) {
    return (
      <div id="app">
        <main id="screen">
          {/* The landing goes full-bleed; everything else sits in the reading
            column. Declared rather than toggled imperatively — React owns this
            className, so a classList call here is undone by the next render,
            and the map silently lost half its width whenever a query landed. */}
        <div className={location.pathname === "/" ? "wrap wide" : "wrap"} id="view">
            <div className="empty mono">…</div>
          </div>
        </main>
      </div>
    );
  }

  if (!token) return <Login />;

  return (
    <div id="app">
      {/* Twelve rail links stand between the top of the document and the page
          you asked for. Hidden until focused, so nothing on screen changes. */}
      <a className="skip" href="#view">
        Skip to the page
      </a>
      <RailWithCounts />
      <main id="screen">
        {/* The landing goes full-bleed; everything else sits in the reading
            column. Declared rather than toggled imperatively — React owns this
            className, so a classList call here is undone by the next render,
            and the map silently lost half its width whenever a query landed. */}
        <div className={location.pathname === "/" ? "wrap wide" : "wrap"} id="view">
          <Routes>
            <Route path="/" element={<Headspace />} />
            <Route path="/journal" element={<Journal />} />
            <Route path="/talk" element={<Talk />} />
            <Route path="/today" element={<Today />} />
            <Route path="/week" element={<Week />} />
            <Route path="/search" element={<Search />} />
            <Route path="/patterns" element={<Patterns />} />
            <Route path="/pattern/:id" element={<PatternDetail />} />
            <Route path="/theme/:id" element={<Theme />} />
            <Route path="/identity" element={<Identity />} />
            <Route path="/node/:id" element={<Node />} />
            <Route path="/experiments" element={<Experiments />} />
            <Route path="/experiment/:id" element={<ExperimentDetail />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/graph" element={<Graph />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/words" element={<Words />} />
            <Route path="/first" element={<First />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

/** The rail's counts are real: what it says beside each destination is what is
 *  actually there. A count that lies is worse than no count. */
function RailWithCounts() {
  const showFindings = usePreferences((s) => s.findings);
  const userId = useSession((s) => s.userId);

  // The same key the Journal uses, so writing an entry updates the count beside
  // it. A separate key would have left the rail quietly one entry behind.
  const entries = useQuery({
    queryKey: ["observations", userId],
    queryFn: () => api.observations(200),
  });
  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: api.patterns,
    enabled: showFindings,
  });
  const experiments = useQuery({ queryKey: ["experiments"], queryFn: api.experiments });
  const runs = useQuery({ queryKey: ["agent-runs"], queryFn: () => api.agentRuns(50) });
  const graph = useQuery({ queryKey: ["graph-summary"], queryFn: api.graphSummary });
  const identity = useQuery({
    queryKey: ["identity", userId],
    queryFn: () => api.identity(true),
    enabled: showFindings,
  });
  const candidates = useQuery({
    queryKey: ["identity", "candidates", userId],
    queryFn: api.identityCandidates,
    enabled: showFindings,
  });
  // The same keys Today, Week and Headspace use, so these are already-fetched
  // data rather than a second round trip — and so the rail can never disagree
  // with the screen it points at.
  const tz = deviceTimezone();
  const today = useQuery({
    queryKey: ["summary", localDay(), tz],
    queryFn: () => api.daily(localDay(), tz),
  });
  const week = useQuery({
    queryKey: ["summary", "week", mondayOf(localDay()), tz],
    queryFn: () => api.weekly(mondayOf(localDay()), tz),
  });
  const graphNodes = useQuery({ queryKey: ["graph"], queryFn: () => api.graph(120) });

  const counts: RailCounts = {
    head:
      today.data && graphNodes.data
        ? String(headspaceCount(patterns.data ?? [], today.data.inferred, graphNodes.data.nodes))
        : "",
    journal: entries.data ? String(entries.data.observations.length) : "",
    today: today.data ? String(today.data.entry_count) : "",
    week: week.data ? `${week.data.active_days} / 7` : "",
    patterns: patterns.data ? String(patterns.data.length) : "",
    // What the screen actually draws: kept and offered alike. Counting only the
    // kept ones said "0" beside a page showing twenty-one rings.
    identity:
      identity.data && candidates.data
        ? String(
            identity.data.nodes.filter((n) => n.status === "selected").length +
              candidates.data.candidates.length,
          )
        : "",
    exps: experiments.data ? String(experiments.data.experiments.length) : "",
    agents: runs.data ? String(runs.data.length) : "",
    graph: graph.data
      ? String(graph.data.counts.reduce((n, c) => n + c.count, 0))
      : "",
  };

  return <Rail counts={counts} />;
}
