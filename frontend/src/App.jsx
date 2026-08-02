import { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { useSync } from "./hooks/useSync";
import { WorkingMemoryDisplay } from "./components/WorkingMemoryDisplay";
import { SystemStatus } from "./components/SystemStatus";
import SetupWizard from "./components/SetupWizard";
import DailyCheckin from "./components/DailyCheckin";
import { TaskInitiationSupport } from "./components/TaskInitiationSupport";
import { useAgentStream } from "./hooks/useAgentStream";
import { AgentProgress } from "./components/AgentProgress";
import { SettingsView } from "./components/SettingsView";
import { F, T, MODES, ENERGY_LABELS, MOVEMENT_IDEAS, REST_MENU, EDU_CARDS, ICON_CHOICES, WEEKDAYS, ICON_KEYWORDS, PRIORITY_ORDER, API_BASE, AUTH_KEY } from "./constants/tokens";
import { uid, todayKey, todayWeekday, guessIcon, energyColor, nowHM, hmToMin } from "./utils/helpers";
import { getAuth, setAuth, clearAuth, login } from "./utils/auth";
import { useModalDialog } from "./hooks/useModalDialog";
import { useTheme } from "./hooks/useTheme";
import { GhostTextarea } from "./components/GhostTextarea";
import varvLogo from "./assets/varv-logo.png";
import varvLogoDark from "./assets/varv-logo-dark.png";
import { IconTrash, IconCalendar, IconSparkle, IconMic, IconStop, IconIdea, IconImage, IconLoop, IconAgent, IconCheck, IconClose, IconPencil, IconUndo, IconDot } from "./components/icons.jsx";
import { TaskIcon, AvatarIcon, avatarIconKey } from "./components/TaskIcon.jsx";
// Cytoscape.js is ~230kb gzipped — split it into its own chunk so opening the
// app (or the Ideas list view) never pays for it; only "karta" mode does.
const IdeaGraph = lazy(() => import("./components/IdeaGraph").then((m) => ({ default: m.IdeaGraph })));

/* ============================================================
   VARV — an AuDHD day companion
   Färger och typografi bor i styles/theme.css och nås via T/F/FS från
   constants/tokens.js. Skriv aldrig en hex-kod här — den överlever inte
   mörkt läge.
   Type: Fraunces (display) · Atkinson Hyperlegible (body) · IBM Plex Mono (data)
   Signature: the energy dial — a chronograph-style subdial that
   shows today's remaining capacity as an arc with tick marks.
   ============================================================ */

// triggerSuggestion is used by TaskInitiationSupport component
const triggerSuggestion = (taskTitle) => {
  const lowerTitle = taskTitle.toLowerCase();
  if (lowerTitle.includes('kaffe') || lowerTitle.includes('frukost')) return 'jag har ätit';
  if (lowerTitle.includes('jobb') || lowerTitle.includes('arbet')) return 'jag sitter vid skrivbordet';
  if (lowerTitle.includes('motion') || lowerTitle.includes('träning')) return 'jag har träningskläder på mig';
  if (lowerTitle.includes('läsa') || lowerTitle.includes('bok')) return 'jag har boken framför mig';
  return 'jag är redo att börja';
};

async function apiPost(path, body) {
  const auth = getAuth();
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`varv-server ${path} → ${response.status}`);
  return response.json();
}

async function apiPatch(path, body) {
  const auth = getAuth();
  const response = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`varv-server ${path} error ${response.status}`);
  return response.json();
}

async function apiGet(path) {
  const auth = getAuth();
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}) },
  });
  if (!response.ok) throw new Error(`varv-server ${path} error ${response.status}`);
  return response.json();
}

async function apiDelete(path) {
  const auth = getAuth();
  const response = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: { ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}) },
  });
  if (!response.ok) throw new Error(`varv-server ${path} error ${response.status}`);
  return response.json();
}

// OAuth-redirecten till Google kan inte bära en Authorization-header, så token
// åker med som query-param — se varv/api/google_routes.py :connect.
function googleConnectUrl() {
  const auth = getAuth();
  return `${API_BASE}/api/integrations/google/connect?token=${encodeURIComponent(auth?.token || "")}`;
}

// Agenterna (Nedbrytaren/Förfinaren/Sorteraren) körs server-side mot
// OpenRouter — frontend anropar bara varv-server, aldrig LLM-API:et direkt.
// Legacy non-streaming fallbacks (kept for sync/sweep flows):
async function aiBreakdown(title, instructions) {
  const data = await apiPost("/api/agents/breakdown", { title, instructions: instructions || null });
  return data.steps.map((st) => ({ id: uid(), title: st.title, minutes: st.minutes, done: false }));
}

async function aiRefineIdea(raw) {
  return apiPost("/api/agents/refine", { raw });
}

async function aiClassify(raw) {
  return apiPost("/api/agents/classify", { raw });
}

async function fetchOura(token) {
  const today = todayKey();
  const opts = { headers: { Authorization: `Bearer ${token}` } };
  const [sleepRes, readyRes] = await Promise.all([
    fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${today}&end_date=${today}`, opts),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${today}&end_date=${today}`, opts),
  ]);
  if (!sleepRes.ok || !readyRes.ok) throw new Error("oura http");
  const sleep = await sleepRes.json();
  const ready = await readyRes.json();
  return {
    sleepScore: sleep.data?.[0]?.score ?? null,
    readiness: ready.data?.[0]?.score ?? null,
  };
}



const DEFAULT_STATE = {
  capacity: "steady",
  tasks: [],
  wins: [],
  checkins: [],
  energyLog: [], // {delta, label, day}
  meds: [], // {day, status: 'taken'|'skipped'|'off'}
  morningLapDay: null,
  calibration: [], // {est, actual, ts} minutes
  settings: { wake: "07:00", winddown: "22:00", ouraToken: "", autoSync: true, voiceLang: "sv-SE" },
  lists: [{ id: "shopping", name: "Inköp", slug: "shopping", items: [] }],
  ideas: [], // {id, raw, title, note, tags, ts, status: 'refining'|'klar'|'fail'}
  tagLog: [], // {day, tag} — för statistik och organisering
  agents: { classify: true, refine: true, sync: true, breakdown: true, observer: true },
  observerDismissed: { day: null, keys: [] }, // vilka förslag som avfärdats idag
  agentLog: [], // {ts, agent, text} — senaste agentaktivitet
  breakdownBudget: { day: null, n: 0 }, // max 3 auto-nedbrytningar per dag
  gcal: { day: null, events: [] }, // {title, start "HH:MM", end "HH:MM"}
  mailSug: { day: null, items: [], dismissed: [] }, // dismissed: "from|subject"-nycklar för dagen
  oura: { day: null, sleepScore: null, readiness: null, manual: null },
  sync: { day: null, last: null, cal: null, mail: null, oura: null, notion: null, syncing: false, err: null }, // last = epoch ms
  capacityBy: { day: null, by: null }, // 'auto' | 'user'
  notionArchivedDay: null,
  day: todayKey(),
};

