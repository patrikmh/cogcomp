import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";

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
  const canvas = useRef<HTMLCanvasElement>(null);

  useAvatar(canvas, mode);

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
    onSuccess: (reply) => {
      setTurns((t) => [...t, { speaker: "assistant", content: reply.reply }]);
      setMode(reply.crisis ? "stopped" : "speaking");
      if (reply.crisis) setCrisis(reply.crisis_resources);
      setTimeout(() => setMode((m) => (m === "speaking" ? "idle" : m)), 1200);
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
            <button className="btn" onClick={() => close.mutate()}>
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

/** Nested harmonic rings, amplitude driven by what the conversation is doing. */
function useAvatar(ref: React.RefObject<HTMLCanvasElement | null>, mode: Mode) {
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
      const energy = mode === "speaking" ? 1 : mode === "thinking" ? 0.55 : mode === "stopped" ? 0.15 : 0.32;
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
  }, [ref, mode]);
}
