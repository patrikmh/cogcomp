import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { DrawnMeta } from "@/components/DrawnMeta";
import { Empty, Failed, Loading } from "@/components/States";
import { Seal } from "@/lib/seal";
import { api, type Observation } from "@/lib/api";
import { useAmong, useAmongThemes, useDrawnFrom } from "@/lib/drawn-from";
import { patternDestination } from "@/lib/patterns";
import { clockOf, dayLabelOf, localDay, weeksBackForOldest, withinReadingsWindow } from "@/lib/format";
import { useSession } from "@/state/session";
import { usePreferences } from "@/state/preferences";
import { EMPTY as EMPTY_COPY } from "@tlon/copy/empty";
import { deletePendingVoice, listPendingVoice, putPendingVoice, type PendingVoiceEnvelope } from "@/lib/pendingVoice";

export async function extractIfFindingsEnabledAfterSave(
  save: Promise<Pick<Observation, "id">>,
  refresh?: () => void,
) {
  const created = await save;
  if (!usePreferences.getState().findings) return;
  void api.extract(created.id)
    .then(() => {
      // Refetch when extraction RESOLVES, not alongside the save: refreshing
      // before the pipeline finishes re-reads a graph without the readings
      // and shows "nothing drawn" until some unrelated refetch happens by.
      refresh?.();
    })
    .catch(() => undefined);
}

/**
 * The journal.
 *
 * Writing wins: the composer is pinned under the thumb with nothing stacked
 * above it explaining what a journal is. What you have written is the stream
 * above, newest first, each act stamped with its own seal.
 *
 * Every entry here is real — `GET /v1/observations` — and saving posts to the
 * server before it appears. The id is minted on the device so a retry after a
 * dropped connection resolves to the same entry rather than a second copy of
 * the same thought.
 */