function VarvApp({ username, onLogout }) {
  const storageKey = `varv-state:${username}`;
  const [state, setState] = useState(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);
  useTheme(state.settings?.theme);
  const [tool, setTool] = useState(null); // 'focus' | 'move' | 'checkin' | 'wins' | 'sleep'
  const [showAdd, setShowAdd] = useState(false);
  const [lapRunning, setLapRunning] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null); // For task initiation support
  const [view, setView] = useState("today"); // 'today' | 'lists' | 'tools'
  const [captureOpen, setCaptureOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const [unstick, setUnstick] = useState(false);
  const [ideaMode, setIdeaMode] = useState("list"); // 'list' | 'map'
  const [unstickBusy, setUnstickBusy] = useState(false);
  const [focusPrefill, setFocusPrefill] = useState(null);
  const [, setTick] = useState(0); // minute tick so time-based UI stays current
  const saveTimer = useRef(null);
  const [googleConnected, setGoogleConnected] = useState(null); // null = okänt än, annars bool
  const [googleBusy, setGoogleBusy] = useState(false);
  const [accountMenu, setAccountMenu] = useState(false); // inställningar/agenter/kopplingar bor här, inte i verktygslådan
  const [showAllTools, setShowAllTools] = useState(false);
  const [settingsSaveStatus, setSettingsSaveStatus] = useState("idle");
  const accountButtonRef = useRef(null);
  const captureButtonRef = useRef(null);
  const settingsStatusTimer = useRef(null);

  const closeCapture = () => {
    setCaptureOpen(false);
    requestAnimationFrame(() => captureButtonRef.current?.focus());
  };

  const refreshGoogleStatus = () => {
    apiGet("/api/integrations/google/status")
      .then((r) => setGoogleConnected(!!r.connected))
      .catch(() => setGoogleConnected(false));
  };

  const disconnectGoogle = async () => {
    setGoogleBusy(true);
    try {
      await apiDelete("/api/integrations/google");
      setGoogleConnected(false);
    } catch {
      setToast("Kunde inte koppla från Google");
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 2600);
    } finally {
      setGoogleBusy(false);
    }
  };

  // Landar man här efter en Google-koppling (se google_routes.py :callback) städas
  // frågeparametern bort direkt så en omladdning inte visar samma resultat igen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("google");
    if (result) {
      window.history.replaceState({}, "", window.location.pathname);
      const text = result === "connected" ? "Google kopplat ✓" : "Google-kopplingen misslyckades — försök igen";
      setToast(text);
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 2600);
    }
    refreshGoogleStatus();
  }, []);

  // Sync integration
  const sync = useSync(
    API_BASE,
    getAuth,
    username,
    state,
    setState
  );

  // Streaming agent for main app flows (classify, refine, breakdown)
  const streamAgent = useAgentStream();

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  /* ---------- load / save (localStorage — vanlig webbläsare, ingen sandlåda) ---------- */
  useEffect(() => {
    (async () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const s = JSON.parse(raw);
          // Alltid: rensa korrupta uppgifter + migrera saknade day-fält
          s.tasks = (s.tasks || [])
            .filter((t) => t.title && t.id) // drop corrupted tasks (stale-closure bug created titleless entries)
            .map((t) =>
              (!t.day && !t.scheduled_date && !(t.repeatDays || []).length)
                ? { ...t, day: t.createdAt ? todayKey(new Date(t.createdAt)) : todayKey() }
                : t
            );
          if (s.day !== todayKey()) {
            s.day = todayKey();
            const cutoff = todayKey(new Date(Date.now() - 14 * 86400000));
            const medCutoff = todayKey(new Date(Date.now() - 30 * 86400000));
            s.energyLog = (s.energyLog || []).filter((e) => e.day >= cutoff);
            s.meds = (s.meds || []).filter((m) => m.day >= medCutoff);
            s.tagLog = (s.tagLog || []).filter((t) => t.day >= medCutoff);
            // Återkommande uppgifter tas aldrig bort. Completion är per-dag via
            // task.occurrences (se completeTask) — templatet självt håller aldrig done,
            // så det enda som behöver återställas här är stegens ibockning inför nästa
            // varvs instans (stegens titlar/minuter är oförändrade, bara kryssen nollas).
            s.tasks = s.tasks
              .map((t) => (t.repeatDays || []).length && (t.steps || []).some((st) => st.done)
                ? { ...t, steps: t.steps.map((st) => ({ ...st, done: false })) }
                : t)
              .filter((t) => (t.repeatDays || []).length > 0 || !t.done);
          }
          s.settings = { ...DEFAULT_STATE.settings, ...(s.settings || {}) };
          s.lists = (s.lists || DEFAULT_STATE.lists).map((list) =>
            list.id === "shopping" && !list.slug ? { ...list, slug: "shopping" } : list
          );
          const oldIdeas = s.lists.find((l) => l.id === "ideas");
          if (oldIdeas) {
            s.ideas = [
              ...(oldIdeas.items || []).map((it) => ({ id: it.id, raw: it.text, title: null, note: null, tags: [], ts: Date.now(), status: "raw" })),
              ...(s.ideas || []),
            ];
            s.lists = s.lists.filter((l) => l.id !== "ideas");
          }
          setState({ ...DEFAULT_STATE, ...s });
          if (s.activeFocus) setLapRunning(true); // ett pågående varv ska överleva en omladdning
        }
      } catch (e) {
        /* first run — nothing stored yet */
      }
      setLoaded(true);
      // Sync setupDone / lastCheckinDate from server (survives device switch)
      try {
        const me = await apiGet("/api/me");
        setState((s) => ({
          ...s,
          setupDone: me.setup_done || s.setupDone,
          lastCheckinDate: me.last_checkin_date || s.lastCheckinDate,
          externalAiEnabled: !!me.external_ai_enabled,
          // Server wins when it has settings at all — same "db always takes
          // precedence" rule as everything else. A brand-new account (me.settings
          // still null) instead seeds the server from whatever's local so far.
          // agents rides along inside the same blob (see the push effect below).
          settings: me.settings ? { ...s.settings, ...me.settings, agents: undefined } : s.settings,
          agents: me.settings?.agents ? { ...s.agents, ...me.settings.agents } : s.agents,
        }));
      } catch (_) { /* offline or first run */ }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        const { _selIdea, ...persist } = state; // transienta UI-nycklar sparas inte
        localStorage.setItem(storageKey, JSON.stringify(persist));
      } catch (e) {
        console.error("Could not save", e);
      }
    }, 400);
  }, [state, loaded]);

  // Settings (display name, avatar, wake time, ...) and agent toggles had no
  // server home at all before — 100% localStorage, which is exactly why
  // phone/laptop could show different settings indefinitely. Push on every
  // change, debounced so typing in e.g. the display name field doesn't fire
  // one request per keystroke. agents rides along in the same blob rather
  // than adding a second server round-trip and a second DB column for it.
  const settingsSyncTimer = useRef(null);
  useEffect(() => {
    if (!loaded) return;
    clearTimeout(settingsSyncTimer.current);
    clearTimeout(settingsStatusTimer.current);
    setSettingsSaveStatus("saving");
    settingsSyncTimer.current = setTimeout(() => {
      apiPatch("/api/me", { settings: { ...state.settings, agents: state.agents } })
        .then(() => {
          setSettingsSaveStatus("saved");
          settingsStatusTimer.current = setTimeout(() => setSettingsSaveStatus("idle"), 2200);
        })
        .catch(() => {
          setSettingsSaveStatus("error");
          setState((s) => ({ ...s, sync: { ...s.sync, err: "Inställningar kunde inte sparas" } }));
        });
    }, 800);
    return () => clearTimeout(settingsSyncTimer.current);
  }, [state.settings, state.agents, loaded]);

  /* ---------- derived ---------- */
  const mode = MODES[state.capacity];
  const todayLog = state.energyLog.filter((e) => e.day === todayKey());
  const spent = todayLog.filter((e) => e.delta > 0).reduce((a, e) => a + e.delta, 0);
  const recharged = todayLog.filter((e) => e.delta < 0).reduce((a, e) => a - e.delta, 0);
  const remaining = Math.max(0, Math.min(mode.budget, mode.budget - spent + recharged));
  const overBudget = spent - recharged > mode.budget;
  const winsToday = state.wins.filter((w) => todayKey(new Date(w.ts)) === todayKey());
  const vt = state.settings.visibleTools || {}; // vilka verktyg som visas i verktygsvyn

  // Selected date for viewing tasks (default: today)
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const winsForSelectedDate = state.wins.filter((w) => todayKey(new Date(w.ts)) === selectedDate);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = current week window, ±N shifts strip by 7 days
  const isToday = selectedDate === todayKey();

  const visibleTasks = useMemo(() => {
    // Veckodagen för den VISADE dagen, inte alltid faktiskt idag — annars dyker
    // återkommande uppgifter aldrig upp när man bläddrar till en framtida dag.
    const selectedWeekday = todayWeekday(new Date(selectedDate + "T12:00:00"));
    let open = state.tasks.filter((t) => {
      const hasRepeat = (t.repeatDays || []).length > 0;
      // Floater: inget fast datum, bara en deadline (dueBy) — syns varje dag från
      // idag och framåt tills den bockas av, inklusive efter deadline (försenad
      // räknas som mer akut, inte som "försvinn tyst").
      const isFloater = !hasRepeat && !t.scheduled_date && t.dueBy;
      if (hasRepeat) {
        if (!t.repeatDays.includes(selectedWeekday)) return false;
        if (t.occurrences?.[selectedDate]?.done) return false; // klar för just den här dagen
      } else if (isFloater) {
        if (t.done) return false;
        if (selectedDate < todayKey()) return false;
      } else {
        if (t.done) return false;
        const taskDay = t.scheduled_date || t.day;
        if (taskDay !== selectedDate) return false;
      }
      return true;
    });
    if (state.capacity === "recovery" && isToday) open = open.filter((t) => t.essential);
    return [...open].sort((a, b) => {
      const pa = a.priority ? PRIORITY_ORDER[a.priority] : 3;
      const pb = b.priority ? PRIORITY_ORDER[b.priority] : 3;
      return pa - pb;
    });
  }, [state.tasks, state.capacity, selectedDate, isToday]);

  // Klara uppgifter för den VISADE dagen — engångsuppgifter (klar-tidsstämpel) och
  // återkommande instanser (occurrences[selectedDate]) tillsammans, båda återöppningsbara.
  const doneForSelectedDate = useMemo(() => {
    const entries = [];
    for (const t of state.tasks) {
      const hasRepeat = (t.repeatDays || []).length > 0;
      if (hasRepeat) {
        const occ = t.occurrences?.[selectedDate];
        if (occ?.done) entries.push({ task: t, date: selectedDate, occurrence: occ, doneAt: occ.doneAt, steps: occ.stepsSnapshot || [] });
      } else if (t.done && t.doneAt && todayKey(new Date(t.doneAt)) === selectedDate) {
        entries.push({ task: t, date: selectedDate, occurrence: null, doneAt: t.doneAt, steps: t.steps || [] });
      }
    }
    return entries.sort((a, b) => (b.doneAt ? new Date(b.doneAt).getTime() : 0) - (a.doneAt ? new Date(a.doneAt).getTime() : 0));
  }, [state.tasks, selectedDate]);

  const medToday = state.meds.find((m) => m.day === todayKey());
  const pastWinddown = hmToMin(nowHM()) >= hmToMin(state.settings?.winddown || "22:00");

  // Observatören: föreslår ett verktyg utifrån läge/tid, aldrig påtvingat — bara en
  // avfärdbar banner i huvudvyn. Prioritetsordning, första träff vinner. Avfärdat
  // förslag döljs resten av dagen (observerDismissed), inte permanent.
  const dismissedToday = (key) =>
    state.observerDismissed.day === todayKey() && (state.observerDismissed.keys || []).includes(key);

  const checkedInToday = state.checkins.some((c) => todayKey(new Date(c.ts)) === todayKey());

  // Alla träffar just nu, oavsett om bannern avfärdats. Verktygslådan använder
  // listan för att veta vad som är relevant; bannern tar första oavfärdade.
  const observerCandidates = useMemo(() => {
    if (!state.agents.observer) return [];
    // Local heuristics only, gated to major milestones — not fine-grained enough
    // to fire on every click (toggling a step, editing text) or it'd just nag.
    const allDoneToday = isToday && visibleTasks.length === 0 && doneForSelectedDate.length > 0;
    const halfwaySpentNoRecharge = !overBudget && mode.budget > 0 && spent >= mode.budget / 2 && recharged === 0;
    return [
      pastWinddown && { key: "winddown", tool: "sleep", why: "nedvarvningstid", text: "Nedvarvningstid — dags att förbereda sömnen?", cta: "Öppna sömnankaret" },
      state.capacity === "recovery" && { key: "recovery-ground", tool: "ground", why: "återhämtningsläge", text: "Återhämtningsläge — en kort andningspaus?", cta: "Öppna andningsankaret" },
      overBudget && { key: "overbudget-move", tool: "move", why: "energin är över budget", text: "Energin är över budget — en rörelsepaus kan hjälpa.", cta: "Öppna rörelsepausen" },
      (!checkedInToday && hmToMin(nowHM()) >= hmToMin("14:00")) && { key: "checkin-1400", tool: "checkin", why: "ingen tankekoll idag än", text: "Ingen tankekoll idag än — hur går dagen?", cta: "Öppna tankekoll" },
      allDoneToday && { key: `all-done-${todayKey()}`, tool: "wins", why: "allt klart för idag", text: "Allt klart för idag — värt att se vad som blev gjort?", cta: "Öppna vinster" },
      halfwaySpentNoRecharge && { key: `halfway-${todayKey()}`, tool: "move", why: "halva budgeten förbrukad", text: "Halva energibudgeten förbrukad utan återhämtning än — en kort paus nu kan skydda resten av dagen.", cta: "Öppna rörelsepausen" },
    ].filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.agents.observer, pastWinddown, state.capacity, overBudget, checkedInToday, isToday, visibleTasks.length, doneForSelectedDate.length, spent, recharged, mode.budget]);

  const observerSuggestion = observerCandidates.find((c) => !dismissedToday(c.key)) || null;

  const dismissObserverSuggestion = (key) =>
    setState((st) => ({
      ...st,
      observerDismissed: {
        day: todayKey(),
        keys: [...(st.observerDismissed.day === todayKey() ? st.observerDismissed.keys : []), key],
      },
    }));

  const scheduled = useMemo(() => {
    const nowM = hmToMin(nowHM());
    const taskItems = visibleTasks
      .filter((t) => t.time)
      .map((t) => ({ ...t, m: hmToMin(t.time) }));
    const eventItems =
      state.gcal.day === todayKey()
        ? state.gcal.events.map((ev, i) => ({
            id: `ev-${i}`,
            title: ev.title,
            time: ev.start,
            m: hmToMin(ev.start),
            minutes: Math.max(15, (hmToMin(ev.end) || hmToMin(ev.start) + 30) - hmToMin(ev.start)),
            icon: "calendar",
            isEvent: true,
          }))
        : [];
    return [...taskItems, ...eventItems]
      .filter((t) => t.m != null && t.m >= nowM - 30 && t.m <= nowM + 8 * 60)
      .sort((a, b) => a.m - b.m);
  }, [visibleTasks, state.gcal]);

  const unscheduled = visibleTasks.filter((t) => !t.time);
  const nextTask = scheduled.find((t) => !t.isEvent) || unscheduled[0] || null;
  const upcoming = useMemo(() => {
    const nowM = hmToMin(nowHM());
    const u = scheduled.find((t) => t.m > nowM && t.m - nowM <= 20);
    return u ? { ...u, inMin: u.m - nowM } : null;
  }, [scheduled]);

  /* ---------- actions ---------- */
  const patch = (p) => setState((s) => ({ ...s, ...p }));

  const addWin = (text, { notify = true } = {}) => {
    const id = uid();
    const win = { id, text, ts: Date.now(), day: todayKey() };
    setState((s) => ({ ...s, wins: [win, ...s.wins].slice(0, 200) }));
    sync.trackChange('win', id, 'upsert', win);
    if (notify) {
      setToast(text);
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 2600);
    }
    return id;
  };

  const logEnergy = (delta, label) => {
    const id = uid();
    const energyEvent = { id, delta, label, day: todayKey(), ts: Date.now() };
    setState((s) => ({ ...s, energyLog: [...s.energyLog, energyEvent] }));
    sync.trackChange('energy_event', id, 'upsert', energyEvent);
    return id;
  };

  // Shopping lists — a single onChange(newLists) callback used to feed this
  // straight into setState with no sync.trackChange anywhere, so nothing typed
  // into a list ever reached the server. Granular handlers here instead,
  // matching the pattern used for tasks/ideas elsewhere in this file.
  const addShoppingList = (name) => {
    const list = { id: uid(), name, slug: null, items: [] };
    setState((st) => ({ ...st, lists: [...st.lists, list] }));
    sync.trackChange('shopping_list', list.id, 'upsert', list);
  };

  const removeShoppingList = (id) => {
    setState((st) => ({ ...st, lists: st.lists.filter((l) => l.id !== id) }));
    sync.trackChange('shopping_list', id, 'delete', {});
  };

  const addListItem = (listId, text) => {
    const item = { id: uid(), text, done: false };
    setState((st) => ({
      ...st,
      lists: st.lists.map((l) => (l.id === listId ? { ...l, items: [...l.items, item] } : l)),
    }));
    sync.trackChange('list_item', item.id, 'upsert', { listId, text: item.text, done: item.done });
  };

  const toggleListItem = (listId, itemId) => {
    const list = stateRef.current.lists.find((l) => l.id === listId);
    const item = list?.items.find((i) => i.id === itemId);
    if (!item) return;
    const updated = { ...item, done: !item.done };
    setState((st) => ({
      ...st,
      lists: st.lists.map((l) => (l.id === listId ? { ...l, items: l.items.map((i) => (i.id === itemId ? updated : i)) } : l)),
    }));
    sync.trackChange('list_item', itemId, 'upsert', { listId, text: updated.text, done: updated.done });
  };

  const resetListDone = (listId) => {
    const list = stateRef.current.lists.find((l) => l.id === listId);
    if (!list) return;
    const resetItems = list.items.map((i) => ({ ...i, done: false }));
    setState((st) => ({ ...st, lists: st.lists.map((l) => (l.id === listId ? { ...l, items: resetItems } : l)) }));
    for (const item of resetItems) sync.trackChange('list_item', item.id, 'upsert', { listId, text: item.text, done: false });
  };

  const clearDoneListItems = (listId) => {
    const list = stateRef.current.lists.find((l) => l.id === listId);
    if (!list) return;
    const doneItems = list.items.filter((i) => i.done);
    setState((st) => ({ ...st, lists: st.lists.map((l) => (l.id === listId ? { ...l, items: l.items.filter((i) => !i.done) } : l)) }));
    for (const item of doneItems) sync.trackChange('list_item', item.id, 'delete', {});
  };

  const [undoTask, setUndoTask] = useState(null);
  const undoTimer = useRef(null);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, items }
  const [showSetup, setShowSetup] = useState(() => !state.setupDone);
  const [showSettings, setShowSettings] = useState(false);
  const [showCheckin, setShowCheckin] = useState(() => {
    if (!state.setupDone) return false;
    return state.lastCheckinDate !== todayKey();
  });
  const blockingOverlayOpen = showSetup || showSettings || showCheckin || captureOpen;

  // Update overlay flags when server data arrives (async load)
  useEffect(() => {
    if (!loaded) return;
    if (state.setupDone) setShowSetup(false);
    if (state.setupDone && state.lastCheckinDate !== todayKey()) setShowCheckin(true);
  }, [state.setupDone, state.lastCheckinDate, loaded]);

  // Återkommande uppgifter completar en enskild dags occurrence, aldrig templatet
  // självt — så en editering av stegen efteråt aldrig skriver om en redan klar dag.
  // Engångsuppgifter completar direkt på raden, som förut.
  const completeTask = (task, date = selectedDate) => {
    const isRecurring = (task.repeatDays || []).length > 0;
    if (isRecurring) {
      if (task.occurrences?.[date]?.done) return;
      const occId = task.occurrences?.[date]?.id || uid();
      const stepsSnapshot = (task.steps || []).map(({ id, title, minutes, done }) => ({ id, title, minutes, done }));
      const doneAt = Date.now();
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) => t.id === task.id
          ? { ...t, occurrences: { ...(t.occurrences || {}), [date]: { id: occId, done: true, doneAt, stepsSnapshot } } }
          : t),
      }));
      sync.trackChange('task_occurrence', occId, 'upsert', { taskId: task.id, date, done: true, doneAt, stepsSnapshot });
      logEnergy(task.energy, task.title);
      addWin(`Klart: ${task.title}`, { notify: false });
      setUndoTask({ ...task, _occurrenceDate: date, _occurrenceId: occId });
    } else {
      if (task.done) return;
      const doneAt = Date.now();
      // Uppgifter utan schemalagd tid får sin faktiska klockslag ibockat automatiskt
      // — inget att fylla i manuellt, men mönster ("det här görs alltid på kvällen")
      // syns ändå i historiken.
      const autoTime = task.time ? {} : { time: nowHM(new Date(doneAt)) };
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) => (t.id === task.id ? { ...t, done: true, doneAt, ...autoTime } : t)),
      }));
      sync.trackChange('task', task.id, 'upsert', { ...task, done: true, doneAt, ...autoTime });
      logEnergy(task.energy, task.title);
      addWin(`Klart: ${task.title}`, { notify: false });
      setUndoTask({ ...task, _autoTimeAdded: !task.time });
    }
    // Completion uses the single undo confirmation below, never a second toast.
    setToast(null);
    clearTimeout(toastTimer.current);
    // Show undo option for 8 seconds
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoTask(null), 8000);
  };

  const undoCompleteTask = (task) => {
    const date = task._occurrenceDate;
    const occurrenceId = task._occurrenceId;
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((current) => {
        if (current.id !== task.id) return current;
        if (date) {
          const { [date]: _removed, ...rest } = current.occurrences || {};
          return { ...current, occurrences: rest };
        }
        return { ...current, done: false, doneAt: null, ...(task._autoTimeAdded ? { time: null } : {}) };
      }),
    }));
    if (date && occurrenceId) sync.trackChange('task_occurrence', occurrenceId, 'delete', {});
    if (!date) {
      const { _autoTimeAdded, ...originalTask } = task;
      sync.trackChange('task', task.id, 'upsert', { ...originalTask, done: false, doneAt: null, ...(task._autoTimeAdded ? { time: null } : {}) });
    }
    setUndoTask(null);
    clearTimeout(undoTimer.current);
  };

  // Reachable "reopen" for anything already marked done — recurring occurrence or
  // one-off task — so completed work is never a dead end that can't be corrected.
  const reopenTask = (entry) => {
    if (entry.occurrence) {
      const { task, date, occurrence } = entry;
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) => t.id === task.id
          ? { ...t, occurrences: { ...(t.occurrences || {}), [date]: { ...occurrence, done: false } } }
          : t),
      }));
      sync.trackChange('task_occurrence', occurrence.id, 'upsert', {
        taskId: task.id, date, done: false, doneAt: null, stepsSnapshot: occurrence.stepsSnapshot || [],
      });
    } else {
      updateTask(entry.task.id, { done: false, doneAt: null });
    }
  };

  /* --- Setup wizard completion --- */
  const handleSetupComplete = ({ settings, capacity, tasks: newTasks }) => {
    setState((s) => ({
      ...s,
      setupDone: true,
      lastCheckinDate: todayKey(),
      settings: { ...s.settings, ...settings },
      capacity,
      tasks: [...s.tasks, ...newTasks],
    }));
    for (const task of newTasks) sync.trackChange('task', task.id, 'upsert', task);
    // Setup already asked for today's energy. Mark today as checked in so the
    // user lands in the product instead of immediately answering it again.
    setShowSetup(false);
    setShowCheckin(false);
    // Persist to server
    apiPatch("/api/me", { setup_done: true, capacity, last_checkin_date: todayKey() }).catch(() => {});
  };

  const handleToggleExternalAi = () => {
    const next = !state.externalAiEnabled;
    setState((s) => ({ ...s, externalAiEnabled: next }));
    apiPatch("/api/me", { external_ai_enabled: next }).catch(() => {
      setState((s) => ({ ...s, externalAiEnabled: !next })); // rollback vid nätverksfel
    });
  };

  /* --- Daily check-in --- */
  const handleCheckinEnergy = (cap) => {
    setState((s) => ({ ...s, capacity: cap, capacityBy: { day: todayKey(), by: "user" } }));
  };
  const handleCheckinDismiss = () => {
    setState((s) => ({ ...s, lastCheckinDate: todayKey() }));
    setShowCheckin(false);
    // Persist to server
    apiPatch("/api/me", { last_checkin_date: todayKey(), capacity: state.capacity }).catch(() => {});
  };

  const updateTask = (id, p) => {
    const task = stateRef.current.tasks.find(t => t.id === id);
    if (!task) return;
    const updatedTask = { ...task, ...p, updatedAt: new Date().toISOString() };
    setState((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === id ? updatedTask : t)) }));
    sync.trackChange('task', id, 'upsert', updatedTask);
  };

  const removeTask = (id) => {
    const task = stateRef.current.tasks.find(t => t.id === id);
    if (!task) return;
    const deletedTask = { ...task, deletedAt: new Date().toISOString() };
    setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
    sync.trackChange('task', id, 'delete', deletedTask);
  };

  // Nedbrytaren körs direkt när en uppgift skapas — inte bara i bakgrundssvepet — så
  // det första steget redan finns när man möter uppgiften. Tyst vid fel: man kan
  // fortfarande be om det manuellt via "Jag kommer inte igång".
  const breakdownTask = async (taskId, title) => {
    try {
      // Check cache first for recurring tasks
      const cached = stateRef.current.stepCache?.[title];
      if (cached && cached.length > 0) {
        updateTask(taskId, { steps: cached });
        return;
      }
      const result = await streamAgent.run("breakdown", title);
      if (!result?.steps) throw new Error("Nedbrytning misslyckades");
      const steps = result.steps.map((st) => ({ id: uid(), title: st.title, minutes: st.minutes, done: false }));
      updateTask(taskId, { steps });
      // Cache for future recurring instances
      setState((st) => ({
        ...st,
        stepCache: { ...(st.stepCache || {}), [title]: steps },
      }));
    } catch (e) { /* tyst — nedbrytning kan alltid begäras manuellt senare */ }
  };

  const DEFAULT_TASK = {
    icon: "pin", trigger: "", energy: 2, time: "", essential: false, steps: [],
    done: false, doneAt: null, minutes: 30, priority: null, inbox: true, tags: [], repeatDays: [],
  };

  const addTask = (draft) => {
    const task = { ...DEFAULT_TASK, id: uid(), icon: guessIcon(draft.title), day: todayKey(), ...draft, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setState((st) => ({ ...st, tasks: [...st.tasks, task] }));
    sync.trackChange('task', task.id, 'upsert', task);
    breakdownTask(task.id, task.title);
    return task;
  };

  // Task selection for initiation support
  const selectTask = (task) => {
    setSelectedTask(prev => prev?.id === task.id ? null : task);
  };

  const deselectTask = () => {
    setSelectedTask(null);
  };

  const startTaskStep = (task, step = null) => {
    const goal = step?.title || task.title;
    const mins = step?.minutes || task.minutes || state.settings.defaultFocusMinutes;
    setFocusPrefill({ taskId: task.id, taskTitle: task.title, goal, mins });
    setView("tools");
    setTool("focus");
    deselectTask();
  };

  const setTaskTrigger = (task) => {
    const trigger = prompt("När vill du göra detta?", `när ${triggerSuggestion(task.title)}`);
    if (trigger) {
      updateTask(task.id, { trigger });
    }
  };

  /* ---------- Oura + kapacitetsautomatik ---------- */
  const applyCapacityFromScore = (score) => {
    setState((st) => {
      if (st.capacityBy.day === todayKey() && st.capacityBy.by === "user") return st; // användarens val vinner alltid
      if (score < 70 && st.capacity === "steady") {
        setToast(`Kort sömn inatt. Sänkte till Lågt batteri — tryck för att ändra.`);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 4000);
        return { ...st, capacity: "low", capacityBy: { day: todayKey(), by: "auto" } };
      }
      return st;
    });
  };

  const syncOura = async () => {
    const token = state.settings.ouraToken;
    if (!token) return "skip";
    try {
      const o = await fetchOura(token);
      setState((st) => ({ ...st, oura: { day: todayKey(), ...o, manual: null } }));
      const score = Math.min(o.sleepScore ?? 100, o.readiness ?? 100);
      if (o.sleepScore != null || o.readiness != null) applyCapacityFromScore(score);
      return "ok";
    } catch (e) {
      return "fail";
    }
  };

  const setManualSleep = (bucket) => {
    // fallback när Oura inte nås: '<6' | '6-7' | '>7'
    setState((st) => ({ ...st, oura: { day: todayKey(), sleepScore: null, readiness: null, manual: bucket } }));
    if (bucket === "<6") applyCapacityFromScore(60);
  };


  /* ---------- agentlogg ---------- */
  const logAgent = (agent, text) =>
    setState((st) => ({ ...st, agentLog: [{ ts: Date.now(), agent, text }, ...st.agentLog].slice(0, 30) }));

  /* ---------- idéer: spara direkt, förfina i bakgrunden ---------- */
  const refineIdea = async (id, raw, ideaOverride = null) => {
    const updatingIdea = ideaOverride || stateRef.current.ideas.find(i => i.id === id);
    if (!updatingIdea) return;
    const refiningIdea = { ...updatingIdea, status: "refining", attempts: (updatingIdea.attempts || 0) + 1, updatedAt: new Date().toISOString() };

    setState((st) => ({ ...st, ideas: st.ideas.map((i) => (i.id === id ? refiningIdea : i)) }));
    sync.trackChange('idea', id, 'upsert', refiningIdea);

    try {
      const r = await streamAgent.run("refine", raw);
      if (!r) throw new Error("Förfining misslyckades");
      const refinedIdea = { ...updatingIdea, title: r.title, note: r.note, tags: (r.tags || []).slice(0, 3), status: "klar", updatedAt: new Date().toISOString() };
      setState((st) => ({
        ...st,
        ideas: st.ideas.map((i) => (i.id === id ? refinedIdea : i)),
      }));
      sync.trackChange('idea', id, 'upsert', refinedIdea);
      logAgent("Förfinaren", `städade "${(r.title || raw).slice(0, 40)}"`);
    } catch (e) {
      const failedIdea = { ...updatingIdea, status: "fail", updatedAt: new Date().toISOString() };
      setState((st) => ({ ...st, ideas: st.ideas.map((i) => (i.id === id ? failedIdea : i)) }));
      sync.trackChange('idea', id, 'upsert', failedIdea);
    }
  };

  const addIdea = (raw) => {
    const id = uid();
    const canRefine = stateRef.current.externalAiEnabled && stateRef.current.agents.refine;
    const newIdea = { id, raw, title: null, note: null, tags: [], ts: Date.now(), status: canRefine ? "refining" : "raw", updatedAt: new Date().toISOString() };
    setState((st) => ({
      ...st,
      ideas: [newIdea, ...st.ideas].slice(0, 100),
    }));
    sync.trackChange('idea', id, 'upsert', newIdea);
    setToast(canRefine ? "Sparad — förfinas i bakgrunden" : "Sparad som idé");
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
    if (canRefine) refineIdea(id, raw, newIdea); // fire-and-forget: fångsten väntar aldrig på AI
  };

  const ideaToTask = (idea) => {
    const title = idea.title || idea.raw.slice(0, 60);
    addTask({ title, icon: "idea" });
    addWin(`Idé → uppgift: ${title}`);
  };

  const removeIdea = (id) => {
    const idea = stateRef.current.ideas.find(i => i.id === id);
    if (!idea) return;
    const deletedIdea = { ...idea, deletedAt: new Date().toISOString() };
    setState((st) => ({ ...st, ideas: st.ideas.filter((i) => i.id !== id) }));
    sync.trackChange('idea', id, 'delete', deletedIdea);
  };

  const updateIdea = (id, updates) => {
    const idea = stateRef.current.ideas.find(i => i.id === id);
    if (!idea) return;
    const updatedIdea = { ...idea, ...updates, updatedAt: new Date().toISOString() };
    setState((st) => ({ ...st, ideas: st.ideas.map((i) => (i.id === id ? updatedIdea : i)) }));
    sync.trackChange('idea', id, 'upsert', updatedIdea);

    // When the note is edited and is substantial, auto-suggest tags in the background.
    // Merge with existing — never overwrite user-set tags.
    if (updates.note !== undefined && updates.note && updates.note.trim().length >= 10) {
      const title = updates.title || updatedIdea.title || updatedIdea.raw || "";
      apiPost("/api/agents/tags", { title, note: updates.note })
        .then((suggested) => {
          if (!Array.isArray(suggested) || suggested.length === 0) return;
          const current = stateRef.current.ideas.find(i => i.id === id);
          if (!current) return;
          const existing = new Set(current.tags || []);
          const merged = [...(current.tags || [])];
          for (const t of suggested) {
            if (merged.length >= 4) break;
            if (!existing.has(t)) { merged.push(t); existing.add(t); }
          }
          if (merged.length !== (current.tags || []).length) {
            const taggedIdea = { ...current, tags: merged, updatedAt: new Date().toISOString() };
            setState((st) => ({ ...st, ideas: st.ideas.map((i) => (i.id === id ? taggedIdea : i)) }));
            sync.trackChange('idea', id, 'upsert', taggedIdea);
          }
        })
        .catch(() => { /* tyst — auto-taggning är bonus */ });
    }
  };

  /* ---------- auto-klassificering: agenten sorterar när du inte väljer ---------- */
  const logTags = (tags) =>
    setState((st) => ({ ...st, tagLog: [...st.tagLog, ...(tags || []).map((tag) => ({ day: todayKey(), tag }))] }));

  // Delad placeringslogik: tar ett redan klassificerat resultat ({type,title,tags,energy,time,note})
  // och lägger det i rätt lokal hink. Används av både textfångst (klassificerar client-side via
  // aiClassify) och röstfångst (redan klassificerad server-side av /api/capture/voice).
  const placeClassified = (raw, c) => {
    const tags = (c.tags || []).slice(0, 3);
    logTags(tags);
    if (c.type === "shopping") {
      const itemId = uid();
      let targetListId = null;
      setState((st) => {
        const target = st.lists.find((list) => list.slug === "shopping" || list.id === "shopping") || st.lists[0];
        targetListId = target.id;
        return {
          ...st,
          lists: st.lists.map((l) => (l.id === target.id ? { ...l, items: [...l.items, { id: itemId, text: c.title || raw, done: false }] } : l)),
        };
      });
      sync.trackChange('list_item', itemId, 'upsert', { listId: targetListId, text: c.title || raw, done: false });
      setToast(`→ Inköp: ${c.title || raw}`);
      logAgent("Sorteraren", `→ Inköp: "${(c.title || raw).slice(0, 40)}"`);
    } else if (c.type === "task") {
      addTask({ title: c.title || raw, energy: c.energy || 2, time: c.time || "", scheduled_date: c.scheduled_date || null, tags });
      setToast(`→ Uppgift: ${c.title || raw}${tags[0] ? ` · #${tags[0]}` : ""}`);
      logAgent("Sorteraren", `→ Uppgift: "${(c.title || raw).slice(0, 40)}" [${tags.join(", ")}]`);
    } else {
      const idea = { id: uid(), raw, title: c.title || null, note: c.note || null, tags, ts: Date.now(), status: c.title ? "klar" : "raw" };
      setState((st) => ({ ...st, ideas: [idea, ...st.ideas].slice(0, 100) }));
      sync.trackChange('idea', idea.id, 'upsert', idea);
      setToast(`→ Idé: ${c.title || raw.slice(0, 40)}`);
      logAgent("Sorteraren", `→ Idé: "${(c.title || raw).slice(0, 40)}"`);
    }
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const autoCapture = async (raw) => {
    if (!stateRef.current.externalAiEnabled || !stateRef.current.agents.classify) { addIdea(raw); return; }
    try {
      const c = await streamAgent.run("classify", raw);
      if (!c) throw new Error("Klassificering misslyckades");
      placeClassified(raw, c);
    } catch (e) {
      // felsäkert: ingenting får försvinna — landa som rå idé
      const idea = { id: uid(), raw, title: null, note: null, tags: [], ts: Date.now(), status: "raw" };
      setState((st) => ({ ...st, ideas: [idea, ...st.ideas].slice(0, 100) }));
      sync.trackChange('idea', idea.id, 'upsert', idea);
      setToast("Sorteringen misslyckades — sparad som rå idé");
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 3000);
    }
  };

  // Transkriberar bara — inget sparas eller klassificeras här. Talaren ser texten
  // som ett redigerbart utkast och väljer själv Uppgift/Idé/Inköp, precis som text-fångst.
  const transcribeVoice = async (blob, voiceLang) => {
    const form = new FormData();
    form.append("file", blob, "memo.webm");
    form.append("language", (voiceLang || "sv-SE").split("-")[0]);
    const auth = getAuth();
    const response = await fetch(`${API_BASE}/api/transcribe`, {
      method: "POST",
      headers: auth?.token ? { Authorization: `Bearer ${auth.token}` } : {},
      body: form,
    });
    if (response.status === 403) throw new Error("Externa AI-agenter är avstängda — slå på dem i Inställningar > Agenter.");
    if (!response.ok) throw new Error(`transcribe → ${response.status}`);
    const out = await response.json(); // TranscriptOut: { text, language, duration_s }
    return out.text;
  };

  /* ---------- agent-tick: en gemensam bakgrundsloop ---------- */
  // Aggressiv med flit: en tyst, långsam synk är precis vad som gjorde att
  // telefon och dator kunde visa olika data i timmar utan att någon märkte det.
  const SYNC_INTERVAL = 60 * 1000;
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const syncingRef = useRef(false);
  const sweepingRef = useRef(false);

  const runSync = async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    // syncing: true görs synligt direkt i SystemStatus — inget tyst arbete i bakgrunden
    setState((st) => ({ ...st, sync: { ...st.sync, day: todayKey(), last: Date.now(), syncing: true, err: null } }));

    try {
      const syncResult = await sync.performSync();
      const ouraStatus = await syncOura();
      // sync_in_progress isn't a failure — it means a different sync (e.g. the
      // immediate push after a change) is already in flight and will land the
      // same data. Only surface reasons that mean nothing actually got synced.
      const benign = syncResult.reason === "sync_in_progress";
      setState((st) => ({
        ...st,
        sync: {
          ...st.sync,
          oura: ouraStatus,
          syncing: false,
          err: (syncResult.success || benign) ? null : (syncResult.reason || "Synk misslyckades"),
        },
      }));

      const syncStats = syncResult.success ?
        `data ${syncResult.push.created + syncResult.push.updated + syncResult.push.deleted} changes` :
        `data sync failed: ${syncResult.reason}`;

      logAgent("Synkaren", `körning klar: ${syncStats}, oura ${ouraStatus}`);
    } catch (error) {
      setState((st) => ({ ...st, sync: { ...st.sync, syncing: false, err: error.message } }));
      logAgent("Synkaren", `körning misslyckades: ${error.message}`);
    } finally {
      syncingRef.current = false;
    }
  };

  // Förfinaren som svepare: plockar upp råa/misslyckade/fastnade idéer, max 2 per tick, max 3 försök per idé
  const refineSweep = async () => {
    const s = stateRef.current;
    if (!s.agents.refine) return;
    // 'refining' äldre än 5 min = fastnad (t.ex. avbruten stream) — plocka upp den också
    const staleRefining = Date.now() - 5 * 60 * 1000;
    const pending = s.ideas.filter((i) =>
      ((i.status === "raw" || i.status === "fail") ||
       (i.status === "refining" && (i.ts || 0) < staleRefining)) &&
      (i.attempts || 0) < 3
    ).slice(0, 2);
    for (const i of pending) await refineIdea(i.id, i.raw);
  };

  // Nedbrytaren: förbereder första steg för A-prioriterade eller tunga uppgifter innan du ber om det
  const breakdownSweep = async () => {
    const s = stateRef.current;
    if (!s.agents.breakdown) return;
    const budget = s.breakdownBudget.day === todayKey() ? s.breakdownBudget.n : 0;
    if (budget >= 3) return;
    const candidate = s.tasks.find((t) => !t.done && (!t.steps || t.steps.length === 0) && (t.priority === "A" || t.energy >= 4));
    if (!candidate) return;
    try {
      const steps = await aiBreakdown(candidate.title);
      const updatedTask = { ...candidate, steps };
      setState((st) => ({
        ...st,
        tasks: st.tasks.map((t) => (t.id === candidate.id ? updatedTask : t)),
        breakdownBudget: { day: todayKey(), n: (st.breakdownBudget.day === todayKey() ? st.breakdownBudget.n : 0) + 1 },
      }));
      sync.trackChange('task', candidate.id, 'upsert', updatedTask);
      logAgent("Nedbrytaren", `förberedde ${steps.length} steg för "${candidate.title.slice(0, 40)}"`);
    } catch (e) { /* tyst — försöker nästa tick */ }
  };

  const agentTick = async () => {
    if (sweepingRef.current) return;
    sweepingRef.current = true;
    const s = stateRef.current;
    if (s.agents.sync && s.settings.autoSync && Date.now() - (s.sync.last || 0) > SYNC_INTERVAL) await runSync();
    await refineSweep();
    await breakdownSweep();
    sweepingRef.current = false;
  };

  useEffect(() => {
    if (!loaded) return;
    const startT = setTimeout(agentTick, 1500);
    const guard = setInterval(agentTick, 5 * 60 * 1000); // vakt: agenterna tittar var 5:e minut
    return () => { clearTimeout(startT); clearInterval(guard); };
  }, [loaded]);

  // Synka direkt när man byter tillbaka till fliken/appen — annars kan telefon och
  // dator visa olika data i flera minuter efter en ändring på den andra enheten.
  useEffect(() => {
    if (!loaded) return;
    const onFocusLike = () => {
      if (document.visibilityState === "hidden") return;
      const s = stateRef.current;
      if (s.agents.sync && s.settings.autoSync && Date.now() - (s.sync.last || 0) > 60 * 1000) runSync();
    };
    document.addEventListener("visibilitychange", onFocusLike);
    window.addEventListener("focus", onFocusLike);
    return () => {
      document.removeEventListener("visibilitychange", onFocusLike);
      window.removeEventListener("focus", onFocusLike);
    };
  }, [loaded]);

  if (!loaded)
    return (
      <div style={{ minHeight: "100vh", background: T.paper, display: "grid", placeItems: "center", color: T.soft, fontFamily: F.body }}>
        Öppnar din dag…
      </div>
    );

  const s = styles;
  const recoveryTint = state.capacity === "recovery";

  return (
    <div style={{ ...s.page, background: recoveryTint ? T.surfaceRecovery : T.paper }}>
      <style>{`
        *:focus-visible { outline: 2px solid ${T.petrol}; outline-offset: 2px; border-radius: 4px; }
        button { touch-action: manipulation; }
        input, button, select { -webkit-tap-highlight-color: transparent; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
        html { -webkit-font-smoothing: antialiased; }
        body { margin: 0; background: var(--canvas); }
        button, input, textarea, select { font: inherit; }
        ::selection { background: var(--accent-soft); color: var(--text); }
        input:focus, textarea:focus, select:focus { border-color: var(--accent) !important; box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-soft) 75%, transparent); outline: none; }
        button:disabled { cursor: not-allowed; opacity: 0.55; }
        @media (max-width: 600px) { .shell { padding-left: 16px !important; padding-right: 16px !important; } .today-grid { gap: 0; } }
        @media (min-width: 1200px) { .shell { padding-left: 30px; padding-right: 30px; } }
        @media (min-width: 900px) { .nav { background: transparent !important; border-top: 0 !important; box-shadow: none !important; backdrop-filter: none !important; } .nav-inner { max-width: 520px; margin-bottom: 14px; padding: 6px 10px; border: 1px solid var(--border-subtle); border-radius: 18px; background: color-mix(in srgb, var(--surface) 94%, transparent); box-shadow: 0 8px 24px var(--shadow); } }

        /* Sober micro-interactions: a quiet press-down on tap, a quiet lift on hover
           (desktop only — "hover: hover" keeps touch devices from getting a stuck
           hover state), nothing bouncy or attention-seeking. */
        button:not(:disabled) { transition: transform 0.12s ease, box-shadow 0.15s ease, opacity 0.15s ease; }
        button:not(:disabled):active { transform: scale(0.97); }
        @media (hover: hover) {
          .card-hoverable:hover { box-shadow: 0 2px 10px var(--shadow); transform: translateY(-1px); }
          /* En rad i dagboken ligger på pappret och kan inte lyfta — den
             tonas i stället, med marginalen indragen så tonen täcker raden. */
          .row-hoverable:hover { background: var(--surface-quiet); }
        }
        .card-hoverable { transition: box-shadow 0.18s ease, transform 0.18s ease; }
        .row-hoverable { transition: background 0.18s ease; border-radius: 8px; }
        .visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
        :focus-visible { outline: 3px solid ${T.petrol}; outline-offset: 3px; }

        /* Loggan finns i två varianter — svart streckgrafik för ljust läge och
           en ljus version med gradient-bakgrund för mörkt. Båda ligger i
           headern, men bara den som matchar <html data-theme> visas. */
        .varv-logo-light { display: block; }
        .varv-logo-dark { display: none; }
        :root[data-theme="dark"] .varv-logo-light { display: none; }
        :root[data-theme="dark"] .varv-logo-dark { display: block; }

        @keyframes checkPop { 0% { transform: scale(1); } 45% { transform: scale(1.18); } 100% { transform: scale(1); } }
        .check-pop { animation: checkPop 0.28s ease; }

        @keyframes rowSettle { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        .row-settle { animation: rowSettle 0.25s ease; }

        /* På laptop är en 560px-kolumn mitt i en 1440px-skärm bara en telefon med
           tomma marginaler — dagen får två spalter i stället, så halva rullningen
           försvinner. Under 900px är allt oförändrat en kolumn. */
        .shell { max-width: 680px; }
        @media (min-width: 900px) {
          .shell { max-width: 1180px; }
          .today-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 28px;
            align-items: start;
          }
          .today-grid > * { min-width: 0; }
          .today-col > section:first-child { margin-top: 0; }
        }
        /* Navigeringen ska följa innehållskolumnen, inte klistras ut i
           skärmkanterna. */
        .nav-inner { display: flex; justify-content: space-around; align-items: center;
                     width: 100%; max-width: 680px; margin: 0 auto; height: 100%; }
      `}</style>
      <div className="shell" style={s.shell}>
        {/* ============ header ============ */}
        <header style={s.header}>
          <img src={varvLogo} alt="Varv" className="varv-logo varv-logo-light" style={s.logo} />
          <img src={varvLogoDark} alt="" aria-hidden="true" className="varv-logo varv-logo-dark" style={s.logo} />
          {/* Account menu: configuration (inställningar, agenter, kopplingar) lives
              here so the verktygslådan only holds things you actually *do*. */}
          <div style={{ marginLeft: "auto", position: "relative" }}>
            <button
              ref={accountButtonRef}
              style={{ ...s.linkBtn, fontSize: 12, color: T.soft }}
              onClick={() => setAccountMenu((v) => !v)}
              aria-expanded={accountMenu}
              aria-haspopup="menu"
            >
              <AvatarIcon name={avatarIconKey(state.settings)} size={14} /> {state.settings.displayName || username} ▾
            </button>
            {accountMenu && (
              <div
                role="menu"
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 6px)",
                  background: T.card,
                  border: `1px solid ${T.line}`,
                  borderRadius: 10,
                  boxShadow: `0 6px 20px ${T.shadow}`,
                  minWidth: 190,
                  padding: 6,
                  zIndex: 60,
                }}
              >
                {[
                  ["Inställningar", () => setShowSettings(true)],
                  ["Logga ut", onLogout],
                ].map(([label, action]) => (
                  <button
                    key={label}
                    role="menuitem"
                    onClick={() => { setAccountMenu(false); action(); }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      padding: "9px 10px",
                      borderRadius: 6,
                      fontFamily: "inherit",
                      fontSize: 14,
                      color: label === "Logga ut" ? T.soft : T.ink,
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>
        {accountMenu && (
          <div
            onClick={() => setAccountMenu(false)}
            style={{ position: "fixed", inset: 0, zIndex: 50 }}
          />
        )}

        {/* ============ wind-down banner ============ */}
        {pastWinddown && (
          <div style={s.winddownBanner}>
            Nedvarvning. Skärmarna dämpas, kraven sänks — imorgon börjar {state.settings.wake}.
          </div>
        )}

        {view === "today" && (
          <main className="today-grid" aria-labelledby="today-heading">
            <h1 id="today-heading" className="visually-hidden">Idag</h1>
            <div className="today-col">
        {/* ============ observatören: kontextuellt verktygsförslag ============ */}
        {observerSuggestion && (
          <div style={s.nudge}>
            {observerSuggestion.text}
            <span style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <button
                style={s.linkBtn}
                onClick={() => { setView("tools"); setTool(observerSuggestion.tool); }}
              >
                {observerSuggestion.cta}
              </button>
              <button
                style={{ ...s.linkBtn, color: T.soft }}
                onClick={() => dismissObserverSuggestion(observerSuggestion.key)}
              >
                ej nu
              </button>
            </span>
          </div>
        )}

        {/* ============ hero: working memory display (ADHD-optimized) ============ */}
        <section style={{ marginBottom: 20 }}>
          <WorkingMemoryDisplay
            state={state}
            settings={state.settings}
            onWinddownClick={() => { setView("tools"); setTool("sleep"); }}
          />

          {/* Compact status row: energy mode + medication, less prominent */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginTop: 10,
            paddingTop: 10,
            borderTop: `1px solid ${T.line}`,
            flexWrap: 'wrap'
          }}>
            {/* Energy mode — small text pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: T.soft }}></span>
              {Object.entries(MODES).map(([k, m]) => (
                <button
                  key={k}
                  onClick={() => patch({ capacity: k, capacityBy: { day: todayKey(), by: "user" } })}
                  style={{
                    background: state.capacity === k ? T.petrol : 'transparent',
                    color: state.capacity === k ? T.textOnAccent : T.soft,
                    border: state.capacity === k ? `1px solid ${T.petrol}` : `1px solid transparent`,
                    borderRadius: '12px',
                    padding: '3px 9px',
                    fontFamily: F.body,
                    fontSize: '0.72rem',
                    fontWeight: state.capacity === k ? 700 : 400,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Medication — discreet pill */}
            {medToday ? (
              <button
                style={{ background: 'none', border: 'none', color: medToday.status === 'taken' ? T.moss : T.soft, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                onClick={() => setState((st) => ({ ...st, meds: st.meds.filter((m) => m.day !== todayKey()) }))}
              >
                {medToday.status === "taken" ? <><IconCheck size={12} /> medicin</> : medToday.status === "skipped" ? "~ medicin" : "· medicin"}
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: '0.7rem', color: T.soft }}>medicin</span>
                {["taken", "skipped", "off"].map((v) => (
                  <button
                    key={v}
                    onClick={() => setState((st) => ({ ...st, meds: [...st.meds, { day: todayKey(), status: v }] }))}
                    style={{
                      background: 'transparent',
                      border: `1px solid ${T.line}`,
                      borderRadius: '10px',
                      padding: '2px 7px',
                      fontSize: '0.68rem',
                      color: T.soft,
                      cursor: 'pointer',
                      fontFamily: 'inherit'
                    }}
                  >
                    {v === "taken" ? <IconCheck size={12} /> : v === "skipped" ? "~" : "·"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {overBudget && state.capacity !== "recovery" && (
            <div style={s.nudge}>
              Du har passerat dagens budget. Inget är trasigt — men att växla ner skyddar morgondagen.
              <button
                style={{ ...s.linkBtn, marginLeft: 8 }}
                onClick={() => patch({ capacity: state.capacity === "steady" ? "low" : "recovery" })}
              >
                byt till {state.capacity === "steady" ? "Lågt batteri" : "Återhämtning"}
              </button>
            </div>
          )}

        </section>
        {/* ============ recovery rest menu ============ */}
        {recoveryTint && (
          <section style={s.leaf}>
            <div style={s.eyebrow}>Vilomeny</div>
            <p style={{ ...s.body, marginTop: 6 }}>
              I återhämtningsläge krymper planen med flit. Välj en, sluta sedan besluta.
            </p>
            {(() => {
              const offset = new Date().getDate() % REST_MENU.length;
              const items = [0, 1, 2].map((i) => REST_MENU[(offset + i) % REST_MENU.length]);
              const restedToday = new Set(
                winsToday.filter((w) => w.text.startsWith("Vilade: ")).map((w) => w.text.slice(8))
              );
              return items.map((r, i) => {
                const done = restedToday.has(r);
                return (
                  <button
                    key={i}
                    style={{ ...s.restItem, ...(i > 0 ? s.rowRule : null), opacity: done ? 0.55 : 1 }}
                    disabled={done}
                    onClick={() => {
                      logEnergy(-2, "Vila");
                      addWin(`Vilade: ${r}`);
                    }}
                  >
                    <span>{r}</span>
                    <span style={{ ...s.restPlus, display: "inline-flex", alignItems: "center", gap: 4 }}>{done && <IconCheck size={12} />}+2</span>
                  </button>
                );
              });
            })()}
          </section>
        )}

        {/* ============ transition cue ============ */}
        {upcoming && (
          <div style={s.transitionCue}>
            Snart — <b>{upcoming.title}</b> börjar om {upcoming.inMin} min. Dags att börja landa det du håller på med.
          </div>
        )}

        {/* ============ now / next ============ */}
        <section aria-labelledby="next-task-heading" style={s.leafLap}>
          <h2 id="next-task-heading" style={{ ...s.eyebrow, margin: 0 }}>{nextTask ? "En tydlig nästa sak" : "Inget i kön"}</h2>
          {nextTask ? (
            <>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 8 }}>
                <span style={s.coinLg}><TaskIcon name={nextTask.icon} size={22} /></span>
                <div style={{ ...s.nextTitle, marginTop: 4, flex: 1 }}>{nextTask.title}</div>
                <button style={s.doneBtn} onClick={() => completeTask(nextTask)} aria-label="Markera klar"><IconCheck size={18} /></button>
              </div>
              <div style={s.metaRow}>
                {nextTask.time && <span style={s.mono}>{nextTask.time}</span>}
                <span style={{ ...s.chip, background: "transparent", border: `1.5px solid ${energyColor(nextTask.energy)}`, color: T.spruce }}>{nextTask.energy}p</span>
                {nextTask.trigger && <span style={s.chipSoft}>när {nextTask.trigger}</span>}
              </div>
              {nextTask.steps && nextTask.steps.length > 0 && (
                <div style={{ marginTop: 8, color: T.soft, fontSize: 14 }}>
                  Första steget: {nextTask.steps.find((st) => !st.done)?.title || "alla steg klara"}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button style={s.primaryBtn} onClick={() => startTaskStep(nextTask)}>
                  Starta ett fokusvarv
                </button>
                <button style={{ ...s.ghostBtn, borderColor: T.warn, color: T.warn }} onClick={() => setUnstick((v) => !v)}>
                  Jag kommer inte igång
                </button>
              </div>

              {unstick && (
                <div style={s.unstickBox}>
                  {(() => {
                    const firstStep = (nextTask.steps || []).find((st) => !st.done);
                    if (firstStep)
                      return (
                        <>
                          <div style={{ fontSize: 13, color: T.soft }}>Glöm hela uppgiften. Bara detta:</div>
                          <div style={{ fontFamily: F.display, fontSize: 20, marginTop: 4 }}>{firstStep.title}</div>
                          <p style={{ ...s.body, marginTop: 8 }}>
                            Tio minuter, sedan får du sluta. Para ihop det med något du bara tillåter under uppgifter — en viss spellista eller podd. Motivationen följer intresset; låna det.
                          </p>
                          <button
                            style={{ ...s.primaryBtn, marginTop: 10 }}
                            onClick={() => {
                              setFocusPrefill({ goal: firstStep.title, mins: 10 });
                              setView("tools");
                              setTool("focus");
                              setUnstick(false);
                            }}
                          >
                            Bara 10 minuter
                          </button>
                        </>
                      );
                    return (
                      <>
                        <div style={{ fontSize: 14, color: T.ink }}>
                          Uppgiften är för stor för att börja — det är problemet, inte du. Vi hittar minsta första steget.
                        </div>
                        <button
                          style={{ ...s.primaryBtn, marginTop: 10 }}
                          disabled={unstickBusy}
                          onClick={async () => {
                            setUnstickBusy(true);
                            try {
                              const steps = await aiBreakdown(nextTask.title);
                              updateTask(nextTask.id, { steps });
                            } catch (e) { /* stays open, user can retry */ }
                            setUnstickBusy(false);
                          }}
                        >
                          {unstickBusy ? "letar…" : "Hitta minsta första steget"}
                        </button>
                      </>
                    );
                  })()}
                </div>
              )}
            </>
          ) : (
            <p style={s.body}>
              Tryck på + där nere för att fånga en uppgift, eller ta pausen. En tom kö är tillåten.
            </p>
          )}
        </section>

        {/* ============ timeline (only when there are scheduled items) ============ */}
        {!recoveryTint && scheduled.length > 0 && (
          <section style={s.section}>
            <div style={s.eyebrow}>Nästa halvdag</div>
              <div style={s.timeline}>
                <div style={s.timelineSpine} aria-hidden="true" />
                <NowMarker />
                {scheduled.map((t, i) => {
                  const next = scheduled[i + 1];
                  const gap = next ? next.m - (t.m + (t.minutes || 30)) : null;
                  return (
                    <div key={t.id}>
                      <div style={s.tlRow}>
                        <div style={s.tlTime}>{t.time}</div>
                        <div style={t.isEvent ? { ...s.tlDot, background: "transparent", border: `2px solid ${T.petrol}` } : { ...s.tlDot, background: energyColor(t.energy) }} />
                        <div style={{ ...s.tlBody, display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={s.coin}><TaskIcon name={t.icon} size={18} /></span>
                          <span>
                            <span style={{ fontWeight: 700 }}>{t.title}</span>
                            <span style={{ color: T.soft }}>{t.isEvent ? ` · ${t.minutes} min` : ` · ${t.energy}p`}</span>
                          </span>
                        </div>
                      </div>
                      {gap !== null && gap < 15 && (
                        <div style={s.bufferRow}>
                          {gap >= 0 ? (
                            <span style={s.bufferWarn}>bara {gap} min emellan — snäv övergång</span>
                          ) : (
                            <span style={s.bufferWarn}>överlapp — överväg att flytta en</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
          </section>
        )}
            </div>

            <div className="today-col">
        {/* ============ tasks ============ */}
        <section aria-labelledby="task-list-heading" style={s.section}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 id="task-list-heading" style={{ ...s.eyebrow, margin: 0 }}>
              {isToday ? "Dagens uppgifter" : `Uppgifter · ${new Date(selectedDate + "T12:00:00").toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "short" })}`}
            </h2>
            <button style={s.linkBtn} onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? "stäng" : "+ lägg till"}
            </button>
          </div>

          {/* Day selector — strip covers a 6-day window; arrows shift by week. Bigger
              and bolder than a typical filter chip since this is the primary "which
              day am I looking at" control, not incidental chrome. */}
          <div style={{ display: "flex", gap: 8, marginBottom: 4, alignItems: "center" }}>
            <button
              onClick={() => setWeekOffset((w) => w - 1)}
              style={{ ...s.linkBtn, minWidth: 44, minHeight: 60, fontSize: 20 }}
              aria-label="Föregående vecka"
            >‹</button>
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, flex: 1 }}>
              {[-2, -1, 0, 1, 2, 3].map((offset) => {
                const d = new Date(Date.now() + (offset + weekOffset * 7) * 86400000);
                const dateStr = todayKey(d);
                const isSelected = dateStr === selectedDate;
                const isTodayDate = dateStr === todayKey();
                const dayName = d.toLocaleDateString('sv-SE', { weekday: 'short', timeZone: 'Europe/Stockholm' });
                const dayNum = Number(dateStr.slice(-2));
                return (
                  <button
                    key={dateStr}
                    onClick={() => setSelectedDate(dateStr)}
                    aria-current={isSelected ? "date" : undefined}
                    aria-label={`${dayName} ${dayNum}${isTodayDate ? " (idag)" : ""}`}
                    style={{
                      padding: '8px 6px',
                      minWidth: 54,
                      minHeight: 60,
                      boxSizing: 'border-box',
                      borderRadius: 10,
                      border: isSelected ? `2px solid ${T.petrol}` : isTodayDate ? `1.5px solid ${T.petrol}` : `1px solid ${T.line}`,
                      background: isSelected ? T.petrol : 'transparent',
                      color: isSelected ? T.textOnAccent : T.ink,
                      cursor: 'pointer',
                      flexShrink: 0,
                      fontFamily: "inherit",
                      textAlign: 'center',
                      transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
                    }}
                  >
                    <div style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.03em', opacity: isSelected ? 0.9 : 0.7 }}>{dayName}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: F.display, marginTop: 2 }}>{dayNum}</div>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setWeekOffset((w) => w + 1)}
              style={{ ...s.linkBtn, minWidth: 44, minHeight: 60, fontSize: 20 }}
              aria-label="Nästa vecka"
            >›</button>
          </div>

          {/* Stats for the day shown above — grouped right under the day-nav instead
              of floating elsewhere, since they describe that same day (proximity).
              Zeroes are omitted: a row of noughts is noise, not status. Energy
              lives in the hero card and is deliberately not repeated here. */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, color: T.soft, marginBottom: 10 }}>
            {doneForSelectedDate.length > 0 && (
              <span><b style={{ color: T.ink }}>{doneForSelectedDate.length}</b> klara</span>
            )}
            <span><b style={{ color: T.ink }}>{visibleTasks.length}</b> kvar</span>
            {winsForSelectedDate.length > 0 && (
              <span><b style={{ color: T.ink }}>{winsForSelectedDate.length}</b> vinster</span>
            )}
          </div>

          {/* Back to today — the week strip above is the date picker, so there is
              no second one here. */}
          {!isToday && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
              <button
                style={s.linkBtn}
                onClick={() => { setSelectedDate(todayKey()); setWeekOffset(0); }}
              >
                ← idag
              </button>
              {selectedDate > todayKey() && (
                <span style={{ fontSize: 12, color: T.petrol, fontFamily: F.mono }}>
                  {new Date(selectedDate + 'T12:00:00').toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'short' })}
                </span>
              )}
            </div>
          )}

          {showAdd && (
            <AddTask
              defaultDate={selectedDate}
              onAdd={(draft) => {
                addTask(draft);
                setShowAdd(false);
              }}
            />
          )}

          {visibleTasks.length === 0 && !showAdd && (
            <p style={s.body}>
              {recoveryTint
                ? "Inga nödvändiga i kön. Vila är planen."
                : "Inget här ännu. Fånga en uppgift innan den dunstar."}
            </p>
          )}

          {visibleTasks.map((t) => (
            <div
              key={t.id}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({
                  x: e.clientX, y: e.clientY,
                  items: [
                    { icon: <IconPencil />, label: "Redigera", action: () => selectTask(t) },
                    { icon: t.done ? <IconUndo /> : <IconCheck />, label: t.done ? "Återställ" : "Markera klar", action: () => t.done ? undoCompleteTask(t) : completeTask(t) },
                    { icon: <IconCalendar />, label: "Schemalägg", action: () => { selectTask(t); setTool(null); } },
                    { separator: true },
                    { icon: <IconTrash />, label: "Ta bort", danger: true, action: () => removeTask(t.id) },
                  ],
                });
              }}
              style={{ cursor: 'pointer' }}
            >
              <TaskCard
                task={t}
                onDone={() => completeTask(t)}
                onUpdate={(p) => updateTask(t.id, p)}
                onRemove={() => removeTask(t.id)}
                onWin={addWin}
                aiEnabled={state.externalAiEnabled}
                agentBusy={streamAgent.isRunning && streamAgent.activeInput === t.title}
                initiationOpen={selectedTask?.id === t.id}
                onStartSupport={() => selectTask(t)}
              />
              {selectedTask?.id === t.id && (
                <TaskInitiationSupport
                  task={t}
                  onStartStep={(task, step) => startTaskStep(task, step)}
                  onSetTrigger={(task) => setTaskTrigger(task)}
                  onClose={deselectTask}
                />
              )}
            </div>
          ))}
        </section>

        {/* ============ klart ============ */}
        {doneForSelectedDate.length > 0 && (
          <section style={s.section}>
            <div style={s.eyebrow}>{isToday ? "Klart idag" : "Klart"} ({doneForSelectedDate.length})</div>
            {doneForSelectedDate.map((entry) => (
              <div key={entry.occurrence ? `${entry.task.id}:${entry.date}` : entry.task.id} style={{ ...s.leaf, marginTop: 8, opacity: 0.75 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={s.coin}><TaskIcon name={entry.task.icon} size={18} /></span>
                  <span style={{ textDecoration: "line-through", color: T.soft, flex: 1 }}>{entry.task.title}</span>
                  {entry.doneAt && (
                    <span style={{ fontSize: 12, color: T.soft }}>{new Date(entry.doneAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}</span>
                  )}
                  <button style={{ ...s.linkBtn, fontSize: 12, minHeight: 44, padding: "4px 8px" }} onClick={() => reopenTask(entry)}>
                    öppna igen
                  </button>
                </div>
                {entry.steps.length > 0 && (
                  <div style={{ marginTop: 6, paddingLeft: 34 }}>
                    {entry.steps.map((st, i) => (
                      <div key={st.id || i} style={{ fontSize: 13, color: T.soft, textDecoration: st.done ? "line-through" : "none" }}>
                        {st.done ? <IconCheck size={13} /> : <IconDot size={13} />} {st.title}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}
            </div>
          </main>
        )}

        {/* ============ idéer view ============ */}
        {view === "ideas" && (
          <main aria-labelledby="ideas-heading" style={{ marginTop: 4 }}>
            <h1 id="ideas-heading" className="visually-hidden">Idéer</h1>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <p style={{ ...s.body, marginTop: 4 }}>
                {state.externalAiEnabled && state.agents.refine
                  ? "Tala eller skriv in rått — sparas direkt, städas av AI efteråt."
                  : "Skriv in rått — idéerna sparas direkt och väntar tryggt här."}
              </p>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {[["list", "lista"], ["map", "karta"]].map(([m, l]) => (
                  <button
                    key={m}
                    aria-pressed={ideaMode === m}
                    onClick={() => { setIdeaMode(m); if (m === "map") runSync(); }}
                    style={{ ...s.medBtn, background: ideaMode === m ? T.accentSoft : "transparent", fontWeight: ideaMode === m ? 700 : 400 }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {state.ideas.length === 0 && (
              <p style={{ ...s.body, marginTop: 14 }}>
                Tomt. Tryck på + och sedan Idé — eller mikrofonen och prata på.
              </p>
            )}
            {ideaMode === "map" && state.ideas.length > 0 && (
              <>
                <Suspense fallback={<p role="status" style={s.body}>Laddar grafen…</p>}>
                  <IdeaGraph ideas={state.ideas} tasks={state.tasks} onSelect={(id) => setState((st) => ({ ...st, _selIdea: id }))} selectedId={state._selIdea} />
                </Suspense>
                <button style={{ ...s.linkBtn, marginTop: 10 }} onClick={() => setIdeaMode("list")}>Visa den fullständiga listan</button>
              </>
            )}
            {ideaMode === "map" && state._selIdea && state.ideas.find((i) => i.id === state._selIdea) && (
              <IdeaCard
                idea={state.ideas.find((i) => i.id === state._selIdea)}
                onRefine={() => refineIdea(state._selIdea, state.ideas.find((i) => i.id === state._selIdea).raw)}
                onToTask={() => ideaToTask(state.ideas.find((i) => i.id === state._selIdea))}
                onRemove={() => { removeIdea(state._selIdea); setState((st) => ({ ...st, _selIdea: null })); }}
                onUpdate={updateIdea}
                aiEnabled={state.externalAiEnabled}
              />
            )}
            {ideaMode === "list" && state.ideas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                onRefine={() => refineIdea(idea.id, idea.raw)}
                onToTask={() => ideaToTask(idea)}
                onRemove={() => removeIdea(idea.id)}
                onUpdate={updateIdea}
                aiEnabled={state.externalAiEnabled}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({
                    x: e.clientX, y: e.clientY,
                    items: [
                      { icon: <IconPencil />, label: "Redigera", action: () => {} },
                      { icon: "→", label: "Till uppgift", action: () => ideaToTask(idea) },
                      { icon: <IconSparkle />, label: "Förfina", action: () => refineIdea(idea.id, idea.raw) },
                      { separator: true },
                      { icon: <IconTrash />, label: "Ta bort", danger: true, action: () => removeIdea(idea.id) },
                    ],
                  });
                }}
              />
            ))}
          </main>
        )}

        {/* ============ lists view ============ */}
        {view === "lists" && (
          <main aria-labelledby="lists-heading" style={{ marginTop: 4 }}>
            <h1 id="lists-heading" className="visually-hidden">Listor</h1>
            <p style={{ ...s.body, marginTop: 4 }}>
              Om det är viktigt bor det på en lista — aldrig i huvudet.
            </p>
            <Lists
              lists={state.lists}
              onAddList={addShoppingList}
              onRemoveList={removeShoppingList}
              onAddItem={addListItem}
              onToggleItem={toggleListItem}
              onResetDone={resetListDone}
              onClearDone={clearDoneListItems}
            />
          </main>
        )}

        {/* ============ tools view ============ */}
        {view === "tools" && (
          <main aria-labelledby="tools-heading" style={{ marginTop: 4 }}>
          <h1 id="tools-heading" className="visually-hidden">Verktyg</h1>
          {/* Verktygslådan leder med det som är relevant just nu och lägger resten
              bakom ett klick. Utan förslag (observatören av, eller inget som
              matchar) visas hela lådan direkt — en tom verktygsvy vore en
              återvändsgränd. */}
          {(() => {
            const allTools = [
              vt.focus !== false && { id: "focus", label: "Fokusvarv", sub: lapRunning ? "pågår…" : "timer + mål", active: tool === "focus" || lapRunning, onClick: () => setTool(tool === "focus" ? null : "focus") },
              vt.movement !== false && { id: "move", label: "Rörelsepaus", sub: "5 min, +2p", active: tool === "move", onClick: () => setTool(tool === "move" ? null : "move") },
              vt.checkin !== false && { id: "checkin", label: "Tankekoll", sub: "en snällare läsning", active: tool === "checkin", onClick: () => setTool(tool === "checkin" ? null : "checkin") },
              vt.wins !== false && { id: "wins", label: "Vinster", sub: `${winsToday.length} idag`, active: tool === "wins", onClick: () => setTool(tool === "wins" ? null : "wins") },
              vt.sleep !== false && { id: "sleep", label: "Sömnankare", sub: `vakna ${state.settings.wake}`, active: tool === "sleep", onClick: () => setTool(tool === "sleep" ? null : "sleep") },
              vt.breathing !== false && { id: "ground", label: "Andningsankare", sub: "3 min, +1p", active: tool === "ground", onClick: () => setTool(tool === "ground" ? null : "ground") },
              vt.week !== false && { id: "week", label: "Veckoöversikt", sub: "energimönster", active: tool === "week", onClick: () => setTool(tool === "week" ? null : "week") },
              vt.why === true && { id: "edu", label: "Varför det funkar", sub: "evidensen", active: tool === "edu", onClick: () => setTool(tool === "edu" ? null : "edu") },
              { id: "morning", label: "Morgoncheck", sub: "översikt + energi", active: false, onClick: () => setShowCheckin(true) },
            ].filter(Boolean);

            const whyFor = (id) => observerCandidates.find((candidate) => !dismissedToday(candidate.key) && candidate.tool === id)?.why;
            const suggested = allTools.filter((t) => whyFor(t.id));
            const rest = allTools.filter((t) => !whyFor(t.id));

            if (suggested.length === 0) {
              return (
                <div style={s.toolGrid}>
                  {allTools.map((t) => <ToolBtn key={t.id} {...t} />)}
                </div>
              );
            }

            return (
              <>
                <div style={s.eyebrow}>Föreslås nu</div>
                <div style={s.toolGrid}>
                  {suggested.map((t) => <ToolBtn key={t.id} {...t} sub={whyFor(t.id)} />)}
                </div>
                <button
                  style={{ ...s.linkBtn, marginTop: 16 }}
                  onClick={() => setShowAllTools((v) => !v)}
                  aria-expanded={showAllTools}
                >
                  {showAllTools ? "dölj övriga verktyg" : `visa alla verktyg (${rest.length})`}
                </button>
                {showAllTools && (
                  <div style={s.toolGrid}>
                    {rest.map((t) => <ToolBtn key={t.id} {...t} />)}
                  </div>
                )}
              </>
            );
          })()}

          {tool && (
            <h2 style={{ ...s.eyebrow, marginTop: 22, marginBottom: 0 }}>
              {{ focus: "Fokusvarv", ground: "Andningsankare", week: "Veckoöversikt", edu: "Varför det funkar", sleep: "Sömnankare", move: "Rörelsepaus", checkin: "Tankekoll", wins: "Vinster" }[tool] || "Verktyg"}
            </h2>
          )}

          {tool === "ground" && (
            <BreathingSpace
              onDone={() => {
                logEnergy(-1, "Andning");
                addWin("Andningsankare, 3 min");
                setTool(null);
              }}
            />
          )}
          {tool === "week" && <WeekReview energyLog={state.energyLog} wins={state.wins} tagLog={state.tagLog} />}
          {tool === "edu" && <EduCards />}
          {tool === "sleep" && (
            <SleepPanel
              settings={state.settings}
              onChange={(p) => setState((st) => ({ ...st, settings: { ...st.settings, ...p } }))}
            />
          )}
          {tool === "move" && (
            <MovementSnack
              onDone={(idea) => {
                logEnergy(-2, "Rörelse");
                addWin(`Rörde mig: ${idea}`);
                setTool(null);
              }}
            />
          )}
          {tool === "checkin" && (
            <CheckIn
              past={state.checkins}
              onSave={(c) => {
                setState((st) => ({ ...st, checkins: [c, ...st.checkins].slice(0, 40) }));
                sync.trackChange('checkin', c.id, 'upsert', c);
                addWin("Gjorde en tankekoll");
                setTool(null);
              }}
            />
          )}
          {tool === "wins" && <WinsList wins={state.wins} calibration={state.calibration} />}
          </main>
        )}

        {/* ============ focus lap — mounted globally so a running timer survives navigation ============ */}
        {((view === "tools" && tool === "focus") || lapRunning) && (
          <FocusLap
            key={focusPrefill ? focusPrefill.goal : "default"}
            taskTitle={focusPrefill?.taskTitle || nextTask?.title}
            initialGoal={focusPrefill?.goal}
            initialMins={focusPrefill?.mins || state.settings.defaultFocusMinutes}
            persisted={state.activeFocus}
            mini={lapRunning && !(view === "tools" && tool === "focus")}
            onExpand={() => { setView("tools"); setTool("focus"); }}
            onRunning={setLapRunning}
            onFocusStart={(goal, mins, startedAt) => setState((st) => ({ ...st, activeFocus: { goal, mins, startedAt } }))}
            onPark={(text) => addTask({ title: text })}
            onDone={(goal, mins, est, actualMin) => {
              addWin(`Fokusvarv (${actualMin} min): ${goal || "utan titel"}`);
              if (est > 0) {
                const cal = { id: uid(), est, actual: actualMin, ts: Date.now() };
                setState((st) => ({ ...st, calibration: [...st.calibration, cal].slice(-40) }));
                sync.trackChange('calibration', cal.id, 'upsert', cal);
              }
              setState((st) => ({ ...st, activeFocus: null }));
              setLapRunning(false);
              setFocusPrefill(null);
              setTool(null);
            }}
          />
        )}

        <footer style={s.footer}>
          Inga streaks. Varje dag börjar på noll.
        </footer>
      </div>

      {/* ============ capture sheet ============ */}
      {captureOpen && (
        <CaptureSheet
          onClose={closeCapture}
          aiSortingEnabled={state.externalAiEnabled && state.agents.classify}
          voiceEnabled={state.externalAiEnabled}
          voiceLang={state.settings.voiceLang}
          onLangChange={(lang) => setState((st) => ({ ...st, settings: { ...st.settings, voiceLang: lang } }))}
          onIdea={addIdea}
          onAuto={autoCapture}
          onTranscribe={transcribeVoice}
          onTask={(title) => {
            addTask({ title });
            setToast(`Fångad: ${title}`);
            clearTimeout(toastTimer.current);
            toastTimer.current = setTimeout(() => setToast(null), 2200);
          }}
          onListItem={(text) => {
            const itemId = uid();
            let targetListId = null;
            setState((st) => {
              const target = st.lists.find((list) => list.slug === "shopping" || list.id === "shopping") || st.lists[0];
              if (!target) return st;
              targetListId = target.id;
              return {
                ...st,
                lists: st.lists.map((l) => (l.id === target.id ? { ...l, items: [...l.items, { id: itemId, text, done: false }] } : l)),
              };
            });
            if (targetListId) sync.trackChange('list_item', itemId, 'upsert', { listId: targetListId, text, done: false });
            setToast(`→ Inköp: ${text}`);
            clearTimeout(toastTimer.current);
            toastTimer.current = setTimeout(() => setToast(null), 2200);
          }}
        />
      )}

      {/* ============ toast ============ */}
      {!blockingOverlayOpen && toast && <div role="status" aria-live="polite" style={s.toast}>{toast}</div>}
      {!blockingOverlayOpen && <AgentProgress step={streamAgent.step} text={streamAgent.text} isRunning={streamAgent.isRunning} />}
      {!blockingOverlayOpen && undoTask && (
        <div role="status" aria-live="polite" style={{ ...s.toast, background: T.petrol, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span><IconCheck size={13} /> {undoTask.title}</span>
          <button
            onClick={() => undoCompleteTask(undoTask)}
            style={{ background: T.control, color: T.petrol, border: 'none', borderRadius: 6, padding: '4px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
          >
            Ångra
          </button>
        </div>
      )}

      {/* ============ setup wizard ============ */}
      {showSetup && <SetupWizard onComplete={handleSetupComplete} />}

      {/* ============ settings / preferences ============ */}
      {showSettings && (
        <SettingsView
          state={{ ...state, username }}
          onPatch={(patch) => setState((st) => ({ ...st, ...patch }))}
          onToggleExternalAi={handleToggleExternalAi}
          saveStatus={settingsSaveStatus}
          googleConnected={googleConnected}
          googleBusy={googleBusy}
          googleConnectHref={googleConnectUrl()}
          onDisconnectGoogle={disconnectGoogle}
          onSyncNow={runSync}
          onSyncOura={async () => {
            const result = await syncOura();
            setState((current) => ({ ...current, sync: { ...current.sync, day: todayKey(), oura: result } }));
          }}
          onSetManualSleep={setManualSleep}
          onLogout={() => { setShowSettings(false); onLogout(); }}
          onClose={() => {
            setShowSettings(false);
            requestAnimationFrame(() => accountButtonRef.current?.focus());
          }}
        />
      )}

      {/* ============ daily check-in ============ */}
      {showCheckin && !showSetup && (
        <DailyCheckin
          state={state}
          onSetEnergy={handleCheckinEnergy}
          onDismiss={handleCheckinDismiss}
          onAddTask={addTask}
        />
      )}

      {/* ============ bottom navigation ============ */}
      {/* Modalerna täcker hela skärmen — då ska navigeringen inte ligga kvar och
          se klickbar ut (eller nås med tab) bakom dem. */}
      {!blockingOverlayOpen && (
      <nav className="nav" aria-label="Huvudnavigation" style={s.nav}>
        <div className="nav-inner">
        {[["today", "Idag"], ["ideas", "Idéer"], ["capture", "+"], ["lists", "Listor"], ["tools", "Verktyg"]].map(([k, label]) =>
          k === "capture" ? (
            <button ref={captureButtonRef} key={k} style={s.navPlus} onClick={() => setCaptureOpen(true)} aria-label="Fånga en tanke">
              +
            </button>
          ) : (
            <button
              key={k}
              onClick={() => setView(k)}
              aria-current={view === k ? "page" : undefined}
              style={{ ...s.navBtn, color: view === k ? T.petrolDark : T.soft, fontWeight: view === k ? 700 : 500, background: view === k ? T.accentSoft : "transparent", borderRadius: 12, minWidth: 68 }}
            >
              <span style={{ ...s.navDash, opacity: view === k ? 1 : 0 }} />
              {label}
              {k === "tools" && lapRunning && <span style={s.navDot} />}
            </button>
          )
        )}
        </div>
      </nav>
      )}

      {/* ============ System Status (ADHD anxiety reduction) ============ */}
      {!blockingOverlayOpen && (
        <SystemStatus
          sync={state.sync}
          agents={state.agents}
          lastSync={state.sync.last}
          onSyncClick={() => runSync()}
        />
      )}

      {/* ============ context menu ============ */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

/* ============================================================ */
/* Inloggning — varje person har eget separat dataset            */
/* ============================================================ */
function Login({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const { token, username: u } = await login(username.trim(), password);
      setAuth({ token, username: u });
      onLoggedIn(u);
    } catch (e) {
      setErr(e.message || "Kunde inte logga in");
    }
    setBusy(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: T.paper, display: "grid", placeItems: "center", padding: 20, fontFamily: F.body }}>
      <form onSubmit={submit} style={{ background: T.card, border: `1px solid ${T.line}`, boxShadow: `0 18px 50px ${T.shadow}`, padding: 32, borderRadius: 22, width: "min(100%, 320px)", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 28, color: T.ink }}>Varv</div>
        <input
          autoFocus
          placeholder="Användarnamn"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{ padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${T.line}`, fontSize: 15 }}
        />
        <input
          type="password"
          placeholder="Lösenord"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${T.line}`, fontSize: 15 }}
        />
        {err && <div role="alert" style={{ color: T.warn, fontSize: 13 }}>{err}</div>}
        <button
          type="submit"
          disabled={busy || !username || !password}
          style={{ padding: "10px 12px", borderRadius: 10, border: "none", background: T.spruce, color: T.card, fontSize: 15, fontWeight: 700, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "loggar in…" : "Logga in"}
        </button>
      </form>
    </div>
  );
}

export default function Varv() {
  const [username, setUsername] = useState(() => getAuth()?.username || null);

  if (!username) return <Login onLoggedIn={setUsername} />;

  return (
    <VarvApp
      username={username}
      onLogout={() => {
        clearAuth();
        setUsername(null);
      }}
    />
  );
}

/* ============================================================ */
/* Capture sheet — the 3-second window                           */
/* ============================================================ */
function CaptureSheet({ onClose, onTask, onListItem, onIdea, onAuto, onTranscribe, aiSortingEnabled, voiceEnabled, voiceLang, onLangChange }) {
  const [v, setV] = useState("");
  const [rec, setRec] = useState(false);
  const [vBusy, setVBusy] = useState(false);
  const [vErr, setVErr] = useState("");
  const ref = useRef(null);
  const recRef = useRef(null);
  const streamRef = useRef(null);
  const s = styles;
  const dialogRef = useModalDialog(onClose);
  useEffect(() => { ref.current && ref.current.focus(); }, []); // vinner över dialogens auto-fokus på första knappen
  useEffect(() => () => {
    try { recRef.current && recRef.current.state !== "inactive" && recRef.current.stop(); } catch (e) {}
    try { streamRef.current && streamRef.current.getTracks().forEach((t) => t.stop()); } catch (e) {}
  }, []);

  const task = () => { if (v.trim()) { onTask(v.trim()); onClose(); } };
  const listItem = () => { if (v.trim()) { onListItem(v.trim()); onClose(); } };
  const idea = () => { if (v.trim()) { onIdea(v.trim()); onClose(); } };
  const auto = () => { if (v.trim()) { onAuto(v.trim()); onClose(); } };
  const primary = aiSortingEnabled ? auto : idea;

  // Riktig mikrofoninspelning → uppladdning till varv-server (KB-Whisper), inte
  // webbläsarens inbyggda taligenkänning som skickar ljudet till Google.
  const startVoice = async () => {
    setVErr("");
    if (!voiceEnabled) {
      setVErr("Rösttranskribering kräver externa AI-tjänster. Du kan alltid skriva och spara direkt.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setVErr("Mikrofonen stöds inte i den här webbläsaren — skriv istället.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setVBusy(true);
        try {
          const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
          const text = await onTranscribe(blob, voiceLang);
          // Utkast, inte fångst: talaren ser texten och väljer själv Uppgift/Idé/Inköp — sheeten stannar öppen.
          setV((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
        } catch (e) {
          setVErr(e.message || "Transkribering misslyckades — testa igen eller skriv istället.");
        }
        setVBusy(false);
      };
      recRef.current = mr;
      mr.start();
      setRec(true);
    } catch (e) {
      setVErr("Mikrofonen nekades eller kunde inte startas — skriv istället.");
    }
  };
  const stopVoice = () => {
    try { recRef.current && recRef.current.stop(); } catch (e) {}
    setRec(false);
  };

  return (
    <div style={s.sheetBackdrop} onClick={onClose}>
      <div ref={dialogRef} style={s.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Fånga en tanke">
        <div style={s.sheetHandle} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: -6 }}>
          <button
            style={{ ...s.linkBtn, fontSize: 13, color: T.soft }}
            onClick={() => onLangChange(voiceLang === "sv-SE" ? "en-US" : "sv-SE")}
          >
            röst: {voiceLang === "sv-SE" ? "svenska" : "engelska"} · byt
          </button>
          <button style={{ ...s.linkBtn, fontSize: 14 }} onClick={onClose}>Klar</button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
          <input
            ref={ref}
            style={{ ...s.captureInput, fontSize: 17, padding: "13px 16px" }}
            placeholder={rec ? "lyssnar…" : "Fånga den innan den försvinner…"}
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && primary()}
          />
          <button
            style={{ ...s.micBtn, background: rec ? T.warn : T.petrol, opacity: vBusy ? 0.5 : 1 }}
            onClick={rec ? stopVoice : startVoice}
            disabled={vBusy || !voiceEnabled}
            aria-label={rec ? "Sluta spela in" : voiceEnabled ? "Tala in" : "Rösttranskribering är avstängd"}
          >
            {vBusy ? "…" : rec ? <IconStop size={18} /> : <IconMic size={18} />}
          </button>
        </div>
        {rec && <div style={{ fontSize: 12, color: T.warn, textAlign: "center", marginTop: 6 }}>● spelar in — tala fritt, tryck ■ när du är klar</div>}
        {vBusy && <div style={{ fontSize: 12, color: T.soft, textAlign: "center", marginTop: 6 }}>transkriberar…</div>}
        {vErr && <div role="alert" style={{ fontSize: 12, color: T.warn, marginTop: 6 }}>{vErr}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button style={{ ...s.primaryBtn, flex: 1, opacity: v.trim() ? 1 : 0.5 }} disabled={!v.trim()} onClick={primary}>
            {aiSortingEnabled ? "Fånga — agenten sorterar" : "Spara som idé"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button style={{ ...s.ghostBtn, flex: 1, fontSize: 13, padding: "8px 6px", opacity: v.trim() ? 1 : 0.5 }} disabled={!v.trim()} onClick={task}>
            Uppgift
          </button>
          <button style={{ ...s.ghostBtn, flex: 1, fontSize: 13, padding: "8px 6px", opacity: v.trim() ? 1 : 0.5 }} disabled={!v.trim()} onClick={idea}>
            <IconIdea size={14} /> Idé
          </button>
          <button style={{ ...s.ghostBtn, flex: 1, fontSize: 13, padding: "8px 6px", opacity: v.trim() ? 1 : 0.5 }} disabled={!v.trim()} onClick={listItem}>
            Inköp
          </button>
        </div>
        <div style={{ fontSize: 12, color: T.soft, textAlign: "center", marginTop: 10 }}>
          {aiSortingEnabled ? "Enter = agenten sorterar åt dig. Knapparna styr själv." : "Enter = spara som idé. Uppgift och Inköp väljer du direkt."}
        </div>
      </div>
    </div>
  );
}

/* ============================================================ */
/* Energy dial — the signature element                           */
/* ============================================================ */
function EnergyDial({ budget, remaining }) {
  const pct = budget === 0 ? 0 : remaining / budget;
  const R = 56;
  const C = Math.PI * R; // half circle
  const ticks = Array.from({ length: 11 }, (_, i) => i);
  return (
    <div style={{ textAlign: "center" }}>
      <svg width="160" height="94" viewBox="0 0 160 94">
        {/* ticks */}
        {ticks.map((i) => {
          const a = Math.PI * (1 - i / 10);
          const x1 = 80 + Math.cos(a) * 70;
          const y1 = 86 - Math.sin(a) * 70;
          const x2 = 80 + Math.cos(a) * (i % 5 === 0 ? 61 : 65);
          const y2 = 86 - Math.sin(a) * (i % 5 === 0 ? 61 : 65);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={T.track} strokeWidth="1.5" />;
        })}
        <path d={`M 24 86 A ${R} ${R} 0 0 1 136 86`} fill="none" stroke={T.track} strokeWidth="9" strokeLinecap="round" />
        <path
          d={`M 24 86 A ${R} ${R} 0 0 1 136 86`}
          fill="none"
          stroke={pct > 0.35 ? T.petrol : T.warn}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${C * pct} ${C}`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
        <text x="80" y="72" textAnchor="middle" style={{ font: `500 28px ${F.mono}`, fill: T.ink }}>
          {remaining}
        </text>
        <text x="80" y="88" textAnchor="middle" style={{ font: `400 11px ${F.mono}`, fill: T.soft }}>
          of {budget}p
        </text>
      </svg>
    </div>
  );
}

function NowMarker() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0 10px" }}>
      <span style={{ font: `500 12px ${F.mono}`, color: T.petrolDark }}>{nowHM()}</span>
      <div style={{ flex: 1, height: 1, background: T.petrol, opacity: 0.5 }} />
      <span style={{ fontSize: 11, color: T.petrolDark }}>nu</span>
    </div>
  );
}

/* ============================================================ */
/* Context menu — right-click on tasks, ideas, list items       */
/* ============================================================ */
function ContextMenu({ x, y, items, onClose }) {
  const menuRef = useRef(null);
  const s = styles;

  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const handleKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Keep menu within viewport
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const nx = x + rect.width > window.innerWidth ? x - rect.width : x;
    const ny = y + rect.height > window.innerHeight ? y - rect.height : y;
    setPos({ x: Math.max(0, nx), y: Math.max(0, ny) });
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 1000,
        background: T.card,
        border: `1px solid ${T.line}`,
        borderRadius: 10,
        boxShadow: `0 8px 24px ${T.shadow}`,
        padding: "6px 0",
        minWidth: 160,
        fontFamily: F.body,
        fontSize: 14,
      }}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} style={{ height: 1, background: T.line, margin: "4px 0" }} />;
        }
        return (
          <button
            key={i}
            onClick={() => { item.action(); onClose(); }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              textAlign: "left",
              padding: "8px 16px",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: item.danger ? T.warn : T.ink,
              fontFamily: "inherit",
              fontSize: "inherit",
            }}
            // currentTarget, inte target — annars färgas SVG-ikonen istället för raden.
            onMouseEnter={(e) => e.currentTarget.style.background = T.track}
            onMouseLeave={(e) => e.currentTarget.style.background = "none"}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================ */
/* Voice Input Button — attach to any text field                 */
/* ============================================================ */
function VoiceInputButton({ onResult, language = "sv-SE", style: btnStyle }) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [fadeClass, setFadeClass] = useState("");
  const recognitionRef = useRef(null);

  const toggle = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Taligenkänning stöds inte i denna webbläsare."); return; }
    const rec = new SR();
    rec.lang = language;
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let final = "";
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      const display = final || interim;
      if (display) {
        setTranscript(display);
        setFadeClass("voice-fade-in");
        if (final) onResult(final);
      }
    };
    rec.onend = () => { setListening(false); setTimeout(() => setTranscript(""), 2000); };
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", ...btnStyle }}>
      <button
        onClick={toggle}
        title={"Talskning"}
        style={{
          width: 32, height: 32, borderRadius: "50%",
          border: `1.5px solid ${listening ? T.warn : T.line}`,
          background: listening ? T.warn : "transparent",
          color: listening ? T.textOnAccent : T.soft,
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16,
          transition: "all 0.25s ease",
          flexShrink: 0,
        }}
      >
        {listening ? <IconStop size={18} /> : <IconMic size={18} />}
      </button>
      {transcript && (
        <div
          className={fadeClass}
          style={{
            position: "absolute",
            left: 40,
            top: "50%",
            transform: "translateY(-50%)",
            background: T.card,
            border: `1px solid ${T.line}`,
            borderRadius: 8,
            padding: "4px 10px",
            fontSize: 13,
            color: T.petrol,
            whiteSpace: "nowrap",
            maxWidth: 200,
            overflow: "hidden",
            textOverflow: "ellipsis",
            pointerEvents: "none",
          }}
        >
          {listening ? transcript + "…" : transcript}
        </div>
      )}
    </div>
  );
}

/* ============================================================ */
/* Fade-in animation class (injected once)                       */
/* ============================================================ */
const voiceStyle = document.createElement("style");
voiceStyle.textContent = `
  @keyframes voiceFadeIn { from { opacity: 0; transform: translateY(-50%) translateX(-6px); } to { opacity: 1; transform: translateY(-50%) translateX(0); } }
  .voice-fade-in { animation: voiceFadeIn 0.3s ease; }
  @keyframes pulseGlow { 0%,100% { box-shadow: 0 0 0 0 var(--warning); } 50% { box-shadow: 0 0 0 8px transparent; } }
  .voice-pulse { animation: pulseGlow 1.5s infinite; }
  @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  .slide-up { animation: slideUp 0.35s ease; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .fade-in { animation: fadeIn 0.4s ease; }
  @keyframes textAppear { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  .text-appear { animation: textAppear 0.3s ease; }
`;
if (!document.getElementById("varv-voice-styles")) {
  voiceStyle.id = "varv-voice-styles";
  document.head.appendChild(voiceStyle);
}

/* ============================================================ */
/* Add task — trigger, energy, time, essential                   */
/* ============================================================ */
function AddTask({ onAdd, defaultDate }) {
  const [title, setTitle] = useState("");
  const [trigger, setTrigger] = useState("");
  const [energy, setEnergy] = useState(2);
  const [time, setTime] = useState("");
  const [essential, setEssential] = useState(false);
  const [icon, setIcon] = useState(null);
  const [pickIcon, setPickIcon] = useState(false);
  const [repeatDays, setRepeatDays] = useState([]);
  const [scheduledDate, setScheduledDate] = useState(defaultDate || todayKey());
  const [isFloater, setIsFloater] = useState(false);
  const [dueBy, setDueBy] = useState("");
  const s = styles;
  const shownIcon = icon || guessIcon(title || " ");
  const toggleDay = (key) =>
    setRepeatDays((days) => (days.includes(key) ? days.filter((d) => d !== key) : [...days, key]));
  return (
    <div style={{ ...s.card, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input style={{ ...s.input, flex: 1 }} placeholder="Vad behöver göras?" value={title} onChange={(e) => setTitle(e.target.value)} />
        <VoiceInputButton onResult={(t) => setTitle((prev) => prev ? prev + " " + t : t)} language={"sv-SE"} />
      </div>
      <button style={{ ...s.linkBtn, fontSize: 13, marginTop: 6, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setPickIcon((v) => !v)}>
        <TaskIcon name={shownIcon} size={14} /> ikon · {pickIcon ? "klar" : "ändra"}
      </button>
      {pickIcon && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {ICON_CHOICES.map((ic) => (
            <button
              key={ic}
              onClick={() => { setIcon(ic); setPickIcon(false); }}
              aria-label={`Välj ikon ${ic}`}
              aria-pressed={shownIcon === ic}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 32, height: 32, padding: 0, borderRadius: 8, cursor: "pointer",
                color: T.ink,
                border: shownIcon === ic ? `2px solid ${T.petrol}` : `1px solid ${T.line}`,
                background: shownIcon === ic ? T.accentSoft : "transparent",
              }}
            >
              <TaskIcon name={ic} size={18} />
            </button>
          ))}
        </div>
      )}
      <input
        style={s.input}
        placeholder="Om-så-trigger, t.ex. 'efter morgonkaffet' eller 'när jag kommer hem'"
        value={trigger}
        onChange={(e) => setTrigger(e.target.value)}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
        <label style={s.smallLabel}>
          energikostnad
          <select style={s.select} value={energy} onChange={(e) => setEnergy(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} — {ENERGY_LABELS[n]}
              </option>
            ))}
          </select>
        </label>
        <label style={s.smallLabel}>
          tid (valfritt)
          <input type="time" style={s.select} value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label style={{ ...s.smallLabel, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={essential} onChange={(e) => setEssential(e.target.checked)} />
          nödvändig (visas i återhämtningsläge)
        </label>
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={{ ...s.smallLabel, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={isFloater} onChange={(e) => setIsFloater(e.target.checked)} />
          flytande — inget fast datum, bara klar senast ett visst datum
        </label>
      </div>
      {isFloater ? (
        <div style={{ marginTop: 8 }}>
          <span style={s.smallLabel}>klar senast</span>
          <input
            type="date"
            style={s.select}
            value={dueBy}
            onChange={(e) => setDueBy(e.target.value)}
            min={todayKey()}
          />
          <div style={{ fontSize: 12, color: T.soft, marginTop: 4 }}>
            Syns varje dag från idag tills den bockas av — försvinner aldrig av sig själv, blir bara mer brådskande.
          </div>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 8 }}>
            <span style={s.smallLabel}>schema</span>
            <input
              type="date"
              style={s.select}
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              min={todayKey()}
            />
            {scheduledDate !== todayKey() && (
              <div style={{ fontSize: 12, color: T.soft, marginTop: 4 }}>
                schemalagt för {new Date(scheduledDate + 'T12:00:00').toLocaleDateString('sv-SE', { weekday: 'long', month: 'long', day: 'numeric' })}
              </div>
            )}
          </div>
          <div style={{ marginTop: 8 }}>
            <span style={s.smallLabel}>upprepas</span>
            <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
              {WEEKDAYS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => toggleDay(d.key)}
                  style={{
                    fontSize: 12, padding: "5px 9px", borderRadius: 8, cursor: "pointer",
                    border: `1.5px solid ${T.spruce}`,
                    background: repeatDays.includes(d.key) ? T.spruce : "transparent",
                    color: repeatDays.includes(d.key) ? T.card : T.spruce,
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {repeatDays.length > 0 && (
              <div style={{ fontSize: 12, color: T.soft, marginTop: 4 }}>
                Återkommer varje {repeatDays.map((k) => WEEKDAYS.find((d) => d.key === k).label).join(", ")} — dyker upp igen nästa gång den dagen kommer, även efter att den bockats av.
              </div>
            )}
          </div>
        </>
      )}
      <button
        style={{ ...s.primaryBtn, marginTop: 12, opacity: title.trim() && (!isFloater || dueBy) ? 1 : 0.5 }}
        disabled={!title.trim() || (isFloater && !dueBy)}
        onClick={() =>
          onAdd(isFloater
            ? { title: title.trim(), icon: shownIcon, trigger: trigger.trim(), energy, time, essential, priority: null, inbox: false, repeatDays: [], scheduled_date: null, dueBy }
            : { title: title.trim(), icon: shownIcon, trigger: trigger.trim(), energy, time, essential, priority: null, inbox: false, repeatDays, scheduled_date: scheduledDate !== todayKey() ? scheduledDate : null })
        }
      >
        Lägg till uppgift
      </button>
    </div>
  );
}

/* ============================================================ */
/* Task card with AI breakdown                                   */
/* ============================================================ */
function TaskCard({ task, onDone, onUpdate, onRemove, onWin, agentBusy, aiEnabled, initiationOpen, onStartSupport }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editNote, setEditNote] = useState(task.note || "");
  const [imgBusy, setImgBusy] = useState(false);
  const [editingSteps, setEditingSteps] = useState(false);
  const [showFocusHint, setShowFocusHint] = useState(false);
  const [focusHint, setFocusHint] = useState("");
  const s = styles;

  // Compress an image File to a base64 data-URI thumbnail (max 800px, JPEG 0.7).
  const compressImage = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 800;
        let { width, height } = img;
        if (width > max || height > max) {
          const scale = max / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const breakDown = async () => {
    setBusy(true);
    setErr("");
    try {
      const steps = await aiBreakdown(task.title, focusHint.trim());
      onUpdate({ steps });
    } catch (e) {
      setErr("Nedbrytningen misslyckades — försök igen eller lägg till steg för hand.");
    }
    setBusy(false);
  };

  const toggleStep = (id) => {
    const steps = task.steps.map((st) => (st.id === id ? { ...st, done: !st.done } : st));
    onUpdate({ steps });
    const st = task.steps.find((x) => x.id === id);
    if (st && !st.done) onWin(`Steg klart: ${st.title}`);
  };

  const updateStep = (id, patch) => {
    onUpdate({ steps: task.steps.map((st) => (st.id === id ? { ...st, ...patch } : st)) });
  };
  const removeStep = (id) => {
    onUpdate({ steps: task.steps.filter((st) => st.id !== id) });
  };
  const addStep = () => {
    const newStep = { id: uid(), title: "", minutes: 5, done: false };
    onUpdate({ steps: [...(task.steps || []), newStep] });
    setEditingSteps(true);
  };

  const stepsLeft = (task.steps || []).filter((st) => !st.done).length;
  const [popping, setPopping] = useState(false);
  const handleDone = () => {
    setPopping(true);
    setTimeout(() => setPopping(false), 280);
    onDone();
  };

  return (
    <div className={`${expanded ? "card-hoverable" : "row-hoverable"} row-settle`} style={expanded ? { ...s.card, marginTop: 10 } : s.taskRow}>
      {/* collapsed row — the whole row is the expand toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left", minWidth: 0 }}
          aria-expanded={expanded} aria-label="Visa detaljer"
        >
          <span style={s.coin}><TaskIcon name={task.icon} size={18} /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: T.ink }}>
              {task.priority && <span style={s.prioBadge}>{task.priority}</span>}
              {task.title}
            </span>
            <span style={{ display: "block", fontSize: 12, color: T.soft, marginTop: 2 }}>
              {agentBusy && (
                <span style={{ color: T.petrol, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <IconAgent size={13} /> Nedbrytaren jobbar… ·{" "}
                </span>
              )}
              {task.scheduled_date && task.scheduled_date !== todayKey() && (
                <span style={{ color: T.petrol, fontWeight: 500 }}>
                  {new Date(task.scheduled_date + 'T12:00:00').toLocaleDateString('sv-SE', { weekday: 'short', month: 'short', day: 'numeric' })} ·
                </span>
              )}
              {task.dueBy && (() => {
                const daysLeft = Math.round((new Date(task.dueBy + 'T12:00:00') - new Date(todayKey() + 'T12:00:00')) / 86400000);
                const urgent = daysLeft <= 3;
                const label = daysLeft < 0 ? `försenad ${-daysLeft}d`
                  : daysLeft === 0 ? "klar idag"
                  : `klar senast ${new Date(task.dueBy + 'T12:00:00').toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric' })}`;
                return (
                  <span style={{ color: urgent ? T.warn : T.spruce, fontWeight: 500 }}>
                    ⏳ {label} ·
                  </span>
                );
              })()}
              {task.time ? `${task.time} · ` : ""}{task.energy}p{stepsLeft > 0 ? ` · ${stepsLeft} steg kvar` : ""}{expanded ? "" : " · tryck för mer"}
            </span>
          </span>
        </button>
        <button className={popping ? "check-pop" : ""} style={s.doneBtn} onClick={handleDone} aria-label="Markera klar"><IconCheck size={18} /></button>
      </div>

      {/* expanded details */}
      {expanded && (
        <>
          {(task.trigger || task.essential || (task.tags || []).length > 0 || (task.repeatDays || []).length > 0) && (
            <div style={s.metaRow}>
              {task.trigger && <span style={s.chipSoft}>när {task.trigger}</span>}
              {task.essential && <span style={s.chipSoft}>nödvändig</span>}
              {(task.repeatDays || []).length > 0 && (
                <span style={{ ...s.chipSoft, display: "inline-flex", alignItems: "center", gap: 4 }}><IconLoop size={12} /> {task.repeatDays.map((k) => WEEKDAYS.find((d) => d.key === k).label).join(", ")}</span>
              )}
              {(task.tags || []).map((tg) => <span key={tg} style={s.chipSoft}>#{tg}</span>)}
            </div>
          )}

          {/* Time + note + image — rich details */}
          {!editing && (task.note || task.image) && (
            <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              {task.image && (
                <img src={task.image} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
              )}
              {task.note && (
                <p style={{ margin: 0, fontSize: 13, color: T.ink, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{task.note}</p>
              )}
            </div>
          )}

          {editing ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                style={{ fontSize: 14, fontFamily: F.display, fontWeight: 600, padding: '6px 8px', border: `1px solid ${T.line}`, borderRadius: 6, background: T.card }}
                placeholder="Rubrik…"
              />
              <GhostTextarea
                value={editNote}
                onChange={setEditNote}
                context={task.title}
                enabled={aiEnabled}
                rows={3}
                style={{ fontSize: 13, fontFamily: F.body, border: `1px solid ${T.line}`, borderRadius: 6, background: T.card, resize: 'vertical' }}
                placeholder="Anteckning…"
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="file"
                  accept="image/*"
                  id={`img-${task.id}`}
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setImgBusy(true);
                    try {
                      const data = await compressImage(file);
                      onUpdate({ image: data });
                    } catch (err) {
                      setErr("Kunde inte ladda bilden.");
                    }
                    setImgBusy(false);
                  }}
                />
                <button
                  type="button"
                  style={{ ...s.linkBtn, fontSize: 12 }}
                  disabled={imgBusy}
                  onClick={() => document.getElementById(`img-${task.id}`).click()}
                >
                  {imgBusy ? 'bearbetar…' : task.image ? 'byt bild' : <><IconImage size={13} /> bild</>}
                </button>
                {task.image && (
                  <button
                    type="button"
                    style={{ ...s.linkBtn, fontSize: 12, color: T.warn }}
                    onClick={() => onUpdate({ image: null })}
                  >
                    ta bort bild
                  </button>
                )}
                <div style={{ flex: 1 }} />
                <button
                  style={{ ...s.linkBtn, background: T.petrol, color: T.textOnAccent }}
                  onClick={() => {
                    onUpdate({ title: editTitle.trim() || task.title, note: editNote.trim() || null });
                    setEditing(false);
                  }}
                >spara</button>
                <button
                  style={s.linkBtn}
                  onClick={() => {
                    setEditTitle(task.title);
                    setEditNote(task.note || "");
                    setEditing(false);
                  }}
                >avbryt</button>
              </div>
            </div>
          ) : null}

          {/* Time selector — always editable in expanded view */}
          {!editing && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.soft }}>
                klockan
                <input
                  type="time"
                  value={task.time || ''}
                  onChange={(e) => onUpdate({ time: e.target.value || null })}
                  style={{ fontSize: 13, padding: '3px 6px', border: `1px solid ${T.line}`, borderRadius: 6, background: T.card, fontFamily: 'inherit' }}
                />
              </label>
              <button style={{ ...s.linkBtn, fontSize: 12 }} onClick={() => { setEditTitle(task.title); setEditNote(task.note || ''); setEditing(true); }}>
                <IconPencil size={13} /> redigera
              </button>
            </div>
          )}

          <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
            {WEEKDAYS.map((d) => {
              const active = (task.repeatDays || []).includes(d.key);
              return (
                <button
                  key={d.key}
                  onClick={() => {
                    const days = task.repeatDays || [];
                    onUpdate({ repeatDays: active ? days.filter((k) => k !== d.key) : [...days, d.key] });
                  }}
                  style={{
                    fontSize: 11, padding: "3px 7px", borderRadius: 7, cursor: "pointer",
                    border: `1.5px solid ${T.spruce}`,
                    background: active ? T.spruce : "transparent",
                    color: active ? T.card : T.spruce,
                  }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              style={{ ...s.linkBtn, minHeight: 44 }}
              onClick={onStartSupport}
              aria-expanded={initiationOpen}
            >
              {initiationOpen ? "dölj starthjälp" : "hjälp mig börja"}
            </button>
            <button style={s.linkBtn} onClick={breakDown} disabled={busy}>
              {busy ? "bryter ner…" : task.steps.length ? "bryt ner igen (AI)" : "bryt ner (AI)"}
            </button>
            <button style={{ ...s.linkBtn, fontSize: 12 }} onClick={() => setShowFocusHint((v) => !v)}>
              {showFocusHint ? "dölj fokus" : focusHint ? <><IconCheck size={12} /> fokus satt</> : "+ fokusera på något?"}
            </button>
            <button style={s.linkBtn} onClick={() => setEditingSteps((v) => !v)}>
              {editingSteps ? "klar med steg" : "redigera steg"}
            </button>
            <button style={{ ...s.linkBtn, color: T.soft }} onClick={onRemove}>ta bort</button>
          </div>
          {showFocusHint && (
            <input
              style={{ ...s.captureInput, marginTop: 8, padding: "6px 10px", fontSize: 13 }}
              placeholder="t.ex. fokusera på researchdelen, eller jag fastnar på steg 2"
              value={focusHint}
              onChange={(e) => setFocusHint(e.target.value)}
              autoFocus
            />
          )}
          {err && <div role="alert" style={{ color: T.warn, fontSize: 13, marginTop: 6 }}>{err}</div>}

          {editingSteps ? (
            <div style={{ marginTop: 8 }}>
              {task.steps.map((st, i) => (
                <div key={st.id} style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 0" }}>
                  <input
                    style={{ ...s.captureInput, flex: 1, padding: "6px 10px", fontSize: 13 }}
                    value={st.title}
                    onChange={(e) => updateStep(st.id, { title: e.target.value })}
                    placeholder={`steg ${i + 1}`}
                    aria-label={`Steg ${i + 1} titel`}
                  />
                  <input
                    type="number"
                    min="1"
                    style={{ width: 56, padding: "6px 6px", borderRadius: 8, border: `1px solid ${T.line}`, fontSize: 13, fontFamily: "inherit" }}
                    value={st.minutes}
                    onChange={(e) => updateStep(st.id, { minutes: Number(e.target.value) || 1 })}
                    aria-label={`Steg ${i + 1} minuter`}
                  />
                  <button
                    style={{ ...s.linkBtn, color: T.warn, minWidth: 44, minHeight: 44, padding: "4px 8px" }}
                    onClick={() => removeStep(st.id)}
                    aria-label={`Ta bort steg: ${st.title || `steg ${i + 1}`}`}
                  >
                    <IconClose size={14} />
                  </button>
                </div>
              ))}
              <button style={{ ...s.linkBtn, marginTop: 6 }} onClick={addStep}>+ lägg till steg</button>
            </div>
          ) : (
            task.steps.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {task.steps.map((st) => (
                  <button key={st.id} style={s.stepRow} onClick={() => toggleStep(st.id)}>
                    <span style={{ ...s.stepBox, background: st.done ? T.moss : "transparent" }}>{st.done ? <IconCheck size={13} /> : null}</span>
                    <span style={{ textDecoration: st.done ? "line-through" : "none", color: st.done ? T.soft : T.ink, textAlign: "left" }}>
                      {st.title} <span style={{ color: T.soft }}>· {st.minutes} min</span>
                    </span>
                  </button>
                ))}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

/* ============================================================ */
/* Morning lap — the daily planning ritual (Safren-style)        */
/* ============================================================ */
/* ============================================================ */
/* Sleep anchors — CBT-I basics: fixed wake, wind-down cue       */
/* ============================================================ */
function SleepPanel({ settings, onChange }) {
  const s = styles;
  return (
    <div style={{ ...s.card, marginTop: 10 }}>
      <p style={s.body}>
        Två ankare gör det mesta av jobbet: samma väckningstid varje dag (även helger), och en nedvarvningssignal när kvällens skärmar ska dämpas. Varv visar en stillsam banner efter nedvarvningen.
      </p>
      <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap" }}>
        <label style={s.smallLabel}>
          väckningstid
          <input type="time" style={s.select} value={settings.wake} onChange={(e) => onChange({ wake: e.target.value })} />
        </label>
        <label style={s.smallLabel}>
          nedvarvning börjar
          <input type="time" style={s.select} value={settings.winddown} onChange={(e) => onChange({ winddown: e.target.value })} />
        </label>
      </div>
    </div>
  );
}

/* ============================================================ */
/* Focus lap — goal declaration + timer, body-doubling friendly  */
/* ============================================================ */
function FocusLap({ taskTitle, initialGoal, initialMins, persisted, onDone, onRunning, onFocusStart, onPark, mini, onExpand }) {
  const [goal, setGoal] = useState(persisted?.goal || initialGoal || taskTitle || "");
  const [mins, setMins] = useState(persisted?.mins || initialMins || 25);
  const [est, setEst] = useState("");
  const [left, setLeft] = useState(null);
  const [park, setPark] = useState("");
  const [parked, setParked] = useState(0);
  const startedAt = useRef(persisted ? new Date(persisted.startedAt).getTime() : null);
  const timer = useRef(null);
  const s = styles;

  const runTicker = () => {
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          clearInterval(timer.current);
          return 0;
        }
        return l - 1;
      });
    }, 1000);
  };

  // Ett pågående varv överlever en omladdning — räkna ut hur mycket som återstår
  // av det redan startade passet istället för att tyst börja om på 25:00.
  useEffect(() => {
    if (!persisted) return;
    onRunning && onRunning(true);
    const elapsedSec = Math.floor((Date.now() - startedAt.current) / 1000);
    const remaining = Math.max(0, persisted.mins * 60 - elapsedSec);
    setLeft(remaining);
    if (remaining > 0) runTicker();
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => clearInterval(timer.current), []);

  const elapsedMin = () => Math.max(1, Math.round((Date.now() - startedAt.current) / 60000));

  const start = () => {
    onRunning && onRunning(true);
    startedAt.current = Date.now();
    onFocusStart && onFocusStart(goal, mins, new Date(startedAt.current).toISOString());
    setLeft(mins * 60);
    runTicker();
  };

  if (left !== null && mini)
    return (
      <button style={s.miniLap} onClick={onExpand}>
        <span style={{ font: `500 14px ${F.mono}` }}>
          {left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "klart"}
        </span>
        <span style={{ fontSize: 13, opacity: 0.85, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {left > 0 ? `varv — ${goal || "fokuserar"}` : "varvet klart — tryck för att avsluta"}
        </span>
        <span style={{ fontSize: 12, opacity: 0.7 }}>öppna ›</span>
      </button>
    );

  if (left === 0) {
    const actual = elapsedMin();
    const e = Number(est) || 0;
    return (
      <div style={{ ...s.card, marginTop: 10, textAlign: "center" }}>
        <div style={{ fontFamily: F.display, fontSize: 22 }}>Varvet klart.</div>
        <p style={s.body}>Hur långt du än kom räknas det.</p>
        {e > 0 && (
          <p style={{ ...s.body, fontFamily: F.mono }}>
            gissning {e} min · faktisk {actual} min
          </p>
        )}
        <button style={{ ...s.primaryBtn, marginTop: 8 }} onClick={() => onDone(goal, mins, e, actual)}>Notera som vinst</button>
      </div>
    );
  }

  if (left !== null)
    return (
      <div style={{ ...s.card, marginTop: 10, textAlign: "center" }}>
        <div style={{ font: `500 40px ${F.mono}`, color: T.petrolDark }}>
          {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </div>
        <div style={{ color: T.soft, marginTop: 4 }}>{goal || "fokuserar"}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <input
            style={{ ...s.captureInput, fontSize: 14 }}
            placeholder="Förströdd tanke? Parkera den här, ta den efteråt."
            value={park}
            onChange={(e) => setPark(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && park.trim()) {
                onPark && onPark(park.trim());
                setParked((n) => n + 1);
                setPark("");
              }
            }}
          />
        </div>
        {parked > 0 && (
          <div style={{ fontSize: 12, color: T.moss, marginTop: 6 }}>
            {parked} {parked > 1 ? "tankar parkerade" : "tanke parkerad"} i inkorgen — trygga, inte borta.
          </div>
        )}
        <button style={{ ...s.ghostBtn, marginTop: 12 }} onClick={() => { clearInterval(timer.current); setLeft(0); }}>
          Sluta tidigt — räknas ändå
        </button>
      </div>
    );

  return (
    <div style={{ ...s.card, marginTop: 10 }}>
      <input style={s.input} placeholder="Vad gör du detta varv? (att säga det hjälper dig börja)" value={goal} onChange={(e) => setGoal(e.target.value)} />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        {[10, 25, 45].map((m) => (
          <button key={m} onClick={() => setMins(m)} style={{ ...s.modeBtn, borderColor: T.petrol, background: mins === m ? T.petrol : "transparent", color: mins === m ? T.card : T.petrolDark }}>
            {m} min
          </button>
        ))}
      </div>
      <label style={s.smallLabel}>
        din gissning: hur många minuter tar det egentligen? (bygger tidskalibrering)
        <input type="number" min="1" style={{ ...s.select, width: 90 }} value={est} onChange={(e) => setEst(e.target.value)} placeholder="min" />
      </label>
      <p style={{ ...s.body, marginTop: 10 }}>
        Vill du ha sällskap? Kör tillsammans med en vän på samtal eller en coworkingpartner — närvaro sänker starttröskeln. Ensam funkar också.
      </p>
      <button style={{ ...s.primaryBtn, marginTop: 6 }} onClick={start}>Börja</button>
    </div>
  );
}

/* ============================================================ */
function MovementSnack({ onDone }) {
  const [idea, setIdea] = useState(() => MOVEMENT_IDEAS[Math.floor(Math.random() * MOVEMENT_IDEAS.length)]);
  const s = styles;
  return (
    <div style={{ ...s.card, marginTop: 10 }}>
      <div style={{ fontWeight: 700 }}>{idea}</div>
      <p style={s.body}>Fem minuters rörelse hjälper uppmärksamheten mätbart. Intensiteten spelar ingen roll — rörelsen gör det.</p>
      <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
        <button style={s.primaryBtn} onClick={() => onDone(idea)}>Klart (+2p)</button>
        <button style={s.linkBtn} onClick={() => setIdea(MOVEMENT_IDEAS[(MOVEMENT_IDEAS.indexOf(idea) + 1) % MOVEMENT_IDEAS.length])}>
          ett annat förslag
        </button>
      </div>
    </div>
  );
}

/* ============================================================ */
function CheckIn({ onSave, past = [] }) {
  const [what, setWhat] = useState("");
  const [thought, setThought] = useState("");
  const [kinder, setKinder] = useState("");
  const s = styles;
  return (
    <div style={{ ...s.card, marginTop: 10 }}>
      <label style={s.smallLabel}>Vad hände?</label>
      <input style={s.input} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="t.ex. kom inte igång med rapporten igen" />
      <label style={s.smallLabel}>Vad säger din hjärna om det?</label>
      <input style={s.input} value={thought} onChange={(e) => setThought(e.target.value)} placeholder="t.ex. jag är lat, jag gör alltid så här" />
      <label style={s.smallLabel}>En snällare, mer korrekt läsning</label>
      <input style={s.input} value={kinder} onChange={(e) => setKinder(e.target.value)} placeholder="t.ex. igångsättning är svårt för min hjärna — ett 5-minuterssteg skulle hjälpa" />
      <button
        style={{ ...s.primaryBtn, marginTop: 10, opacity: what && kinder ? 1 : 0.5 }}
        disabled={!what || !kinder}
        onClick={() => onSave({ id: uid(), what, thought, kinder, ts: Date.now() })}
      >
        Spara omtolkningen
      </button>
      {past.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${T.line}` }}>
          <div style={{ fontSize: 12, color: T.soft, marginBottom: 4 }}>Snällare läsningar du skrivit förut:</div>
          {past.slice(0, 2).map((c) => (
            <div key={c.id} style={{ fontSize: 13, color: T.spruce, padding: "4px 0" }}>
              "{c.kinder}"
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================ */
function WinsList({ wins, calibration = [] }) {
  const s = styles;
  const withEst = calibration.filter((c) => c.est > 0);
  const ratio = withEst.length >= 3 ? withEst.reduce((a, c) => a + c.actual / c.est, 0) / withEst.length : null;
  return (
    <div style={{ ...s.card, marginTop: 10 }}>
      {ratio && (
        <div style={{ fontSize: 13, color: T.spruce, paddingBottom: 8, borderBottom: `1px solid ${T.line}`, marginBottom: 4 }}>
          Tidskalibrering över {withEst.length} varv: saker tar ungefär {ratio.toFixed(1)}× din gissning.
          {ratio > 1.2 ? " Lägg på marginal så slutar planerna rasa." : ratio < 0.9 ? " Du överskattar — uppgifterna är mindre än de ser ut." : " Dina gissningar är nära. Lita på dem."}
        </div>
      )}
      {wins.length === 0 ? (
        <p style={s.body}>Vinster samlas här allteftersom. Steg räknas. Vila räknas.</p>
      ) : (
        wins.slice(0, 12).map((w) => {
          const d = new Date(w.ts);
          const isToday = todayKey(d) === todayKey();
          return (
            <div key={w.id} style={{ padding: "7px 0", borderBottom: `1px solid ${T.line}`, fontSize: 14 }}>
              {w.text}
              <span style={{ color: T.soft, fontSize: 12, marginLeft: 8 }}>
                {isToday
                  ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : d.toLocaleDateString("sv-SE", { month: "short", day: "numeric" })}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

/* ============================================================ */
/* Grounding breaths — box breathing, 3 minutes                  */
/* ============================================================ */
function BreathingSpace({ onDone }) {
  const TOTAL = 180;
  const [sec, setSec] = useState(null);
  const timer = useRef(null);
  const s = styles;
  useEffect(() => () => clearInterval(timer.current), []);

  const start = () => {
    setSec(0);
    timer.current = setInterval(() => {
      setSec((v) => {
        if (v + 1 >= TOTAL) { clearInterval(timer.current); return TOTAL; }
        return v + 1;
      });
    }, 1000);
  };

  if (sec === null)
    return (
      <div style={{ ...s.card, marginTop: 10 }}>
        <p style={s.body}>
          Boxandning: in på 4, håll 4, ut på 4, håll 4. Tre minuter räcker för att växla ner nervsystemet. Ögon öppna eller stängda — det som känns rätt.
        </p>
        <button style={{ ...s.primaryBtn, marginTop: 10 }} onClick={start}>Börja</button>
      </div>
    );

  if (sec >= TOTAL)
    return (
      <div style={{ ...s.card, marginTop: 10, textAlign: "center" }}>
        <div style={{ fontFamily: F.display, fontSize: 22 }}>Landat.</div>
        <button style={{ ...s.primaryBtn, marginTop: 10 }} onClick={onDone}>Klart (+1p)</button>
      </div>
    );

  const phase = Math.floor((sec % 16) / 4);
  const count = 4 - (sec % 4);
  const words = ["Andas in", "Håll", "Andas ut", "Håll"];
  const grow = phase === 0 ? 1 : phase === 2 ? 0.7 : phase === 1 ? 1 : 0.7;
  return (
    <div style={{ ...s.card, marginTop: 10, textAlign: "center" }}>
      <div
        style={{
          width: 90, height: 90, borderRadius: 45, margin: "10px auto",
          background: T.accentSoft, border: `2px solid ${T.petrol}`,
          transform: `scale(${grow})`, transition: "transform 3.5s ease-in-out",
        }}
      />
      <div style={{ fontFamily: F.display, fontSize: 22 }}>{words[phase]}</div>
      <div style={{ font: `500 16px ${F.mono}`, color: T.soft, marginTop: 4 }}>{count}</div>
      <div style={{ fontSize: 12, color: T.soft, marginTop: 8 }}>{Math.floor((TOTAL - sec) / 60)}:{String((TOTAL - sec) % 60).padStart(2, "0")} kvar</div>
    </div>
  );
}

/* ============================================================ */
/* Week review — self-monitoring with feedback                   */
/* ============================================================ */
function WeekReview({ energyLog, wins, tagLog = [] }) {
  const s = styles;
  const weekAgo = todayKey(new Date(Date.now() - 7 * 86400000));
  const tagCounts = {};
  tagLog.filter((t) => t.day >= weekAgo).forEach((t) => { tagCounts[t.tag] = (tagCounts[t.tag] || 0) + 1; });
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    const key = todayKey(d);
    const log = energyLog.filter((e) => e.day === key);
    return {
      key,
      label: d.toLocaleDateString("sv-SE", { weekday: "short", timeZone: "Europe/Stockholm" }),
      spent: log.filter((e) => e.delta > 0).reduce((a, e) => a + e.delta, 0),
      rech: log.filter((e) => e.delta < 0).reduce((a, e) => a - e.delta, 0),
      wins: wins.filter((w) => todayKey(new Date(w.ts)) === key).length,
    };
  });
  const max = Math.max(4, ...days.map((d) => d.spent + d.rech));
  const anyData = days.some((d) => d.spent || d.rech || d.wins);
  return (
    <div style={{ ...s.card, marginTop: 10 }}>
      {!anyData ? (
        <p style={s.body}>Mönster dyker upp här efter några dagars användning. Inget att döma — bara data.</p>
      ) : (
        <>
          {days.map((d) => (
            <div key={d.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
              <span style={{ font: `500 12px ${F.mono}`, color: T.soft, width: 32 }}>{d.label}</span>
              <div style={{ flex: 1, display: "flex", gap: 2, height: 10 }}>
                <div style={{ width: `${(d.spent / max) * 100}%`, background: T.petrol, borderRadius: 3 }} />
                <div style={{ width: `${(d.rech / max) * 100}%`, background: T.moss, borderRadius: 3 }} />
              </div>
              <span style={{ font: `400 11px ${F.mono}`, color: T.soft, width: 74, textAlign: "right" }}>
                −{d.spent} / +{d.rech} · {d.wins}v
              </span>
            </div>
          ))}
          <div style={{ fontSize: 12, color: T.soft, marginTop: 8 }}>
            <span style={{ color: T.petrolDark }}>■</span> förbrukat · <span style={{ color: T.moss }}>■</span> återladdat · v = vinster.
            Leta efter dagar där förbrukningen sprang före återladdningen — de lånar av nästa dag.
          </div>
          {topTags.length > 0 && (
            <>
              <div style={{ ...s.eyebrow, marginTop: 14 }}>Vad tankarna handlat om</div>
              <div style={{ ...s.metaRow, marginTop: 8 }}>
                {topTags.map(([tag, n]) => (
                  <span key={tag} style={s.chipSoft}>#{tag} × {n}</span>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ============================================================ */
/* Psychoeducation — why each tool works                         */
/* ============================================================ */
function EduCards() {
  const [i, setI] = useState(0);
  const s = styles;
  const card = EDU_CARDS[i];
  return (
    <div style={{ ...s.card, marginTop: 10 }}>
      <div style={{ ...s.eyebrow, marginBottom: 6 }}>{i + 1} / {EDU_CARDS.length}</div>
      <div style={{ fontFamily: F.display, fontWeight: 500, fontSize: 20 }}>{card.t}</div>
      <p style={{ ...s.body, fontSize: 15, marginTop: 8 }}>{card.b}</p>
      <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
        <button style={s.linkBtn} onClick={() => setI((i - 1 + EDU_CARDS.length) % EDU_CARDS.length)}>← föregående</button>
        <button style={s.linkBtn} onClick={() => setI((i + 1) % EDU_CARDS.length)}>nästa →</button>
      </div>
    </div>
  );
}

/* ============================================================ */
/* Lists — external memory: rapid add, check off, reuse          */
/* ============================================================ */
function Lists({ lists, onAddList, onRemoveList, onAddItem, onToggleItem, onResetDone, onClearDone }) {
  const [openId, setOpenId] = useState(lists[0]?.id || null);
  const [entry, setEntry] = useState("");
  const [newList, setNewList] = useState("");
  const [showNew, setShowNew] = useState(false);
  const entryRef = useRef(null);
  const s = styles;

  const addItem = (listId) => {
    if (!entry.trim()) return;
    onAddItem(listId, entry.trim());
    setEntry("");
    entryRef.current && entryRef.current.focus(); // stay in flow — add the next one immediately
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {lists.map((l) => {
          const open = l.items.filter((i) => !i.done).length;
          return (
            <button
              key={l.id}
              onClick={() => setOpenId(openId === l.id ? null : l.id)}
              style={{
                ...s.modeBtn, flex: "none", padding: "8px 14px",
                borderColor: T.petrol,
                background: openId === l.id ? T.petrol : "transparent",
                color: openId === l.id ? T.card : T.petrolDark,
              }}
            >
              {l.name}{open > 0 ? ` · ${open}` : ""}
            </button>
          );
        })}
        <button style={{ ...s.linkBtn, alignSelf: "center" }} onClick={() => setShowNew((v) => !v)}>+ ny lista</button>
      </div>

      {showNew && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input style={{ ...s.captureInput }} placeholder="Listnamn, t.ex. Packning, Apotek, Fråga Josefin" value={newList} onChange={(e) => setNewList(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newList.trim()) {
                onAddList(newList.trim());
                setNewList(""); setShowNew(false);
              }
            }} />
        </div>
      )}

      {lists.filter((l) => l.id === openId).map((l) => (
        <div key={l.id} style={{ ...s.card, marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              ref={entryRef}
              style={{ ...s.captureInput, flex: 1 }}
              placeholder={`Lägg till i ${l.name} — enter, nästa, enter, nästa…`}
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addItem(l.id)}
            />
            <VoiceInputButton onResult={(t) => { setEntry(t); setTimeout(() => addItem(l.id), 100); }} />
            <button style={{ ...s.primaryBtn, padding: "8px 14px" }} onClick={() => addItem(l.id)}>Lägg till</button>
          </div>

          {l.items.length === 0 && <p style={s.body}>Tom. Det du är rädd att glömma — lägg det här nu.</p>}

          {[...l.items].sort((a, b) => Number(a.done) - Number(b.done)).map((it) => (
            <button key={it.id} style={s.stepRow} onClick={() => onToggleItem(l.id, it.id)}>
              <span style={{ ...s.stepBox, background: it.done ? T.moss : "transparent" }}>{it.done ? <IconCheck size={13} /> : null}</span>
              <span style={{ textDecoration: it.done ? "line-through" : "none", color: it.done ? T.soft : T.ink, textAlign: "left", fontSize: 15 }}>{it.text}</span>
            </button>
          ))}

          {l.items.some((i) => i.done) && (
            <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
              <button style={s.linkBtn} onClick={() => onResetDone(l.id)}>
                återställ alla (återanvänd listan)
              </button>
              <button style={{ ...s.linkBtn, color: T.soft }} onClick={() => onClearDone(l.id)}>
                rensa avbockade
              </button>
            </div>
          )}
          {l.slug !== "shopping" && l.id !== "shopping" && l.items.length === 0 && (
            <button style={{ ...s.linkBtn, color: T.soft, marginTop: 6 }} onClick={() => { onRemoveList(l.id); setOpenId(lists[0]?.id || null); }}>
              ta bort listan
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ============================================================ */
/* Idékort — rå direkt, förfinad när AI:n hunnit, redigerbar */
/* ============================================================ */
function IdeaCard({ idea, onRefine, onToTask, onRemove, onUpdate, onContextMenu, aiEnabled }) {
  const [showRaw, setShowRaw] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(idea.title || "");
  const [editNote, setEditNote] = useState(idea.note || "");
  const [imgBusy, setImgBusy] = useState(false);
  const s = styles;
  const refined = idea.status === "klar" && idea.title;

  const compressImage = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 800;
        let { width, height } = img;
        if (width > max || height > max) {
          const scale = max / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleSave = () => {
    if (onUpdate) {
      onUpdate(idea.id, { title: editTitle.trim() || null, note: editNote.trim() || null });
    }
    setEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(idea.title || "");
    setEditNote(idea.note || "");
    setEditing(false);
  };

  return (
    <div className="card-hoverable" style={{ ...s.card, marginTop: 10 }} onContextMenu={onContextMenu}>
      {editing ? (
        /* === Edit mode === */
        <>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", color: T.soft, marginBottom: 6 }}>
            Redigera idé
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              style={{ ...s.input, fontFamily: F.display, fontWeight: 500, fontSize: 18, flex: 1 }}
              placeholder="Rubrik…"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              autoFocus
            />
            <VoiceInputButton onResult={(t) => setEditTitle((prev) => prev ? prev + " " + t : t)} />
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8 }}>
            <GhostTextarea
              containerStyle={{ flex: 1 }}
              style={{ ...s.input, minHeight: 80, marginTop: 0, resize: "vertical", fontFamily: F.body }}
              placeholder="Beskriv idén mer detaljerat…"
              value={editNote}
              onChange={setEditNote}
              context={editTitle || idea.raw}
              enabled={aiEnabled}
            />
            <VoiceInputButton onResult={(t) => setEditNote((prev) => prev ? prev + " " + t : t)} style={{ marginTop: 8 }} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={{ ...s.primaryBtn, flex: 1, minWidth: 100 }} onClick={handleSave}>Spara</button>
            <button style={{ ...s.ghostBtn }} onClick={handleCancel}>Avbryt</button>
            <input
              type="file"
              accept="image/*"
              id={`idea-img-${idea.id}`}
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setImgBusy(true);
                try {
                  const data = await compressImage(file);
                  onUpdate(idea.id, { image: data });
                } catch (err) { /* ignora */ }
                setImgBusy(false);
              }}
            />
            <button
              type="button"
              style={s.ghostBtn}
              disabled={imgBusy}
              onClick={() => document.getElementById(`idea-img-${idea.id}`).click()}
            >
              {imgBusy ? '…' : idea.image ? 'byt bild' : <><IconImage size={13} /> bild</>}
            </button>
            {idea.image && (
              <button type="button" style={{ ...s.ghostBtn, color: T.warn }} onClick={() => onUpdate(idea.id, { image: null })}>
                ta bort bild
              </button>
            )}
          </div>
        </>
      ) : refined ? (
        /* === Refined view === */
        <>
          {idea.image && (
            <img src={idea.image} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10, marginBottom: 10 }} />
          )}
          <div style={{ fontFamily: F.display, fontWeight: 500, fontSize: 19 }}>{idea.title}</div>
          {idea.note && (
            <p style={{ ...s.body, color: T.ink, fontSize: 14, marginTop: 6 }}>{idea.note}</p>
          )}
          {idea.tags.length > 0 && (
            <div style={s.metaRow}>
              {idea.tags.map((t) => <span key={t} style={s.chipSoft}>#{t}</span>)}
            </div>
          )}
        </>
      ) : (
        /* === Raw / refining / fail view === */
        <>
          <div style={{ fontFamily: F.display, fontWeight: 500, fontSize: 16, color: T.ink }}>
            {idea.raw.slice(0, 80)}{idea.raw.length > 80 ? "…" : ""}
          </div>
          {idea.raw.length > 80 && (
            <p style={{ ...s.body, color: T.soft, fontSize: 13, marginTop: 4 }}>{idea.raw}</p>
          )}
          {idea.status === "refining" && <div style={{ fontSize: 12, color: T.soft, marginTop: 6 }}><IconSparkle size={12} /> förfinas…</div>}
          {idea.status === "fail" && <div style={{ fontSize: 12, color: T.warn, marginTop: 6 }}>förfiningen misslyckades</div>}
        </>
      )}

      {/* Action row */}
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button style={s.linkBtn} onClick={onToTask}>→ uppgift</button>
        <button style={s.linkBtn} onClick={() => setEditing(true)}><IconPencil size={13} /> redigera</button>
        {refined && (
          <button style={{ ...s.linkBtn, color: T.soft }} onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? "dölj original" : "visa original"}
          </button>
        )}
        {(idea.status === "fail" || idea.status === "raw") && (
          <button style={s.linkBtn} onClick={onRefine}>förfina</button>
        )}
        <button style={{ ...s.linkBtn, color: T.soft }} onClick={onRemove}>ta bort</button>
        <span style={{ fontSize: 11, color: T.soft, marginLeft: "auto", fontFamily: F.mono }}>
          {new Date(idea.ts).toLocaleDateString("sv-SE", { month: "short", day: "numeric" })}
        </span>
      </div>
      {showRaw && (
        <div style={{ marginTop: 8, padding: "8px 10px", background: T.surfaceQuiet, borderRadius: 10, fontSize: 13, color: T.soft }}>
          {idea.raw}
        </div>
      )}
    </div>
  );
}


/* ============================================================ */
function ToolBtn({ label, sub, onClick, active }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active || false}
      style={{
        ...styles.toolBtn,
        background: active ? T.spruce : T.card,
        color: active ? T.card : T.ink,
      }}
    >
      <div style={{ fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 12, color: active ? T.textOnAccent : T.soft }}>{sub}</div>
    </button>
  );
}

/* ============================================================ */
const styles = {
  page: { minHeight: "100vh", fontFamily: F.body, color: T.ink, transition: "background 0.4s" },
  // Bredden bor i .shell-regeln i <style> så mediafrågan kan bredda den på
  // laptop — en inline maxWidth hade vunnit över stylesheetet.
  shell: { margin: "0 auto", padding: "22px 22px 132px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, paddingBottom: 14, borderBottom: `1px solid ${T.rule}`, position: "relative" },
  /* Loggan är ~16:9 (VARV med loop-motivet) — utgå från höjden så headern
     håller sig slank, och låt bredden följa. Ska dominera headern — varu-
     märket först, avatar-knappen underordnad. */
  logo: { display: "block", height: 58, width: "auto", flexShrink: 0 },
  hero: { background: T.card, border: `1px solid ${T.line}`, borderRadius: 22, padding: "24px 22px 18px", marginTop: 12, boxShadow: `0 12px 32px ${T.shadow}` },
  eyebrow: { font: `500 11px ${F.mono}`, letterSpacing: "0.12em", textTransform: "uppercase", color: T.spruce },
  section: { marginTop: 30 },
  card: { background: T.card, border: `1px solid ${T.line}`, borderRadius: 18, padding: 18, marginTop: 14, boxShadow: `0 6px 20px ${T.shadow}` },

  /* Dagboksuppslaget. Ett blad är inte en låda: det ligger direkt på pappret
     och skiljs från nästa av en hårfin linjal, som avsnitt i en anteckningsbok.
     Använd `card` bara där ytan faktiskt ligger *ovanpå* dagen — verktygs-
     paneler, dialoger — annars staplas ramar inuti ramar. */
  leaf: { marginTop: 22, paddingTop: 18, borderTop: `1px solid ${T.rule}` },
  /* Första bladet under hjälten har ingen linjal ovanför sig. */
  leafFirst: { marginTop: 18 },
  /* Varvet: en lodrät markering i vänsterkanten som binder ihop dagens rader. */
  leafLap: { marginTop: 22, paddingTop: 4, paddingLeft: 14, borderLeft: `2px solid ${T.petrol}` },
  /* Rad i en lista — skiljs av linjal, inte av egen ram. */
  rowRule: { borderTop: `1px solid ${T.rule}` },
  // Hopfälld uppgift: en rad i dagboken. Utfälld byter den till `card`, för då
  // ligger detaljerna faktiskt ovanpå dagen.
  taskRow: { borderTop: `1px solid ${T.rule}`, padding: "12px 8px", marginTop: 0 },
  body: { color: T.soft, fontSize: 14, lineHeight: 1.5, margin: "6px 0 0" },
  modeRow: { display: "flex", gap: 8, marginTop: 12 },
  modeBtn: { flex: 1, padding: "10px 6px", borderRadius: 12, border: `1.5px solid`, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  modeBlurb: { color: T.soft, fontSize: 13, marginTop: 8, textAlign: "center" },
  nextTitle: { fontFamily: F.display, fontWeight: 600, fontSize: 26, marginTop: 6, lineHeight: 1.15, letterSpacing: "-0.02em" },
  metaRow: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" },
  mono: { font: `500 13px ${F.mono}`, color: T.petrolDark },
  chip: { fontSize: 12, background: T.accentSoft, color: T.spruce, padding: "3px 9px", borderRadius: 20 },
  chipSoft: { fontSize: 12, border: `1px solid ${T.line}`, color: T.soft, padding: "2px 9px", borderRadius: 20 },
  primaryBtn: { background: T.petrol, color: T.card, border: "none", borderRadius: 11, padding: "12px 17px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: `0 4px 12px ${T.shadow}` },
  ghostBtn: { background: "transparent", color: T.petrolDark, border: `1.5px solid ${T.petrol}`, borderRadius: 12, padding: "10px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  linkBtn: { background: "none", border: "none", color: T.petrolDark, fontSize: 14, fontWeight: 700, cursor: "pointer", padding: "6px 2px", fontFamily: "inherit" },
  input: { width: "100%", boxSizing: "border-box", padding: "12px 13px", borderRadius: 11, border: `1px solid ${T.line}`, background: T.control, fontSize: 15, marginTop: 8, fontFamily: "inherit", color: T.ink, transition: "border-color 0.15s ease, box-shadow 0.15s ease" },
  select: { padding: "9px 10px", borderRadius: 10, border: `1px solid ${T.line}`, background: T.control, fontSize: 14, fontFamily: "inherit", marginTop: 4 },
  smallLabel: { display: "flex", flexDirection: "column", fontSize: 12, color: T.soft, marginTop: 8 },
  timeline: { position: "relative", marginTop: 12, paddingLeft: 2 },
  // Ryggen ligger under prickarna (vänsterkant 56 + halva prickens 9).
  timelineSpine: { position: "absolute", left: 60, top: 6, bottom: 6, width: 1, background: T.rule },
  tlRow: { display: "flex", alignItems: "center", gap: 10, padding: "7px 0" },
  tlTime: { font: `500 13px ${F.mono}`, color: T.spruce, width: 46 },
  tlDot: { width: 9, height: 9, borderRadius: 5, background: T.petrol, flexShrink: 0 },
  tlBody: { fontSize: 15 },
  bufferRow: { paddingLeft: 56, margin: "2px 0" },
  bufferOk: { fontSize: 12, color: T.moss },
  bufferWarn: { fontSize: 12, color: T.warn },
  toolGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 },
  toolBtn: { border: `1px solid ${T.line}`, borderRadius: 14, padding: "13px 12px", textAlign: "left", cursor: "pointer", fontFamily: "inherit" },
  doneBtn: { width: 44, height: 44, borderRadius: 22, border: `1.5px solid ${T.moss}`, background: "transparent", color: T.spruce, fontSize: 18, cursor: "pointer", flexShrink: 0 },
  stepRow: { display: "flex", gap: 10, alignItems: "flex-start", width: "100%", minHeight: 44, boxSizing: "border-box", background: "none", border: "none", padding: "12px 0", cursor: "pointer", fontSize: 14, fontFamily: "inherit" },
  stepBox: { width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${T.moss}`, color: T.textOnAccent, fontSize: 13, display: "grid", placeItems: "center", flexShrink: 0, marginTop: 0 },
  restItem: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", padding: "13px 2px", marginTop: 0, fontSize: 14, cursor: "pointer", fontFamily: "inherit", color: T.ink, textAlign: "left", gap: 10 },
  restPlus: { font: `500 13px ${F.mono}`, color: T.moss, flexShrink: 0 },
  footer: { textAlign: "center", color: T.soft, fontSize: 13, marginTop: 36 },
  captureRow: { display: "flex", gap: 8, marginBottom: 6 },
  captureInput: { flex: 1, boxSizing: "border-box", width: "100%", padding: "12px 14px", borderRadius: 11, border: `1.5px solid ${T.track}`, background: T.control, fontSize: 15, fontFamily: "inherit", color: T.ink, transition: "border-color 0.15s ease, box-shadow 0.15s ease" },
  winddownBanner: { background: T.night, color: T.nightText, borderRadius: 12, padding: "10px 14px", fontSize: 14, marginTop: 10 },
  medRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.line}`, flexWrap: "wrap" },
  medBtn: { background: "transparent", border: `1px solid ${T.line}`, borderRadius: 16, padding: "7px 11px", fontSize: 12, color: T.spruce, cursor: "pointer", fontFamily: "inherit" },
  medStatus: { background: "none", border: "none", color: T.spruce, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: "6px 0" },
  lapRow: { display: "flex", alignItems: "center", gap: 10, width: "100%", background: "none", border: "none", padding: "9px 0", cursor: "pointer", fontSize: 15, fontFamily: "inherit", color: T.ink },
  lapBadge: { width: 26, height: 26, borderRadius: 13, border: `1.5px solid ${T.moss}`, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 },
  prioBadge: { display: "inline-grid", placeItems: "center", width: 20, height: 20, borderRadius: 10, background: T.spruce, color: T.card, fontSize: 11, fontWeight: 700, marginRight: 8, verticalAlign: "middle" },
  nudge: { marginTop: 12, padding: "10px 12px", background: T.note, border: `1px solid ${T.noteBorder}`, borderRadius: 12, fontSize: 13, color: T.noteText, lineHeight: 1.5 },
  transitionCue: { marginTop: 14, padding: "10px 14px", background: T.info, border: `1px solid ${T.infoBorder}`, borderRadius: 12, fontSize: 14, color: T.petrolDark, lineHeight: 1.5 },
  unstickBox: { marginTop: 12, padding: "12px 14px", background: T.note, border: `1px solid ${T.noteBorder}`, borderRadius: 12 },
  syncRow: { display: "flex", gap: 8, marginTop: 12 },
  micBtn: { width: 48, height: 48, borderRadius: 24, border: "none", color: T.textOnAccent, fontSize: 20, cursor: "pointer", flexShrink: 0, display: "grid", placeItems: "center" },
  /* Ytorna är till för ikonerna — inte för text. Behåll fontSize på elementet
     i fall någon renderar en sträng här inne (bakåtkompatibilitet), men sätt
     color så SVG-ikonerna får samma färg som omgivande text i mörkt läge. */
  coin: { width: 32, height: 32, borderRadius: 10, background: T.surfaceQuiet, border: `1px solid ${T.line}`, display: "grid", placeItems: "center", fontSize: 16, color: T.ink, flexShrink: 0 },
  coinLg: { width: 42, height: 42, borderRadius: 13, background: T.surfaceQuiet, border: `1px solid ${T.line}`, display: "grid", placeItems: "center", fontSize: 21, color: T.ink, flexShrink: 0 },
  nav: { position: "fixed", bottom: 0, left: 0, right: 0, height: 68, background: "color-mix(in srgb, var(--surface) 92%, transparent)", backdropFilter: "blur(16px)", borderTop: `1px solid ${T.line}`, boxShadow: "0 -8px 24px rgba(24, 42, 49, 0.06)", display: "flex", justifyContent: "space-around", alignItems: "center", maxWidth: "100%", zIndex: 40, paddingBottom: "env(safe-area-inset-bottom)" },
  navBtn: { position: "relative", minWidth: 52, minHeight: 48, background: "none", border: "none", fontSize: 12, fontFamily: "inherit", cursor: "pointer", padding: "8px 10px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, letterSpacing: "0.01em" },
  navDash: { width: 20, height: 3, borderRadius: 2, background: T.petrol, display: "block" },
  navDot: { position: "absolute", top: 8, right: 8, width: 8, height: 8, borderRadius: 4, background: T.warn },
  navPlus: { width: 52, height: 52, borderRadius: 17, background: T.petrol, color: T.card, border: "none", fontSize: 26, fontWeight: 400, cursor: "pointer", lineHeight: 1, boxShadow: `0 6px 16px ${T.shadow}` },
  sheetBackdrop: { position: "fixed", inset: 0, background: T.overlay, zIndex: 50, display: "flex", alignItems: "flex-end" },
  sheet: { background: T.card, borderRadius: "20px 20px 0 0", padding: "10px 16px 26px", width: "100%", maxWidth: 560, margin: "0 auto", boxSizing: "border-box" },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, background: T.track, margin: "4px auto 14px" },
  toast: { position: "fixed", bottom: 122, left: "50%", transform: "translateX(-50%)", background: T.spruce, color: T.textOnAccent, padding: "9px 16px", borderRadius: 20, fontSize: 13, zIndex: 45, maxWidth: "85%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", boxShadow: `0 2px 10px ${T.shadow}` },
  miniLap: { position: "fixed", bottom: 66, left: 0, right: 0, maxWidth: 560, margin: "0 auto", background: T.petrolDark, color: T.textOnAccent, border: "none", padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", zIndex: 39, fontFamily: "inherit", borderRadius: "12px 12px 0 0" },
};
