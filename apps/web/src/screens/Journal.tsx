import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Empty, Failed, Loading } from "@/components/States";
import { Seal } from "@/lib/seal";
import { api, type Observation } from "@/lib/api";
import { useDrawnFrom } from "@/lib/drawn-from";
import { clockOf, dayLabelOf, fmt } from "@/lib/format";
import { useSession } from "@/state/session";
import { EMPTY as EMPTY_COPY } from "@tlon/copy/empty";

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
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [recording, setRecording] = useState<{ since: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  const entries = useQuery({
    queryKey: ["observations", userId],
    queryFn: () => api.observations(60),
  });

  const drawnFrom = useDrawnFrom();

  const save = useMutation({
    mutationFn: async (content: string) => {
      const created = await api.createObservation({
        id: crypto.randomUUID(),
        content,
        capturedAt: new Date().toISOString(),
      });
      // Extraction is what turns an act into readings; the journal does not
      // wait for it, but it does ask.
      void api.extract(created.id).catch(() => undefined);
      return created;
    },
    onSuccess: () => {
      setText("");
      void client.invalidateQueries({ queryKey: ["observations", userId] });
      void client.invalidateQueries({ queryKey: ["summary"] });
    },
  });

  const speak = useMutation({
    mutationFn: (audio: Blob) =>
      api.createVoiceObservation({
        id: crypto.randomUUID(),
        audio,
        capturedAt: new Date().toISOString(),
      }),
    onSuccess: (created) => {
      setNote(`Recording kept on device · transcribed · ${created.content.length} characters`);
      void client.invalidateQueries({ queryKey: ["observations", userId] });
    },
    onError: () => setNote("Could not transcribe that. The recording was not kept."),
  });

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
        speak.mutate(new Blob(chunks, { type: mr.mimeType }));
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
          <Failed />
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
                      {(drawnFrom.get(entry.id)?.length ?? 0) > 0 ? (
                        <div className="j-meta">
                          <span className="j-from">drawn from this</span>
                          {drawnFrom.get(entry.id)!.map((r) => (
                            <Link
                              key={r.id}
                              className={`j-chip${r.tentative ? " ghost" : ""}`}
                              to={`/node/${r.id}`}
                            >
                              {r.label} · {fmt(r.confidence)}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <div className="j-meta">
                          <Link to={`/node/${entry.id}`} className="j-from">
                            nothing drawn from this yet →
                          </Link>
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
                if (text.trim()) save.mutate(text.trim());
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
            onClick={() => save.mutate(text.trim())}
            aria-label="Send journal entry"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12h15M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
        {/* One quiet line, as the design has it — not a kicker and a sentence.
            "CAPTURE" labelled a section that is a single field. */}
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
