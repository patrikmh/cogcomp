import { useQuery } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
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
import { GuideHost } from "@/components/Guide";

export function App() {
  const { token, ready, restore } = useSession();
  const location = useLocation();

  useEffect(() => {
    void restore();
    // A token the server has forgotten must not leave someone inside the app
    // with every screen showing its own unrelated error.
    onSessionLost((lostToken) => {
      // A stale request from a replaced account must not clear the current one.
      if (useSession.getState().token === lostToken) {
        useSession.setState({ token: null, userId: null });
      }
    });
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

  // What happens to your words is readable before you hand any over. The login
  // screen offers it, as the design does, and it led straight back to the login
  // screen while every route sat behind the session — which is the one moment
  // the page exists for, and the one moment it could not be read.
  if (!token) {
    // The same reading column the rest of the app uses, minus `#app` — its
    // `grid-template-columns:auto 1fr` is there to seat the rail, and with no
    // rail to seat, the lone `#screen` lands in the `auto` track and shrinks to
    // its own content instead of filling the page.
    return (
      <main id="screen">
        <div className="wrap" id="view">
          {location.pathname === "/words" ? (
            <>
              <Words />
              <p className="rest mono" style={{ marginTop: 18 }}>
                <a href="#/login">← back to signing in</a>
              </p>
            </>
          ) : (
            <Login />
          )}
        </div>
      </main>
    );
  }

  return (
    <div id="app">
      {/* Twelve rail links stand between the top of the document and the page
          you asked for. Hidden until focused, so nothing on screen changes. */}
      <a className="skip" href="#view">
        Skip to the page
      </a>
      <RailWithCounts />
      {/* One dialog for the whole app, as the design has it, so the "?" on any
          screen opens the same plate — and so the plate is in the document
          before it is asked to fade in. */}
      <GuideHost>
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
            <Route path="/patterns" element={<FindingsRoute><Patterns /></FindingsRoute>} />
            <Route path="/pattern/:id" element={<FindingsRoute><PatternDetail /></FindingsRoute>} />
            <Route path="/theme/:id" element={<FindingsRoute><Theme /></FindingsRoute>} />
            <Route path="/identity" element={<FindingsRoute><Identity /></FindingsRoute>} />
            <Route path="/node/:id" element={<Node />} />
            <Route path="/experiments" element={<Experiments />} />
            <Route path="/experiment/:id" element={<ExperimentDetail />} />
            <Route path="/agents" element={<FindingsRoute><Agents /></FindingsRoute>} />
            <Route path="/graph" element={<FindingsRoute><Graph /></FindingsRoute>} />
            <Route path="/explore" element={<FindingsRoute><Explore /></FindingsRoute>} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/words" element={<Words />} />
            <Route path="/first" element={<First />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
      </GuideHost>
    </div>
  );
}

/** The rail's counts are real: what it says beside each destination is what is
 *  actually there. A count that lies is worse than no count. */
function FindingsRoute({ children }: { children: ReactNode }) {
  const showFindings = usePreferences((s) => s.findings);
  return showFindings ? <>{children}</> : <Navigate to="/" replace />;
}

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
  const experiments = useQuery({
    queryKey: ["experiments", showFindings],
    queryFn: () => api.experiments(showFindings),
  });
  const runs = useQuery({
    queryKey: ["agent-runs"],
    queryFn: () => api.agentRuns(50),
    enabled: showFindings,
  });
  const graph = useQuery({ queryKey: ["graph-summary"], queryFn: api.graphSummary, enabled: showFindings });
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
    queryKey: ["summary", localDay(), tz, showFindings],
    queryFn: () => api.daily(localDay(), tz, showFindings),
  });
  const week = useQuery({
    queryKey: ["summary", "week", mondayOf(localDay()), tz, showFindings],
    queryFn: () => api.weekly(mondayOf(localDay()), tz, showFindings),
  });
  const graphNodes = useQuery({ queryKey: ["graph", showFindings], queryFn: () => api.graph(120), enabled: showFindings });

  const counts: RailCounts = {
    head:
      showFindings && today.data && graphNodes.data
        ? String(headspaceCount(patterns.data ?? [], today.data.inferred, graphNodes.data.nodes))
        : "",
    journal: entries.data ? String(entries.data.observations.length) : "",
    today: today.data ? String(today.data.entry_count) : "",
    week: week.data ? `${week.data.active_days} / 7` : "",
    patterns: showFindings && patterns.data ? String(patterns.data.length) : "",
    // What the screen actually draws: kept and offered alike. Counting only the
    // kept ones said "0" beside a page showing twenty-one rings.
    identity:
      showFindings && identity.data && candidates.data
        ? String(
            identity.data.nodes.filter((n) => n.status === "selected").length +
              candidates.data.candidates.length,
          )
        : "",
    exps: experiments.data ? String(experiments.data.experiments.length) : "",
    agents: showFindings && runs.data ? String(runs.data.length) : "",
    graph: showFindings && graph.data
      ? String(graph.data.counts.reduce((n, c) => n + c.count, 0))
      : "",
  };

  return <Rail counts={counts} />;
}
