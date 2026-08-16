import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { SpokenStream } from "@tlon/speech/stream";
import { initial, step } from "@tlon/speech/vad";

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
  /** Which reply is the one being spoken. A reply is several pieces with
   *  several requests in flight at once, so stopping has to be able to disown
   *  the ones that have not come back yet — pausing the element only silences
   *  the piece already playing, and the next would start over the top of it. */
  const utterance = useRef(0);
  /** Pieces asked for and not yet played, in the order they were written. */
  const queue = useRef<Promise<{ audio: string; envelope: number[]; frame_ms: number }>[]>([]);
  /** Whether the loop that empties the queue is already running. */
  const draining = useRef(false);
  /** Identifies the drain currently allowed to release the lock. */
  const drainGeneration = useRef(0);
  /** Whether everything this reply will contain has been queued. Until it is,
   *  an empty queue means "still writing", not "finished". */
  const complete = useRef(true);
  /** The reply as it arrives, shown before the finished one replaces it. */
  const [streamed, setStreamed] = useState("");
  const [hearing, setHearing] = useState(false);
  const listening = useRef(false);
  const wantListen = useRef(false);
  const captureGeneration = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const captureTracks = useRef<MediaStreamTrack[]>([]);
  const startListeningRef = useRef<() => void>(() => undefined);
  const stopAllRef = useRef<() => void>(() => undefined);
  const primerAudio = useRef<HTMLAudioElement | null>(null);
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  useAvatar(canvas, mode, envelope);

  const begin = useMutation({
    mutationFn: () => api.startConversation(),
    onSuccess: (started) => {
      // The last conversation's receipt belongs to the last conversation.
      setKept(null);
      setCrisis(null);
      setConversation(started.id);
    },
  });

  /** Play the queued pieces in order until there are none left and none coming.
   *  Only one of these runs at a time; a piece queued while it is running is
   *  picked up by the loop already going. */
  const drain = useCallback(async (mine: number) => {
    if (draining.current) return;
    draining.current = true;
    const owner = ++drainGeneration.current;
    try {
      for (;;) {
        const next = queue.current.shift();
        if (!next) break;
        const clip = await next;
        // Stopped, or a newer reply took over while this was in the air.
        if (utterance.current !== mine) return;

        const el = primerAudio.current ?? new Audio();
        primerAudio.current = el;
        el.src = `data:audio/wav;base64,${clip.audio}`;
        audio.current = el;
        envelope.current = {
          values: clip.envelope,
          frameMs: clip.frame_ms,
          startedAt: performance.now(),
        };
        await el.play();
        await new Promise<void>((resolve) => {
          el.onended = () => resolve();
          el.onerror = () => resolve();
          el.onpause = () => resolve();
        });
        if (utterance.current !== mine) return;
      }
      if (complete.current && utterance.current === mine) {
        envelope.current = null;
        if (modeRef.current === "speaking") modeRef.current = "idle";
        setMode((m) => (m === "speaking" ? "idle" : m));
        if (wantListen.current && modeRef.current !== "stopped") startListeningRef.current();
      }
    } catch {
      // Speech is optional: with no voice configured the server says so, and
      // the reply is still there to read. A superseded drain must not idle a
      // newer reply that has already taken the lock.
      if (drainGeneration.current !== owner) return;
      envelope.current = null;
      setTimeout(() => {
        if (drainGeneration.current !== owner) return;
        modeRef.current = "idle";
        setMode((m) => (m === "speaking" ? "idle" : m));
        if (wantListen.current) startListeningRef.current();
      }, 900);
    } finally {
      if (drainGeneration.current === owner) draining.current = false;
    }
  }, []);

  const takeOverDrain = useCallback(() => {
    // A newer reply owns the lock immediately. The old drain may still be
    // awaiting synthesis or playback; it must not clear this lock when it
    // finally exits, and it must not keep the queue it was walking.
    drainGeneration.current += 1;
    draining.current = false;
    audio.current?.pause();
    queue.current = [];
    complete.current = false;
  }, []);

  const handleVoice = useCallback(async (mine: number, blob: Blob) => {
    setMode("thinking");
    let transcript = "";
    setVoiceTranscript(null);
    takeOverDrain();
    const cutter = new SpokenStream();
    setStreamed("");
    let reply: Awaited<ReturnType<typeof api.sayAloudStreaming>>;
    try {
      reply = await api.sayAloudStreaming(
        conversation!,
        blob,
        (text) => {
          if (utterance.current === mine) {
            transcript = text;
            setVoiceTranscript(text);
          }
        },
        (delta) => {
          if (utterance.current !== mine) return;
          setStreamed((sofar) => sofar + delta);
          setMode("speaking");
          for (const piece of cutter.push(delta)) {
            if (!speakAloud || !piece.trim()) continue;
            const request = api.speak(piece);
            request.catch(() => undefined);
            queue.current.push(request);
            void drain(mine);
          }
        },
      );
    } catch {
      if (utterance.current !== mine) return;
      setStreamed("");
      setVoiceTranscript(null);
      if (transcript.trim()) setTurns((t) => [...t, { speaker: "user", content: transcript }]);
      modeRef.current = "idle";
      setMode("idle");
      // The drain only restarts listening when the reply is marked complete.
      // An error mid-clip would otherwise leave the microphone shut forever.
      complete.current = true;
      if (!draining.current && wantListen.current) startListeningRef.current();
      return;
    }
    if (utterance.current !== mine) return;
    for (const piece of cutter.end()) {
      if (!speakAloud || !piece.trim()) continue;
      const request = api.speak(piece);
      request.catch(() => undefined);
      queue.current.push(request);
    }
    complete.current = true;
    void drain(mine);
    setVoiceTranscript(null);
    setStreamed("");
    setTurns((t) => [
      ...t,
      ...(transcript.trim() ? [{ speaker: "user" as const, content: transcript }] : []),
      { speaker: "assistant", content: reply.reply },
    ]);
    if (reply.crisis) {
      stopAllRef.current();
      setCrisis(reply.crisis_resources);
      setMode("stopped");
    } else if (!speakAloud) {
      modeRef.current = "idle";
      setMode("idle");
      if (wantListen.current) startListeningRef.current();
    }
  }, [conversation, drain, speakAloud, takeOverDrain]);

  const stopListening = useCallback((upload: boolean, clearWant = false) => {
    const current = recorder.current;
    recorder.current = null;
    listening.current = false;
    if (clearWant) wantListen.current = false;
    setHearing(false);
    if (!upload) captureGeneration.current += 1;
    captureTracks.current.forEach((track) => track.stop());
    captureTracks.current = [];
    if (current) {
      if (!upload) current.ondataavailable = null;
      current.stop();
    }
  }, []);

  const primeAudio = useCallback(() => {
    const primer = primerAudio.current ?? new Audio();
    primerAudio.current = primer;
    primer.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";
    void primer.play().catch(() => undefined);
  }, []);

  const stopAll = useCallback(() => {
    stopListening(false, true);
    utterance.current += 1;
    takeOverDrain();
    if (audio.current) {
      audio.current.removeAttribute("src");
      audio.current.load();
    }
    audio.current = null;
    envelope.current = null;
  }, [stopListening, takeOverDrain]);
  stopAllRef.current = stopAll;

  const startListening = useCallback(async () => {
    const currentMode = modeRef.current;
    if (!conversation || crisis !== null || currentMode === "thinking" || currentMode === "speaking" || currentMode === "stopped" || listening.current) return;
    wantListen.current = true;
    const generation = ++captureGeneration.current;
    listening.current = true;
    primeAudio();
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let setupComplete = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!listening.current || generation !== captureGeneration.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const streamTracks = stream.getTracks();
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const chunks: Blob[] = [];
      const media = new MediaRecorder(stream);
      recorder.current = media;
      captureTracks.current = streamTracks;
      let vad = initial();
      let last = performance.now();
      media.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      media.onstop = () => {
        void context?.close();
        streamTracks.forEach((track) => track.stop());
        if (captureTracks.current === streamTracks) captureTracks.current = [];
        setHearing(false);
        if (!chunks.length || generation !== captureGeneration.current) return;
        const blob = new Blob(chunks, { type: media.mimeType || "audio/webm" });
        const mine = ++utterance.current;
        void handleVoice(mine, blob).catch(() => {
          if (utterance.current === mine) setMode("idle");
        });
      };
      media.start();
      setupComplete = true;
      const poll = () => {
        if (recorder.current !== media || !listening.current) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) { const sample = (value - 128) / 128; sum += sample * sample; }
        const now = performance.now();
        const level = Math.min(1, Math.sqrt(sum / data.length) * 4);
        const result = step(vad, level, now - last);
        vad = result.state;
        last = now;
        if (result.action.type === "start") setHearing(true);
        if (result.action.type === "finish") {
          stopListening(true);
        } else if (result.action.type === "discard") {
          const wanted = listening.current;
          stopListening(false);
          if (wanted) startListeningRef.current();
        } else setTimeout(poll, 50);
      };
      poll();
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      if (generation === captureGeneration.current) {
        listening.current = false;
        setHearing(false);
        setMode("idle");
      }
    } finally {
      if (!setupComplete) {
        stream?.getTracks().forEach((track) => track.stop());
        void context?.close();
        if (generation === captureGeneration.current) {
          recorder.current = null;
          captureTracks.current = [];
        }
      }
    }
  }, [conversation, crisis, handleVoice, primeAudio, stopListening]);
  startListeningRef.current = () => { void startListening(); };

  useEffect(() => () => stopAll(), [stopAll]);

  const say = useMutation({
    mutationFn: async (content: string) => {
      const startedFor = conversation!;
      stopListening(false);
      takeOverDrain();
      setTurns((t) => [...t, { speaker: "user", content }]);
      setMode("thinking");

      // The reply is read as it is written and spoken a sentence at a time, so
      // the model is still writing the second sentence while the first is
      // already sounding. The two waits stop being consecutive.
      const mine = ++utterance.current;
      const cutter = new SpokenStream();
      queue.current = [];
      complete.current = false;
      setStreamed("");

      const enqueue = (piece: string) => {
        if (!speakAloud || !piece.trim()) return;
        const request = api.speak(piece);
        // Awaited in turn by the drain loop, so it would otherwise sit as an
        // unhandled rejection for as long as the pieces ahead of it play.
        request.catch(() => undefined);
        queue.current.push(request);
        void drain(mine);
      };

      // The caption stops saying "Thinking." the moment there is something to
      // read, which is well before there is something to hear.
      let arrived = false;

      try {
        const reply = await api.sayStreaming(startedFor, content, (delta) => {
          if (utterance.current !== mine) return;
          setStreamed((sofar) => sofar + delta);
          if (!arrived) {
            arrived = true;
            setMode("speaking");
          }
          for (const piece of cutter.push(delta)) enqueue(piece);
        });
        return { ...reply, startedFor };
      } finally {
        if (utterance.current === mine) {
          for (const piece of cutter.end()) enqueue(piece);
          complete.current = true;
          // The queue may have run dry while the model was still writing, so
          // the loop that would have noticed the end has already ended.
          void drain(mine);
        }
      }
    },
    onSuccess: (reply) => {
      if (reply.startedFor !== conversationRef.current || modeRef.current === "stopped" || crisis !== null) return;
      setStreamed("");
      setTurns((t) => [...t, { speaker: "assistant", content: reply.reply }]);
      if (reply.crisis) {
        // Elicitation stops entirely, and so does anything still queued to be
        // said over the top of it.
        stopAllRef.current();
        setCrisis(reply.crisis_resources);
        setMode("stopped");
        return;
      }
      if (!speakAloud) {
        // Spoken replies are switched off. The reply is still there to read.
        setMode("idle");
      }
    },
    onError: () => {
      if (modeRef.current === "stopped" || crisis !== null) return;
      setStreamed("");
      setMode("idle");
    },
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
      {/* The shape is the control, as it is on the phone. A conversation began
          with a button underneath a picture of itself; the picture is the thing
          you are talking to, so it is the thing you touch to start. */}
      {conversation ? (
        <button
          id="avatarTalk"
          className="talk-avatar-start"
          onClick={() => (listening.current ? stopListening(false, true) : startListeningRef.current())}
          aria-label={listening.current ? "Stop listening" : "Start listening"}
        >
          <canvas id="avatar" ref={canvas} width={720} height={720} aria-hidden />
        </button>
      ) : (
        <button
          id="avatarStart"
          className="talk-avatar-start"
          onClick={() => begin.mutate()}
          disabled={begin.isPending}
          aria-label="Start talking"
        >
          <canvas id="avatar" ref={canvas} width={720} height={720} aria-hidden />
        </button>
      )}

      <p className="talk-caption mono" aria-live="polite">
        {kept
          ? kept
          : !conversation
          ? begin.isPending
            ? "Starting…"
            : "Tap to start talking"
          : hearing
            ? "Hearing."
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
          <span className="mono" style={{ color: "var(--faint)" }}>
            Say whatever is on your mind. Only your turns become entries, and
            nothing here is interpreted.
          </span>
        </div>
      ) : (
        <>
          <div className="t-main">
            {voiceTranscript && <div className="quote"><p>{voiceTranscript}</p></div>}
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
            {streamed.length > 0 && (
              <div className="card">
                <p>{streamed}</p>
                <span className="mono" style={{ color: "var(--faint)" }}>
                  the agent · never becomes an entry
                </span>
              </div>
            )}
          </div>

          <div className="talk-input">
            <input
              id="talkText"
              type="text"
              value={draft}
              placeholder="Say what happened"
              autoComplete="off"
              disabled={mode === "thinking" || mode === "speaking" || mode === "stopped"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim() && !say.isPending) {
                  primeAudio();
                  say.mutate(draft.trim());
                  setDraft("");
                }
              }}
            />
          </div>
          <span className="mono" style={{ color: "var(--faint)" }}>
            Audio is transcribed, then discarded.
          </span>
        </>
      )}

      {/* Always reachable, both of them: stopping and leaving are the two
          things someone may need most and should never have to hunt for. */}
      <div className="talk-corners">
        <button
          className="talk-corner"
          onClick={() => {
            // Elicitation stops on the person's say-so, not only on the
            // model's judgement. Anything being spoken stops too — including
            // the pieces of it that have not arrived yet.
            stopAll();
            setMode("stopped");
            setCrisis(crisis ?? []);
          }}
        >
          urgent
        </button>
        {conversation && (
          <button
            className="talk-corner"
            disabled={mode === "thinking" || mode === "speaking" || say.isPending}
            onClick={() => {
              if (mode === "thinking" || mode === "speaking" || say.isPending) return;
              stopAll();
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
    /** The running envelope, eased towards its target each frame. Starts where
     *  the design starts it. */
    let eased = 0.08;

    const draw = () => {
      frame += 1;
      const t = frame / 60;
      // Where the amplitude is heading when no voice is behind it. The design
      // gives each state a target that is itself moving and eases towards it,
      // rather than holding one number: idle drifts on a slow sine, thinking
      // swells with a tremor over the top, stopped falls almost flat. Held
      // still, the rings breathe at a constant depth and read as a loop.
      let energy =
        mode === "stopped"
          ? 0.04
          : mode === "thinking"
            ? 0.16 + 0.1 * (0.5 + 0.5 * Math.sin(t * 1.7)) + 0.06 * Math.abs(Math.sin(t * 4.3))
            : 0.06 + 0.02 * Math.sin(t * 0.5);
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
        // Speaking with no measured envelope behind it — no voice configured,
        // or the clip failed. The design's own figure for talking, rather than
        // pinning it open at 1.
        energy = 0.34 + 0.26 * Math.abs(Math.sin(t * 6.1));
      }
      // Eased towards the target rather than snapped to it, at the design's
      // rate, so a change of state swells instead of stepping.
      eased += (energy - eased) * 0.07;
      energy = eased;
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