export function Journal() {
  const userId = useSession((s) => s.userId);
  const showFindings = usePreferences((s) => s.findings);
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [recording, setRecording] = useState<{ since: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const textIds = useRef(new Map<string, string>());
  const voiceIds = useRef(new WeakMap<Blob, string>());
  const [pendingVoice, setPendingVoice] = useState<PendingVoiceEnvelope[]>([]);
  const [voiceDurability, setVoiceDurability] = useState<string | null>(null);
  type Envelope = { id: string; content: string; source: "text"; capturedAt: string; timezone: string };
  const pendingKey = `tlon.pending-capture.${userId ?? "anonymous"}`;
  const pending = useRef<Envelope[]>([]);
  const [pendingText, setPendingText] = useState<Envelope[]>([]);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const loadPending = () => {
    try { return JSON.parse(localStorage.getItem(pendingKey) ?? "[]") as Envelope[]; } catch { return []; }
  };
  const remember = (envelope: Envelope) => {
    pending.current = [...loadPending().filter((item) => item.id !== envelope.id), envelope];
    localStorage.setItem(pendingKey, JSON.stringify(pending.current));
    setPendingText((items) => [...items.filter((item) => item.id !== envelope.id), envelope]);
  };
  const forget = (id: string) => {
    pending.current = loadPending().filter((item) => item.id !== id);
    localStorage.setItem(pendingKey, JSON.stringify(pending.current));
  };

  useEffect(() => {
    const restored = loadPending();
    pending.current = restored;
    const timer = setTimeout(() => setPendingText(restored), 0);
    for (const envelope of restored) textIds.current.set(envelope.content, envelope.id);
    // loadPending is scoped to pendingKey, so including the function itself would
    // reload on every render.
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  const entries = useQuery({
    queryKey: ["observations", userId],
    queryFn: () => api.observations(60),
  });

  // The window of weekly summaries must cover the oldest kept act, or older
  // entries would claim "nothing drawn" about readings that exist.
  const weeksBack = weeksBackForOldest(entries.data?.observations.at(-1)?.captured_at, localDay());
  const drawnFrom = useDrawnFrom(weeksBack, showFindings);
  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: api.patterns,
    enabled: showFindings,
  });
  const themes = useQuery({
    queryKey: ["themes", userId],
    queryFn: api.themes,
    enabled: showFindings,
  });
  const among = useAmong(patterns.data ?? [], weeksBack, showFindings);
  const amongThemes = useAmongThemes(themes.data ?? [], weeksBack, showFindings);

  const save = useMutation({
    mutationFn: async (envelope: Envelope) => {
      remember(envelope);
      const save = api.createObservation(envelope);
      const created = await save;
      // Extraction is what turns an act into readings; the journal does not
      // wait for it, but it does ask. Read the store after the request: the
      // preference may have changed while the observation was being saved.
      void extractIfFindingsEnabledAfterSave(save, () => {
        void client.invalidateQueries({ queryKey: ["observations", userId] });
        void client.invalidateQueries({ queryKey: ["summary"] });
      });
      return created;
    },
    onSuccess: (created, envelope) => {
      forget(created.id);
      setPendingText((items) => items.filter((item) => item.id !== envelope.id));
      textIds.current.delete(envelope.content);
      setText("");
      void client.invalidateQueries({ queryKey: ["observations", userId] });
      void client.invalidateQueries({ queryKey: ["summary"] });
    },
  });

  const speak = useMutation({
    mutationFn: async ({ audio, id }: { audio: Blob; id: string }) => {
      const capturedUserId = useSession.getState().userId;
      const capturedToken = useSession.getState().token;
      if (!capturedUserId || !capturedToken) throw new Error("session changed");
      const envelope: PendingVoiceEnvelope = { id, userId: capturedUserId, source: "journal", audio, capturedAt: new Date().toISOString(), timezone };
      await putPendingVoice(envelope);
      if (useSession.getState().userId !== capturedUserId || useSession.getState().token !== capturedToken) {
        throw new Error("session changed");
      }
      setPendingVoice((items) => items.some((item) => item.id === id) ? items : [...items, envelope]);
      return api.createVoiceObservation(envelope, capturedToken);
    },
    onSuccess: (created, { audio }) => {
      if (useSession.getState().userId !== userId) return;
      void deletePendingVoice({ userId: userId!, source: "journal", id: created.id });
      setPendingVoice((items) => items.filter((item) => item.id !== created.id));
      voiceIds.current.delete(audio);
      setNote(`Recording kept on device · transcribed · ${created.content.length} characters`);
      void client.invalidateQueries({ queryKey: ["observations", userId] });
      // A transcript is an entry like a typed one, so its readings grow the
      // same way — behind the person's back, not in front of their patience.
      // Without this, spoken entries stayed undrawn forever and could never
      // feed a pattern.
      if (usePreferences.getState().findings) void api.extract(created.id).catch(() => undefined);
    },
    onError: () => setNote("Could not transcribe that. Retry the recording or discard it."),
  });

  const retryVoice = async (envelope: PendingVoiceEnvelope) => {
    try {
      const created = await api.createVoiceObservation(envelope);
      await deletePendingVoice(envelope);
      setPendingVoice((items) => items.filter((item) => item.id !== envelope.id));
      setNote(`Recording kept on device · transcribed · ${created.content.length} characters`);
      void client.invalidateQueries({ queryKey: ["observations", userId] });
      // The retry path reaches the same place as the first save, readings
      // included.
      if (usePreferences.getState().findings) void api.extract(created.id).catch(() => undefined);
    } catch { setNote("Could not transcribe that. Retry the recording or discard it."); }
  };

  useEffect(() => {
    if (!userId) return;
    void listPendingVoice(userId, "journal").then(setPendingVoice).catch(() => setVoiceDurability("Voice recovery is unavailable in this browser; the recording cannot be retained."));
  }, [userId]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  // Arriving at the journal means you came here to write. The caret is already
  // in the composer, so the first keystroke is the first word rather than a
  // navigation shortcut fired at nothing. `preventScroll` matters: the dock is
  // the last thing on a long page, and focusing it without this scrolled the
  // stream out of sight, so you arrived at the bottom of your own journal.
  useEffect(() => {
    box.current?.focus({ preventScroll: true });
  }, []);

  async function toggleRecording() {
    if (recorder.current) {
      recorder.current.stop();
      recorder.current = null;
      setRecording(null);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (ev) => chunks.push(ev.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const audio = new Blob(chunks, { type: mr.mimeType });
        const id = crypto.randomUUID();
        voiceIds.current.set(audio, id);
        speak.mutate({ audio, id });
      };
      mr.start();
      recorder.current = mr;
      setRecording({ since: Date.now() });
      setNote(null);
    } catch {
      setNote("No microphone available. Type instead.");
    }
  }

  const list: Observation[] = entries.data?.observations ?? [];
  const groups: { day: string; list: Observation[] }[] = [];
  for (const entry of list) {
    const day = dayLabelOf(entry.captured_at);
    const group = groups.find((g) => g.day === day);
    if (group) group.list.push(entry);
    else groups.push({ day, list: [entry] });
  }

  return (
    <>
      <div className="j-stream">
        <div className="j-head">
          <span className="kicker">Journal</span>
          <span className="mono" style={{ color: "var(--faint)" }}>
            {/* Not "0 acts kept" when the request failed: that is a claim about
                the record, and we do not know it. */}
            {entries.isSuccess ? `${list.length} ${list.length === 1 ? "act" : "acts"} kept` : ""}
          </span>
        </div>

        {entries.isLoading ? (
          <Loading label="Reading the journal…" />
        ) : entries.isError ? (
          <Failed onRetry={() => void entries.refetch()} />
        ) : list.length === 0 ? (
          <Empty label={EMPTY_COPY.journal} />
        ) : (
          groups.map((group, gi) => (
            <div key={group.day}>
              <div className="j-day" style={{ animationDelay: `${Math.min(gi * 55, 700)}ms` }}>
                <span className="kicker">{group.day}</span>
                <span className="rule" />
              </div>
              {group.list.map((entry, i) => (
                <div
                  key={entry.id}
                  className={`j-entry${gi === 0 && i === 0 ? " latest" : ""}`}
                  style={{ animationDelay: `${Math.min(gi * 55 + i * 40, 700)}ms` }}
                >
                  <span className="j-time">{clockOf(entry.captured_at)}</span>
                  <span className="j-spine">
                    <span className="j-dot" />
                  </span>
                  <div className="j-act">
                    <Seal id={entry.id} />
                    <div>
                      {gi === 0 && i === 0 && (
                        <span className="kicker" style={{ display: "block", marginBottom: 8 }}>
                          Latest · saved
                        </span>
                      )}
                      <p>{entry.content}</p>
                      {showFindings && (
                        (drawnFrom.get(entry.id)?.length ?? 0) > 0 ? (
                          <DrawnMeta readings={drawnFrom.get(entry.id)!} confidence />
                        ) : withinReadingsWindow(entry.captured_at, localDay(), weeksBack) ? (
                          <div className="j-meta">
                            <Link to={`/node/${entry.id}`} className="j-from">
                              nothing drawn from this yet →
                            </Link>
                          </div>
                        ) : null
                      )}
                      {showFindings && (among.get(entry.id)?.length ?? 0) > 0 && (
                        <div className="j-meta">
                          <span className="j-from">this act is among</span>
                          {among.get(entry.id)!.map((pattern) => (
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
                      {showFindings && (amongThemes.get(entry.id)?.length ?? 0) > 0 && (
                        <div className="j-meta">
                          <span className="j-from">this act is in</span>
                          {amongThemes.get(entry.id)!.map((theme) => (
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
          ))
        )}
      </div>

      {/* One bar, not a field with controls loose underneath: the textarea and
          both buttons share a single border that lights on focus, so writing
          and keeping read as one gesture. `#capmeta` below is commentary and
          never contains a control. */}
      <div id="dock">
        <div id="cap">
          <textarea
            ref={box}
            id="capText"
            rows={1}
            value={text}
            placeholder="Write what happened"
            aria-label="Journal entry"
            aria-describedby="capGuidance"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter is a newline — the prototype's contract.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (text.trim()) {
                  const content = text.trim();
                  const id = textIds.current.get(content) ?? crypto.randomUUID();
                  textIds.current.set(content, id);
                  save.mutate({ id, content, source: "text", capturedAt: new Date().toISOString(), timezone });
                }
              }
            }}
          />
          {/* The keyboard contract, said to screen readers and not to the
              placeholder. A placeholder carrying its own instructions is a
              placeholder nobody finishes reading. */}
          <span id="capGuidance" className="sr-only">
            Press Enter to send. Press Shift+Enter for a new line.
          </span>
          <button
            id="mic"
            data-rec={recording ? "" : undefined}
            aria-label={recording ? "Stop recording" : "Start recording"}
            onClick={() => void toggleRecording()}
          >
            {/* The dot is the state: lit while the microphone is actually open.
                "Is it listening?" must never be a question in an app people use
                to talk about difficult things. */}
            <span className="dot" aria-hidden />
            <span className="cap-label">
              {recording ? "LISTENING" : speak.isPending ? "TRANSCRIBING…" : ""}
            </span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
            </svg>
          </button>
          {/* Hidden until there is something to send, rather than shown greyed:
              a control you cannot use is noise on the one screen that should be
              only writing. */}
          <button
            id="send"
            className={text.trim() && !save.isPending ? "on" : ""}
            disabled={!text.trim() || save.isPending}
            onClick={() => {
              const content = text.trim();
              const id = textIds.current.get(content) ?? crypto.randomUUID();
              textIds.current.set(content, id);
              save.mutate({ id, content, source: "text", capturedAt: new Date().toISOString(), timezone });
            }}
            aria-label="Send journal entry"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12h15M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
        {/* One quiet line, as the design has it — not a kicker and a sentence.
            "CAPTURE" labelled a section that is a single field. */}
        {voiceDurability && <div role="alert">{voiceDurability}</div>}
        {pendingVoice.length > 0 && <div role="status" className="mono">{pendingVoice.map((item) => <span key={item.id}>Recording waiting to be saved. <button onClick={() => void retryVoice(item)}>Retry</button>{" "}<button onClick={() => void deletePendingVoice(item).then(() => setPendingVoice((items) => items.filter((candidate) => candidate.id !== item.id)))}>Discard</button>{" "}</span>)}</div>}
        {pendingText.length > 0 && (
          <div role="status" className="mono">
            {pendingText.map((item) => (
              <div key={item.id}>
                Journal entry waiting to be saved. <button type="button" onClick={() => save.mutate(item)}>Retry</button>{" "}
                <button type="button" onClick={() => { forget(item.id); setPendingText((items) => items.filter((candidate) => candidate.id !== item.id)); }}>Discard</button>
              </div>
            ))}
          </div>
        )}
        <div id="capState" role="status" aria-live="polite" aria-atomic="true">
          <span>
            {note ??
              (save.isError
                ? "Not saved — your words are still here. Try again."
                : text.trim()
                  ? `${text.trim().split(/\s+/).length} words · Enter to keep`
                  : "Kept the moment you send it. Ids are minted here.")}
          </span>
        </div>
      </div>
    </>
  );
}
