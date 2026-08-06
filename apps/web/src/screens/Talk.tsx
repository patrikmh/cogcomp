import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { usePreferences } from "@/state/preferences";

/**
 * Talk it through.
 *
 * The agent's job is to help someone say what they mean, not to interpret it —
 * interpretation stays downstream in the extraction pipeline where it is
 * schema-constrained, confidence-scored, and visible on the explain screen.
 *
 * Two rules hold it in place, and both are enforced by the server: only the
 * person's turns become entries, and if someone discloses risk of serious harm
 * the agent stops eliciting and the locally-configured services are shown.
 *
 * The canvas is the prototype's harmonic avatar — nested contour rings whose
 * amplitude follows what the conversation is doing. It reports state; it does
 * not perform a personality.
 */
type Mode = "idle" | "thinking" | "speaking" | "stopped";

/** Loudness at this instant, 0–1, read from the server-measured envelope by
 *  playback position. Shared with the canvas through a ref so the animation
 *  never re-renders React on a frame. */
interface Envelope {
  values: number[];
  frameMs: number;
  startedAt: number;
}

interface Turn {
  speaker: "user" | "assistant";
  content: string;
}

export function Talk() {
  const client = useQueryClient();
  const [conversation, setConversation] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [crisis, setCrisis] = useState<string[] | null>(null);
  const speakAloud = usePreferences((s) => s.voice);
  const canvas = useRef<HTMLCanvasElement>(null);
  const envelope = useRef<Envelope | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useAvatar(canvas, mode, envelope);

  const begin = useMutation({
    mutationFn: () => api.startConversation(),
    onSuccess: (started) => setConversation(started.id),
  });

  const say = useMutation({
    mutationFn: async (content: string) => {
      setTurns((t) => [...t, { speaker: "user", content }]);
      setMode("thinking");
      return api.say(conversation!, content);
    },
    onSuccess: async (reply) => {
      setTurns((t) => [...t, { speaker: "assistant", content: reply.reply }]);
      if (reply.crisis) {
        // Elicitation stops entirely. Nothing is spoken over the top of it.
        setCrisis(reply.crisis_resources);
        setMode("stopped");
        return;
      }
      if (!speakAloud) {
        // Spoken replies are switched off. The reply is still there to read.
        setMode("idle");
        return;
      }
      setMode("speaking");
      try {
        const clip = await api.speak(reply.reply);
        const el = new Audio(`data:audio/wav;base64,${clip.audio}`);
        audio.current = el;
        envelope.current = {
          values: clip.envelope,
          frameMs: clip.frame_ms,
          startedAt: performance.now(),
        };
        el.onended = () => {
          envelope.current = null;
          setMode("idle");
        };
        await el.play();
      } catch {
        // Speech is optional: with no voice configured the server says so, and
        // the reply is still there to read.
        envelope.current = null;
        setTimeout(() => setMode((m) => (m === "speaking" ? "idle" : m)), 900);
      }
    },
    onError: () => setMode("idle"),
  });

  const close = useMutation({
    mutationFn: () => api.closeConversation(conversation!),
    onSuccess: (result) => {
      setConversation(null);
      setTurns([]);
      setMode("idle");
      // Only the person's turns became entries; the journal has to be told.
      void client.invalidateQueries({ queryKey: ["observations"] });
      alert(
        `${result.turns_converted} of your turns became entries. The agent's turns did not — they never do.`,
      );
    },
  });

  return (
    <div className="talk-stage">
      <canvas id="avatar" ref={canvas} width={720} height={720} aria-hidden />

      <div className="talk-caption mono">
        {mode === "idle" && conversation && "Listening."}
        {mode === "thinking" && "Thinking."}
        {mode === "speaking" && "Speaking."}
        {mode === "stopped" && "Stopped asking."}
        {!conversation && "Not started."}
      </div>

      {!conversation ? (
        <button
          className="btn go on talk-begin"
          disabled={begin.isPending}
          onClick={() => begin.mutate()}
        >
          {begin.isPending ? "…" : "BEGIN"}
        </button>
      ) : (
        <>
          <div className="t-main">
            {turns.map((turn, i) => (
              <div key={i} className={turn.speaker === "user" ? "quote" : "card"}>
                <p>{turn.content}</p>
                {turn.speaker === "assistant" && (
                  <span className="mono" style={{ color: "var(--faint)" }}>
                    the agent · never becomes an entry
                  </span>
                )}
              </div>
            ))}
          </div>

          {crisis && (
            <div className="talk-crisis card">
              <b>If you are at risk right now</b>
              {crisis.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}

          <div className="talk-input row">
            <input
              className="f-field"
              value={draft}
              placeholder="Say it however it comes out"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) {
                  say.mutate(draft.trim());
                  setDraft("");
                }
              }}
            />
            <button
              className="btn"
              onClick={() => {
                audio.current?.pause();
                close.mutate();
              }}
            >
              CLOSE
            </button>
          </div>
          <p className="mono" style={{ color: "var(--faint)" }}>
            Closing keeps your turns as entries. The agent's phrasing never becomes evidence about
            you.
          </p>
        </>
      )}
    </div>
  );
}

/** Nested harmonic rings, amplitude driven by what the conversation is doing —
 *  and, while it speaks, by the actual loudness of the words being said. */
function useAvatar(
  ref: React.RefObject<HTMLCanvasElement | null>,
  mode: Mode,
  envelope: React.RefObject<Envelope | null>,
) {
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let raf = 0;

    const draw = () => {
      frame += 1;
      const t = frame / 60;
      let energy = mode === "thinking" ? 0.55 : mode === "stopped" ? 0.15 : 0.32;
      const env = envelope.current;
      if (env) {
        // Interpolated by playback position rather than stepped, so the shape
        // moves with the voice instead of ticking along beside it.
        const at = (performance.now() - env.startedAt) / env.frameMs;
        const i = Math.floor(at);
        const lerp = at - i;
        const a = env.values[Math.min(i, env.values.length - 1)] ?? 0;
        const b = env.values[Math.min(i + 1, env.values.length - 1)] ?? a;
        energy = 0.3 + (a + (b - a) * lerp) * 1.5;
      } else if (mode === "speaking") {
        energy = 1;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = mode === "stopped" ? "#5f6b68" : "#a7c3c8";
      for (let ring = 0; ring < 9; ring++) {
        const base = 60 + ring * 32;
        ctx.globalAlpha = 0.16 + (1 - ring / 9) * 0.4;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (let i = 0; i <= 90; i++) {
          const th = (i / 90) * Math.PI * 2;
          const wobble =
            Math.sin(th * 3 + t * 1.1 + ring * 0.4) * 0.05 +
            Math.sin(th * 5 - t * 0.7 + ring * 0.2) * 0.03;
          const r = base * (1 + wobble * energy);
          const x = canvas.width / 2 + Math.cos(th) * r;
          const y = canvas.height / 2 + Math.sin(th) * r * 0.92;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [ref, mode, envelope]);
}
