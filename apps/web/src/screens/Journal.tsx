import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Empty, Failed, Loading } from "@/components/States";
import { Seal } from "@/lib/seal";
import { api, type Observation } from "@/lib/api";
import { clockOf, dayLabelOf } from "@/lib/format";
import { useSession } from "@/state/session";

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
            {list.length} {list.length === 1 ? "act" : "acts"} kept
          </span>
        </div>

        {entries.isLoading ? (
          <Loading label="Reading the journal…" />
        ) : entries.isError ? (
          <Failed />
        ) : list.length === 0 ? (
          <Empty label="Nothing written yet. What you write here stays here." />
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
                      <div className="j-meta">
                        <Link to={`/node/${entry.id}`} className="mono">
                          what was drawn from this →
                        </Link>
                        {entry.source === "voice" && <span className="j-chip mono">spoken</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <div id="dock">
        <textarea
          ref={box}
          id="cap"
          value={text}
          placeholder="What happened?"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a newline — the prototype's contract.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (text.trim()) save.mutate(text.trim());
            }
          }}
        />
        <div className="row" id="capmeta">
          <button
            id="mic"
            className="btn"
            data-rec={recording ? "" : undefined}
            onClick={() => void toggleRecording()}
          >
            {recording ? "STOP" : speak.isPending ? "TRANSCRIBING…" : "HOLD TO RECORD"}
          </button>
          <span className="mono" style={{ color: "var(--faint)" }}>
            {note ??
              (save.isError
                ? "Not saved — your words are still here. Try again."
                : text.trim()
                  ? `${text.trim().split(/\s+/).length} words · Enter to keep`
                  : "Kept on this account. Nothing is shared.")}
          </span>
          <button
            id="send"
            className={`btn go${text.trim() ? " on" : ""}`}
            disabled={!text.trim() || save.isPending}
            onClick={() => save.mutate(text.trim())}
          >
            {save.isPending ? "KEEPING…" : "SEND"}
          </button>
        </div>
      </div>
    </>
  );
}
