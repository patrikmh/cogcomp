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
  /** What the last closed conversation left behind, shown where it happened. */
  const [kept, setKept] = useState<string | null>(null);
  const speakAloud = usePreferences((s) => s.voice);
  const canvas = useRef<HTMLCanvasElement>(null);
  const envelope = useRef<Envelope | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useAvatar(canvas, mode, envelope);

  const begin = useMutation({
    mutationFn: () => api.startConversation(),
    onSuccess: (started) => {
      // The last conversation's receipt belongs to the last conversation.
      setKept(null);
      setConversation(started.id);
    },
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
      // Said on the page, not in a system dialog. An `alert` is unstyled, seizes
      // the window and has to be dismissed before anything else can happen —
      // an interruption, where this is a receipt for something the person
      // already asked for.
      setKept(
        result.turns_converted === 1
          ? "One turn of yours became an entry. The agent's did not — they never do."
          : `${result.turns_converted} turns of yours became entries. The agent's did not — they never do.`,
      );
    },
  });

  return (
    <div className="talk-stage">
      <canvas id="avatar" ref={canvas} width={720} height={720} aria-hidden />

      <p className="talk-caption mono" aria-live="polite">
        {kept
          ? kept
          : !conversation
          ? ""
          : mode === "thinking"
            ? "Thinking."
            : mode === "speaking"
              ? "Speaking."
              : mode === "stopped"
                ? "Stopped asking. Nothing more will be asked of you."
                : "Listening."}
      </p>

      {!conversation ? (
        <div className="talk-begin">
          <button className="btn" disabled={begin.isPending} onClick={() => begin.mutate()}>
            {begin.isPending ? "…" : "BEGIN THE CONVERSATION"}
          </button>
          <span className="mono" style={{ color: "var(--faint)", marginTop: 14 }}>
            Only your turns become entries. Nothing is interpreted here.
          </span>
        </div>
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

          <div className="talk-input">
            <input
              id="talkText"
              type="text"
              value={draft}
              placeholder="Say what happened"
              autoComplete="off"
              disabled={mode === "stopped"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) {
                  say.mutate(draft.trim());
                  setDraft("");
                }
              }}
            />
          </div>
        </>
      )}

      {/* Always reachable, both of them: stopping and leaving are the two
          things someone may need most and should never have to hunt for. */}
      <div className="talk-corners">
        <button
          className="talk-corner"
          onClick={() => {
            // Elicitation stops on the person's say-so, not only on the
            // model's judgement. Anything being spoken stops too.
            audio.current?.pause();
            envelope.current = null;
            setMode("stopped");
            setCrisis(crisis ?? []);
          }}
        >
          urgent
        </button>
        {conversation && (
          <button
            className="talk-corner"
            onClick={() => {
              audio.current?.pause();
              close.mutate();
            }}
          >
            close · keeps your turns
          </button>
        )}
      </div>

      {crisis && (
        <div className="talk-crisis">
          Elicitation is stopped. Nothing more will be asked of you.
          <div className="row" style={{ marginTop: 10, justifyContent: "center" }}>
            {crisis.length > 0 ? (
              crisis.map((line) => (
                <span className="pill" key={line}>
                  {line}
                </span>
              ))
            ) : (
              <span className="mono">
                No local services are configured on this server — a wrong-country number is worse
                than none.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Nested harmonic rings, amplitude driven by what the conversation is doing —
 *  and, while it speaks, by the actual loudness of the words being said. */
/** Nine, as the design draws them. */
const RINGS = 9;

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
      // The design's own arithmetic, and its numbers rather than ones near
      // them. It lays the rings out on a 720 box, so everything below is in
      // that space and scaled at the end — the canvas here is whatever the
      // screen gave us, and hard-coding 720 would draw a shape that only
      // happened to fit one size.
      const C = 360;
      const scale = Math.min(canvas.width, canvas.height) / (C * 2);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      for (let k = 0; k < RINGS; k++) {
        const f = k / (RINGS - 1);
        const base = 90 + f * 186;
        // Voice opens the shape rather than starting it: at rest the rings
        // still carry .35 of their amplitude, so the avatar is a thing that is
        // listening rather than a thing that is off.
        const amp = (18 + f * 48) * (0.35 + energy);
        ctx.beginPath();
        for (let i = 0; i <= 240; i++) {
          const th = (i / 240) * Math.PI * 2;
          const r =
            base +
            amp * 0.45 * Math.sin(th * 3 + t * 0.7 + k * 0.6) +
            amp * 0.3 * Math.sin(th * 5 - t * 1.1 + k * 0.9) +
            amp * 0.18 * Math.sin(th * 2 + t * 0.4 - k * 0.4);
          const x = cx + Math.cos(th) * r * scale;
          const y = cy + Math.sin(th) * r * 0.94 * scale;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.closePath();
        // The outermost ring is inked heavier, which is what gives the shape an
        // edge rather than a fade.
        ctx.lineWidth = k === RINGS - 1 ? 2.4 : 1.5;
        ctx.globalAlpha = 1;
        ctx.strokeStyle =
          mode === "stopped"
            ? `rgba(154,166,162,${0.14 + f * 0.18})`
            : mode === "speaking"
              ? `rgba(230,185,92,${0.28 + f * 0.5})`
              : `rgba(167,195,200,${0.3 + f * 0.5})`;
        ctx.stroke();
      }
      // You, at the centre of the conversation. The one filled thing on the
      // screen, so the rings read as around something.
      ctx.beginPath();
      ctx.arc(cx, cy, (20 + energy * 28) * scale, 0, Math.PI * 2);
      ctx.fillStyle = mode === "speaking" ? "#e6b95c" : "#c6e070";
      ctx.globalAlpha = mode === "stopped" ? 0.3 : mode === "idle" ? 0.5 : 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [ref, mode, envelope]);
}
