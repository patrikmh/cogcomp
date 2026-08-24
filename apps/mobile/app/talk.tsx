import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import * as Crypto from "expo-crypto";

import { AtmosphericShell } from "@/components/Atmospheric";
import { FieldFrame } from "@/components/SpatialField";
import { MotionSurface } from "@/components/MotionSurface";
import { useReducedMotion } from "@/lib/motion";
import { Haptics, selectHaptic, tapHaptic } from "@/lib/haptics";
import { RecordButton, type RecordState } from "@/components/RecordButton";
import { Chip, Kicker } from "@/components/Marks";
import { api, type Conversation, type Pattern, type Theme } from "@/lib/api";
import { feltThoughtOf, gatheredOf, heldReadingsOf, outerReadingsOf, useAmong, useAmongThemes, useDrawnFrom } from "@/lib/drawnFrom";
import { patternDestination } from "@/lib/patterns";
import type { BlobState } from "@/lib/blobShape";
import { lazySkia } from "@/lib/lazySkia";
import { useContinuousVoice } from "@/lib/useContinuousVoice";
import { useSpokenReply } from "@/lib/useSpokenReply";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { forgetTalkOperation, pendingTalkOperations, rememberTalkOperation } from "@/state/pendingOperations";
import { colors, fonts } from "@/theme";
import { radii, type as scale } from "@tlon/design";
import { Pill } from "@/components/Marks";
import { TALK_DISCLOSURE } from "@tlon/copy";
import { SECTIONS } from "@tlon/copy/sections";

const LazyBlob = lazySkia(() => import("@/components/TalkAvatar"));

/** How the sheet rises — the design's own curve, shared with `MoreSheet`, so a
 *  drawer feels the same however it got there. */
const SHEET_MS = 240;
const SHEET_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

/** What the continuous loop is doing, in words. The shape alone is not
 *  accessible, and "is it listening?" must never be a question in an app people
 *  use to talk about difficult things. */
const LIVE_LABEL: Record<string, string> = {
  off: "Tap to start talking",
  listening: "Listening — say anything",
  hearing: "Hearing you",
  thinking: "Thinking",
  replying: "Speaking",
};

/**
 * Journalling by talking.
 *
 * The agent's job is to help someone say what they mean, then get out of the
 * way. Only their turns are kept — the agent's are scaffolding, and the screen
 * says so rather than leaving people to assume the whole exchange is recorded.
 *
 * The dot at the centre of the avatar *is* the conversation's one control: tap
 * it to start, tap it again to end. Everything else — voice on/off, the
 * push-to-talk fallback, closing, the transcript — sits in a drawer at the
 * bottom that stays out of the way until asked for, so the thing someone
 * actually came here to do is nearly the whole screen.
 */
export default function TalkScreen() {
  const token = useSession((s) => s.token);
  const userId = useSession((s) => s.userId);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { width, height } = useWindowDimensions();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<string[] | null>(null);
  const [recording, setRecording] = useState<RecordState>("idle");
  // What the microphone last failed at, said on screen rather than swallowed.
  const [recordError, setRecordError] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  // The drawer of everything that is not the conversation itself. Collapsed by
  // default, so arriving on this screen is arriving at the dot, not a list of
  // buttons.
  const [menuOpen, setMenuOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  // Cleared on a timer rather than tracked from the thread: "has just replied" is
  // a moment, and the last turn stays the agent's long after that moment passes.
  const [justReplied, setJustReplied] = useState(false);
  /** The reply as it is arriving, before the server's copy of it is fetched.
   *  Empty whenever there is nothing in flight. */
  const [streamed, setStreamed] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const [closeReceipt, setCloseReceipt] = useState<number | null>(null);
  const [closeObservations, setCloseObservations] = useState<string[]>([]);
  const stoppedGeneration = useRef(0);
  const requestGeneration = useRef(0);
  const requestIdentities = useRef(new Map<string, { generation: number; userId: string; token: string; conversationId: string }>());
  const recordingGenerations = useRef<number[]>([]);
  const [recordCancel, setRecordCancel] = useState(0);
  const turnIds = useRef(new Map<string, string>());
  const voiceTurnIds = useRef(new Map<string, string>());
  const [recordingGuard, setRecordingGuard] = useState(false);
  const [pendingStorageError, setPendingStorageError] = useState<string | null>(null);
  const [pendingVoiceIds, setPendingVoiceIds] = useState<string[]>([]);
  const [pendingText, setPendingText] = useState<{ id: string; content: string }[]>([]);
  const [pendingVoice, setPendingVoice] = useState<{ id: string; uri?: string }[]>([]);
  const restoreGeneration = useRef(0);
  const conversationIdRef = useRef<string | null>(null);
  conversationIdRef.current = conversationId;

  const sheetAnim = useRef(new Animated.Value(0)).current;

  // Speaking is an addition to the text, never a replacement: if it is off, or
  // unconfigured, or fails, the reply is still on screen to read.
  const voiceOn = usePreferences((s) => s.voice);
  const findingsVisible = usePreferences((s) => s.ready && s.findings);
  const receiptOpen = findingsVisible && closeObservations.length > 0;
  const drawnFrom = useDrawnFrom(token, userId, 4, receiptOpen);
  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: () => api.listPatterns(token!),
    enabled: Boolean(token && userId) && receiptOpen,
  });
  const themes = useQuery({
    queryKey: ["themes", userId],
    queryFn: () => api.listThemes(token!),
    enabled: Boolean(token && userId) && receiptOpen,
  });
  const foundPatterns: Pattern[] = patterns.data ?? [];
  const foundThemes: Theme[] = themes.data ?? [];
  const among = useAmong(token, userId, foundPatterns, 4, receiptOpen);
  const amongThemes = useAmongThemes(token, userId, foundThemes, 4, receiptOpen);
  const drawn = gatheredOf(closeObservations, drawnFrom);
  const drawnFelt = feltThoughtOf(drawn).slice(0, 3);
  const drawnHolds = heldReadingsOf(drawn).slice(0, 3);
  const drawnAround = outerReadingsOf(drawn).slice(0, 3);
  const amongPatterns = gatheredOf(closeObservations, among).slice(0, 5);
  const amongRegions = gatheredOf(closeObservations, amongThemes).slice(0, 5);
  const setVoice = usePreferences((s) => s.setVoice);
  const voice = useSpokenReply(token, voiceOn);

  const start = useMutation({
    mutationFn: () => api.startConversation(token!),
    onSuccess: (c) => {
      const session = useSession.getState();
      if (session.token !== token || session.userId !== userId) return;
      setConversationId(c.id);
    },
  });

  const sessionIdentity = useRef<{ token: string; userId: string } | null>(null);
  useEffect(() => {
    const previous = sessionIdentity.current;
    sessionIdentity.current = token && userId ? { token, userId } : null;
    if (!previous || (previous.token === token && previous.userId === userId)) return;

    requestGeneration.current += 1;
    stoppedGeneration.current += 1;
    recordingGenerations.current = [];
    requestIdentities.current.clear();
    turnIds.current.clear();
    voiceTurnIds.current.clear();
    queryClient.removeQueries({ queryKey: ["conversation"] });
    setConversationId(null);
    setCloseReceipt(null);
    setCloseObservations([]);
    setStreamed("");
    setVoiceTranscript(null);
    setCrisis(null);
    setCloseReceipt(null);
    setJustReplied(false);
    setMenuOpen(false);
    setTranscriptOpen(false);
    setRecordCancel((n) => n + 1);
    setRecording("idle");
    setRecordError(null);
    setPendingStorageError(null);
    setPendingVoiceIds([]);
    setPendingText([]);
    setPendingVoice([]);
    setRecordingGuard(false);
    live.stop();
    voice.stop();
  }, [token, userId]);

  // Pick up where you left off, and only start a new one when there is nothing
  // open to return to.
  //
  // Every arrival used to begin a fresh conversation, so stepping to the journal
  // and back lost the thread — it was still on the server, unclosed, and the
  // screen had no way to show it. It also left an abandoned conversation behind
  // each time, which is why an account used for an afternoon had twenty of them.
  useEffect(() => {
    requestGeneration.current += 1;
    // These maps contain raw text keys and server IDs; an account change must
    // not carry either across the authentication boundary.
    turnIds.current.clear();
    voiceTurnIds.current.clear();
    setPendingVoiceIds([]);
    setPendingText([]);
    setPendingVoice([]);
    setPendingStorageError(null);
    setRecordingGuard(false);
  }, [conversationId, token, userId]);

  useEffect(() => {
    const generation = ++restoreGeneration.current;
    if (!token || !userId || !conversationId) return;
    void pendingTalkOperations(userId, conversationId).then((operations) => {
      const session = useSession.getState();
      if (generation !== restoreGeneration.current || session.userId !== userId || session.token !== token || conversationIdRef.current !== conversationId) return;
      for (const operation of operations) {
        const current = useSession.getState();
        if (generation !== restoreGeneration.current || current.userId !== userId || current.token !== token || conversationIdRef.current !== conversationId) return;
        if (operation.userId !== userId || operation.conversationId !== conversationId) continue;
        if (operation.source === "text" && operation.content) {
          turnIds.current.set(`${operation.source}:${operation.content}`, operation.id);
          setPendingText((items) => items.some((item) => item.id === operation.id) ? items : [...items, { id: operation.id, content: operation.content! }]);
        } else if (operation.source === "voice") {
          voiceTurnIds.current.set(operation.recordingUri ?? operation.id, operation.id);
          setPendingVoice((items) => items.some((item) => item.id === operation.id) ? items : [...items, { id: operation.id, uri: operation.recordingUri }]);
          setPendingVoiceIds((ids) => ids.includes(operation.id) ? ids : [...ids, operation.id]);
          setRecordingGuard(true);
        }
      }
    });
  }, [conversationId, token, userId]);

  useEffect(() => {
    if (!token || conversationId || start.isPending) return;
    let cancelled = false;
    void (async () => {
      try {
        const { conversations } = await api.listConversations(token);
        const open = conversations.find((c) => c.closed_at === null);
        if (cancelled) return;
        if (open) {
          setConversationId(open.id);
          return;
        }
      } catch {
        // The list is an optimisation, not the feature. If it fails, start one.
      }
      if (!cancelled) start.mutate();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, token, userId]);

  const conversation = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => api.conversation(token!, conversationId!),
    enabled: Boolean(token && conversationId),
  });

  useEffect(() => {
    const restored = conversation.data;
    if (!restored || !restored.flagged) return;
    setCrisis(restored.crisis_resources ?? []);
    stoppedGeneration.current += 1;
    recordingGenerations.current = [];
    setRecordCancel((n) => n + 1);
    live.stop();
    voice.stop();
  }, [conversation.data]);

  const captureIdentity = () => token && userId && conversationId
    ? { generation: requestGeneration.current, userId, token, conversationId }
    : null;
  const ownsIdentity = (identity: { generation: number; userId: string; token: string; conversationId: string } | null) =>
    identity !== null && identity.generation === requestGeneration.current &&
    useSession.getState().userId === identity.userId && useSession.getState().token === identity.token &&
    conversationIdRef.current === identity.conversationId;

  const ownsCurrentOperation = (operationId: string, expectedUserId: string, expectedConversationId: string) =>
    useSession.getState().userId === expectedUserId &&
    useSession.getState().token === token &&
    conversationId === expectedConversationId &&
    Array.from(voiceTurnIds.current.values()).includes(operationId);

  const speak = useMutation({
    mutationFn: async ({ uri, generation }: { uri: string; generation: number }) => {
      const identity = captureIdentity();
      if (!identity) throw new Error("stale talk operation");
      const operationId = voiceTurnIds.current.get(uri) ?? Crypto.randomUUID();
      voiceTurnIds.current.set(uri, operationId);
      requestIdentities.current.set(operationId, identity);
      // Keep controls guarded until the envelope is durable. If storage fails,
      // retain the URI on screen for recovery instead of losing the recording.
      setRecordingGuard(true);
      try {
        await rememberTalkOperation({
          id: operationId,
          userId: userId!,
          conversationId: conversationId!,
          source: "voice",
          recordingUri: uri,
          metadata: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        });
      } catch (error) {
        if (ownsIdentity(identity)) {
          setPendingVoice((items) => items.some((item) => item.id === operationId) ? items : [...items, { id: operationId, uri }]);
          setPendingVoiceIds((ids) => ids.includes(operationId) ? ids : [...ids, operationId]);
          setPendingStorageError("Your recording could not be saved for recovery. Retry storage or discard it.");
        }
        throw new Error("pending operation could not be stored", { cause: error });
      }
      if (!ownsCurrentOperation(operationId, userId!, conversationId!)) throw new Error("stale talk operation");
      const spoken = voice.speakAsItArrives();
      setStreamed("");
      setVoiceTranscript(null);
      try {
        return await api.sayAloudStreaming(
          token!,
          conversationId!,
          uri,
          (transcript) => {
            if (generation === stoppedGeneration.current && ownsIdentity(identity)) setVoiceTranscript(transcript);
          },
          (delta) => {
            if (generation !== stoppedGeneration.current || !ownsIdentity(identity)) return;
            setStreamed((sofar) => sofar + delta);
            spoken.feed(delta);
          },
          voiceTurnIds.current.get(uri) ?? (() => {
            const id = Crypto.randomUUID();
            voiceTurnIds.current.set(uri, id);
            return id;
          })(),
        );
      } finally {
        spoken.end();
      }
    },
    onSuccess: async (reply, variables) => {
      const operationId = voiceTurnIds.current.get(variables.uri);
      const identity = operationId ? requestIdentities.current.get(operationId) ?? null : null;
      if (!ownsIdentity(identity)) return;
      if (operationId) await forgetTalkOperation(userId!, conversationId!, operationId);
      if (operationId) { setPendingVoice((items) => items.filter((item) => item.id !== operationId)); setPendingVoiceIds((ids) => ids.filter((id) => id !== operationId)); }
      voiceTurnIds.current.delete(variables.uri);
      if (operationId) requestIdentities.current.delete(operationId);
      setPendingStorageError(null);
      setRecordingGuard(false);
      const current = variables.generation === stoppedGeneration.current;
      if (current) setJustReplied(true);
      if (reply.crisis) {
        stoppedGeneration.current += 1;
        recordingGenerations.current = [];
        setRecordCancel((n) => n + 1);
        live.stop();
        voice.stop();
        setCrisis(reply.crisis_resources);
        setStreamed("");
        setVoiceTranscript(null);
      }
      await conversation.refetch();
      if (current) {
        setStreamed("");
        setVoiceTranscript(null);
      }
    },
    onError: async (error, variables) => {
      const session = useSession.getState();
      if (session.userId !== userId || session.token !== token || conversationIdRef.current !== conversationId) return;
      // A storage failure has retained the recording locally. Do not replace
      // that recovery state with an empty storage read.
      setStreamed("");
      setVoiceTranscript(null);
      if (error instanceof Error && error.message === "pending operation could not be stored") return;
      const operations = await pendingTalkOperations(userId!, conversationId!);
      setPendingVoice(operations.filter((item) => item.source === "voice").map((item) => ({ id: item.id, uri: item.recordingUri })));
      setPendingVoiceIds(operations.filter((item) => item.source === "voice").map((item) => item.id));
      setRecordingGuard(operations.some((item) => item.source === "voice"));
      await conversation.refetch();
    },
  });

  const say = useMutation({
    mutationFn: async ({ text, source }: { text: string; source: "text" | "voice" }) => {
      // The reply is read as it is written and spoken a sentence at a time, so
      // the model is still writing the second sentence while the first is
      // already sounding. Ending the feed is in a finally because a reply that
      // fails halfway still has to release whatever was held back.
      const identity = captureIdentity();
      if (!identity) throw new Error("stale talk operation");
      const spoken = voice.speakAsItArrives();
      setStreamed("");
      const key = `${source}:${text}`;
      const clientTurnId = turnIds.current.get(key) ?? (() => {
        const id = Crypto.randomUUID();
        turnIds.current.set(key, id);
        return id;
      })();
      try {
        await rememberTalkOperation({
          id: clientTurnId,
          userId: userId!,
          conversationId: conversationId!,
          source,
          content: text,
          metadata: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        });
      } catch (error) {
        if (ownsIdentity(identity)) {
          setPendingText((items) => items.some((item) => item.id === clientTurnId) ? items : [...items, { id: clientTurnId, content: text }]);
          setPendingStorageError("This turn could not be saved for recovery. Retry storage or discard it.");
        }
        throw new Error("pending operation could not be stored", { cause: error });
      }
      if (useSession.getState().userId !== userId || useSession.getState().token !== token || conversationId === null || turnIds.current.get(key) !== clientTurnId) throw new Error("stale talk operation");
      requestIdentities.current.set(clientTurnId, identity);
      try {
        return await api.sayStreaming(token!, conversationId!, text, source, (delta) => {
          if (!ownsIdentity(identity)) return;
          setStreamed((sofar) => sofar + delta);
          spoken.feed(delta);
        }, clientTurnId);
      } finally {
        spoken.end();
      }
    },
    onSuccess: async (reply, variables) => {
      const operationId = turnIds.current.get(`${variables.source}:${variables.text}`);
      const identity = operationId ? requestIdentities.current.get(operationId) ?? null : null;
      if (!ownsIdentity(identity)) return;
      if (operationId) await forgetTalkOperation(userId!, conversationId!, operationId);
      if (operationId) setPendingText((items) => items.filter((item) => item.id !== operationId));
      turnIds.current.delete(`${variables.source}:${variables.text}`);
      if (operationId) requestIdentities.current.delete(operationId);
      setPendingStorageError(null);
      setJustReplied(true);
      if (reply.crisis) {
        stoppedGeneration.current += 1;
        recordingGenerations.current = [];
        setRecordCancel((n) => n + 1);
        live.stop();
        voice.stop();
        setCrisis(reply.crisis_resources);
      }
      // Cleared only once the stored turn is actually in hand. Dropping it any
      // earlier leaves the thread a line short for the length of a refetch —
      // the reply visibly disappearing just as it finished arriving.
      await queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
      setStreamed("");
    },
    onError: async (error, variables) => {
      const session = useSession.getState();
      if (session.userId !== userId || session.token !== token || conversationIdRef.current !== conversationId) return;
      // A storage failure has retained the turn locally. Do not replace that
      // recovery state with an empty storage read.
      setStreamed("");
      setVoiceTranscript(null);
      if (error instanceof Error && error.message === "pending operation could not be stored") return;
      const operations = await pendingTalkOperations(userId!, conversationId!);
      setPendingText(operations.filter((item) => item.source === "text").map((item) => ({ id: item.id, content: item.content! })));
      setPendingVoice(operations.filter((item) => item.source === "voice").map((item) => ({ id: item.id, uri: item.recordingUri })));
      setPendingVoiceIds(operations.filter((item) => item.source === "voice").map((item) => item.id));
      setRecordingGuard(operations.some((item) => item.source === "voice"));
      await conversation.refetch();
    },
  });

  const finish = useMutation({
    mutationFn: () => api.closeConversation(token!, conversationId!, findingsVisible),
    onSuccess: (receipt) => {
      const session = useSession.getState();
      if (session.token !== token || session.userId !== userId) return;
      void queryClient.invalidateQueries({ queryKey: ["observations"] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
      setCloseReceipt(receipt.turns_converted);
      setCloseObservations(findingsVisible ? receipt.observations : []);
    },
    onError: () => {
      // Keep the conversation visible so a failed close can be retried and is
      // never mistaken for a successful save.
    },
  });

  /**
   * Continuous mode: the conversation runs itself.
   *
   * The microphone stays open, the detector decides when a thought has finished,
   * and the reply is spoken back. `speaking` is passed straight through so the
   * microphone is shut while the agent talks — otherwise its own voice becomes
   * the next turn and the two of them talk to each other indefinitely.
   */
  const live = useContinuousVoice({
    enabled: Boolean(token && conversationId) && crisis === null && closeReceipt === null,
    speaking: voice.speaking || speak.isPending || say.isPending,
    onUtterance: async (uri, generation) => {
      if (generation !== stoppedGeneration.current) return;
      await speak.mutateAsync({ uri, generation });
    },
  });

  useEffect(() => {
    if (closeReceipt === null) return;
    // The successful close is the lifecycle boundary, not merely a receipt:
    // invalidate every in-flight capture generation before releasing devices.
    stoppedGeneration.current += 1;
    recordingGenerations.current = [];
    setRecordCancel((n) => n + 1);
    live.stop();
    voice.stop();
  }, [closeReceipt, live.stop, voice.stop]);

  useEffect(() => {
    if (token) return;
    stoppedGeneration.current += 1;
    recordingGenerations.current = [];
    setRecordCancel((n) => n + 1);
    setStreamed("");
    setVoiceTranscript(null);
    live.stop();
    voice.stop();
  }, [live.stop, token, voice.stop]);

  useEffect(() => {
    return () => {
      stoppedGeneration.current += 1;
      recordingGenerations.current = [];
      live.stop();
      voice.stop();
    };
  }, [live.stop, voice.stop]);

  useEffect(() => {
    if (!justReplied) return;
    const timer = setTimeout(() => setJustReplied(false), 2600);
    return () => clearTimeout(timer);
  }, [justReplied]);

  // Crisis resources must never be missed, so the drawer opens by itself the
  // moment they appear, however the screen was left when they did.
  useEffect(() => {
    if (crisis !== null) setMenuOpen(true);
  }, [crisis]);

  useEffect(() => {
    if (reducedMotion) {
      sheetAnim.setValue(menuOpen ? 1 : 0);
      return;
    }
    const animation = Animated.timing(sheetAnim, {
      toValue: menuOpen ? 1 : 0,
      duration: SHEET_MS,
      easing: SHEET_EASING,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [menuOpen, reducedMotion, sheetAnim]);

  if (!token) return null;

  const turns: Conversation["turns"] = conversation.data?.turns ?? [];
  const saidSomething = turns.some((t) => t.speaker === "user");
  const lastReply = [...turns].reverse().find((t) => t.speaker !== "user");
  /** The last thing the person said, as it was heard — so someone can talk, get
   *  an answer, and tell whether a word of it was understood, which on a screen
   *  whose entire input is a microphone is the one thing it has to show. */
  const lastHeard = [...turns].reverse().find((t) => t.speaker === "user");

  // Order matters: what the microphone is doing beats what the network is doing,
  // so the blob never looks busy while someone is mid-sentence.
  const blobState: BlobState =
    recording === "recording"
      ? "listening"
      : say.isPending || speak.isPending || recording === "uploading"
        ? "thinking"
        : voice.speaking || justReplied
          ? "speaking"
          : "idle";

  const dotLabel =
    recording === "recording"
      ? "Listening — release to send"
      : recording === "uploading"
        ? "Sending…"
        : LIVE_LABEL[live.state];

  // Bounded so the avatar dominates a phone without swallowing a tablet: never
  // smaller than a presence, never so large it fights the safe area.
  const stageWidth = Math.min(width, 620);
  const dotSize = Math.max(240, Math.min(stageWidth * 0.88, height * 0.5, 440));

  const toggleMenu = () => {
    selectHaptic();
    setMenuOpen((on) => !on);
  };

  const toggleLive = () => {
    if (recording !== "idle" || crisis !== null || closeReceipt !== null) return;
    // Inside the tap, while a gesture still counts: iOS will not play a reply
    // that arrives after the network unless sound has been started once by
    // hand.
    voice.unlock();
    if (live.state === "off") {
      stoppedGeneration.current += 1;
      tapHaptic(Haptics.ImpactFeedbackStyle.Medium);
      if (!conversationId) {
        if (!start.isPending) start.mutate();
        return;
      }
      void live.start();
    } else {
      tapHaptic(Haptics.ImpactFeedbackStyle.Light);
      stoppedGeneration.current += 1;
      recordingGenerations.current = [];
      setRecordCancel((n) => n + 1);
      setStreamed("");
      setVoiceTranscript(null);
      live.stop();
      voice.stop();
    }
  };

  const finishError = finish.isError
    ? "Could not close this conversation. Your turns are still here — try again."
    : null;

  const speakError = say.isError || speak.isError
    ? "The reply could not be completed. Your turn may already be saved; check the transcript before sending another message."
    : null;

  return (
    <AtmosphericShell variant="secondary">
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <FieldFrame label="Conversation spatial stage">
          <View style={styles.stage}>
            <MotionSurface
              style={styles.dotSurface}
              onPress={toggleLive}
              disabled={recording !== "idle" || crisis !== null || closeReceipt !== null}
              accessibilityRole="button"
              accessibilityLabel={
                live.state === "off"
                  ? conversationId
                    ? "Start talking"
                    : start.isError
                      ? "Retry starting the conversation"
                      : "Start the conversation"
                  : "End the conversation"
              }
              accessibilityState={{
                selected: live.state !== "off",
                busy: start.isPending,
              }}
              accessibilityHint="Double tap to start or stop the conversation."
            >
              <Suspense fallback={<View style={{ height: dotSize }} />}>
                <LazyBlob state={blobState} size={dotSize} energy={voice.level} />
              </Suspense>
              <Text style={styles.dotLabel}>{dotLabel}</Text>
            </MotionSurface>

            <View style={styles.stageBody}>
              <Text style={styles.disclosure} accessibilityLabel={`${TALK_DISCLOSURE.heading}. ${TALK_DISCLOSURE.body}`}>
                {TALK_DISCLOSURE.heading}: {TALK_DISCLOSURE.body}
              </Text>
              {start.isPending || conversation.isLoading ? (
                <Text style={styles.opening}>Opening a private conversation…</Text>
              ) : turns.length === 0 && !streamed && !voiceTranscript ? (
                <Text style={styles.opening}>
                  Say whatever is on your mind. I'll ask a few questions to help
                  you get it down.
                </Text>
              ) : (
                <>
                  {(voiceTranscript || lastHeard) && (
                    <Text style={styles.heard} numberOfLines={2}>
                      {voiceTranscript ?? lastHeard?.content}
                    </Text>
                  )}
                  {(streamed || lastReply) && (
                    <Text style={styles.reply} numberOfLines={5}>
                      {streamed || lastReply?.content}
                    </Text>
                  )}
                </>
              )}
              {(say.isPending || speak.isPending) && (
                <ActivityIndicator style={styles.thinking} color={colors.inkMuted} />
              )}
              {speakError && <Text style={styles.error}>{speakError}</Text>}
              {(live.error || recordError) && (
                <Text style={styles.error}>{live.error ? "Could not start listening. Please try again." : "That recording could not be sent. Your turn was not confirmed; please try again."}</Text>
              )}
              {start.isError && <Text style={styles.error}>Could not start talking. Try again.</Text>}
              {conversation.isError && <Text style={styles.error}>Could not load this conversation. Try again.</Text>}
              {finishError && <Text style={styles.error}>{finishError}</Text>}
            </View>
          </View>
        </FieldFrame>

        {closeReceipt !== null && (
          <View style={styles.receipt} accessibilityRole="alert">
            <Text style={styles.receiptTitle}>Conversation closed</Text>
            <Text style={styles.receiptBody}>{closeReceipt} {closeReceipt === 1 ? "turn" : "turns"} converted to Journal entries.</Text>
            {drawnFelt.length > 0 && (
              <View style={styles.receiptRow}>
                <Kicker>{SECTIONS.inside.title}</Kicker>
                <View style={styles.receiptChips}>
                  {drawnFelt.map((reading) => (
                    <Chip
                      key={reading.id}
                      label={reading.label}
                      confidence={reading.confidence}
                      tentative={reading.tentative}
                      onPress={() => router.push(`/node/${reading.id}`)}
                    />
                  ))}
                </View>
              </View>
            )}
            {drawnHolds.length > 0 && (
              <View style={styles.receiptRow}>
                <Kicker>{SECTIONS.holds.title}</Kicker>
                <View style={styles.receiptChips}>
                  {drawnHolds.map((reading) => (
                    <Chip
                      key={reading.id}
                      label={reading.label}
                      confidence={reading.confidence}
                      tentative={reading.tentative}
                      onPress={() => router.push(`/node/${reading.id}`)}
                    />
                  ))}
                </View>
              </View>
            )}
            {drawnAround.length > 0 && (
              <View style={styles.receiptRow}>
                <Kicker>{SECTIONS.around.title}</Kicker>
                <View style={styles.receiptChips}>
                  {drawnAround.map((reading) => (
                    <Chip
                      key={reading.id}
                      label={reading.label}
                      confidence={reading.confidence}
                      tentative={reading.tentative}
                      onPress={() => router.push(`/node/${reading.id}`)}
                    />
                  ))}
                </View>
              </View>
            )}
            {amongPatterns.length > 0 && (
              <View style={styles.receiptRow}>
                <Kicker>This conversation is among</Kicker>
                <View style={styles.receiptChips}>
                  {amongPatterns.map((pattern) => (
                    <Chip
                      key={pattern.id}
                      label={pattern.label.split(" · ")[0] ?? pattern.label}
                      confidence={pattern.confidence}
                      tentative={pattern.tentative}
                      onPress={() => router.push(patternDestination(pattern).href)}
                    />
                  ))}
                </View>
              </View>
            )}
            {amongRegions.length > 0 && (
              <View style={styles.receiptRow}>
                <Kicker>This conversation is in</Kicker>
                <View style={styles.receiptChips}>
                  {amongRegions.map((theme) => (
                    <Chip
                      key={theme.id}
                      label={theme.label}
                      confidence={theme.confidence}
                      tentative={theme.tentative}
                      onPress={() => router.push(`/theme/${theme.id}`)}
                    />
                  ))}
                </View>
              </View>
            )}
            <MotionSurface onPress={() => router.replace("/")} accessibilityRole="button" accessibilityLabel="Return to Journal" style={styles.returnAction}>
              <Text style={styles.returnLabel}>Return to Journal →</Text>
            </MotionSurface>
          </View>
        )}

        {crisis !== null && (
          // Shown above the drawer, unconditionally — the one thing on this
          // screen that must never be a tap away from being missed.
          <View style={styles.crisis}>
            <Text style={styles.crisisTitle}>If you need someone now</Text>
            {crisis.length > 0 ? (
              crisis.map((line) => (
                <Pill key={line} tone={colors.ink}>
                  {line}
                </Pill>
              ))
            ) : (
              <Text style={styles.crisisLine}>
                Please contact your local emergency services or a crisis line.
              </Text>
            )}
            <Text style={styles.crisisNote}>
              This app is for writing things down. It isn't a substitute for
              talking to a person.
            </Text>
          </View>
        )}

        {/* The drawer. A quiet peek row is always on screen — the grabber, a
            voice status, and the one control the design will not let a menu
            hide — and it opens to everything else.
            Three siblings, not one button wrapping two others: a `<button>`
            nested inside a `<button>` is invalid HTML on web, and Pressable's
            click bubbles, so the inner tap would have fired the outer toggle
            too — voice or crisis by way of trying to open the drawer. */}
        <View style={styles.sheet}>
          <View style={styles.sheetPeek}>
            <View style={styles.handle} />
            <View style={styles.peekRow}>
              <Pressable
                disabled={closeReceipt !== null}
                onPress={() => {
                  // Turning it off stops the current sentence too. Waiting for a
                  // reply you have just muted to finish is the opposite of what
                  // you asked for.
                  if (voiceOn) voice.stop();
                  void setVoice(!voiceOn);
                }}
                hitSlop={8}
                accessibilityRole="switch"
                accessibilityState={{ checked: voiceOn }}
              >
                <Text style={styles.peekVoice}>{voiceOn ? "Voice on" : "Voice off"}</Text>
              </Pressable>

              <Pressable
                style={styles.peekChevron}
                onPress={toggleMenu}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={menuOpen ? "Hide options" : "Show options"}
                accessibilityState={{ expanded: menuOpen }}
              >
                <Chevron open={menuOpen} />
                <Text style={styles.peekLabel}>{menuOpen ? "Options" : "More"}</Text>
              </Pressable>

              <MotionSurface
                disabled={closeReceipt !== null}
                onPress={() => {
                  if (closeReceipt !== null) return;
                  stoppedGeneration.current += 1;
                  recordingGenerations.current = [];
                  setRecordCancel((n) => n + 1);
                  setStreamed("");
                  setVoiceTranscript(null);
                  live.stop();
                  voice.stop();
                  setCrisis(crisis ?? []);
                }}
                accessibilityRole="button"
                accessibilityLabel="Urgent — show crisis resources and stop"
              >
                <Text style={styles.peekUrgent}>Urgent</Text>
              </MotionSurface>
            </View>
          </View>

          <Animated.View
            style={[
              styles.sheetBody,
              {
                opacity: sheetAnim,
                maxHeight: sheetAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 360],
                }),
              },
            ]}
            pointerEvents={menuOpen ? "auto" : "none"}
          >
            <ScrollView contentContainerStyle={styles.sheetContent}>
              {(pendingText.length > 0 || recordingGuard) && (
                <View style={styles.recovery}>
                  {pendingText.map((operation) => (
                    <View key={operation.id} style={styles.recoveryRow}>
                      <Text style={styles.error}>A text turn is waiting to be reconciled.</Text>
                      <MotionSurface accessibilityRole="button" onPress={() => say.mutate({ text: operation.content, source: "text" })} style={styles.recoveryAction}><Text style={styles.recoveryLabel}>Retry</Text></MotionSurface>
                      <MotionSurface accessibilityRole="button" onPress={async () => { await forgetTalkOperation(userId!, conversationId!, operation.id); setPendingText((items) => items.filter((item) => item.id !== operation.id)); turnIds.current.delete(`text:${operation.content}`); setPendingStorageError(null); }} style={styles.recoveryAction}><Text style={styles.recoveryLabel}>Discard</Text></MotionSurface>
                    </View>
                  ))}
                  {pendingVoice.map((operation) => (
                    <View key={operation.id} style={styles.recoveryRow}>
                      <Text style={styles.error}>{pendingStorageError ?? (operation.uri ? "A voice turn is waiting to be reconciled." : "The recording file is no longer available.")}</Text>
                      {operation.uri && <MotionSurface accessibilityRole="button" onPress={() => speak.mutate({ uri: operation.uri!, generation: stoppedGeneration.current })} style={styles.recoveryAction}><Text style={styles.recoveryLabel}>Retry</Text></MotionSurface>}
                      <MotionSurface accessibilityRole="button" onPress={async () => { await forgetTalkOperation(userId!, conversationId!, operation.id); setPendingVoice((items) => items.filter((item) => item.id !== operation.id)); setPendingVoiceIds((ids) => ids.filter((id) => id !== operation.id)); setPendingStorageError(null); setRecordingGuard(false); }} style={styles.recoveryAction}><Text style={styles.recoveryLabel}>Discard</Text></MotionSurface>
                    </View>
                  ))}
                </View>
              )}
              {closeReceipt === null && conversationId && crisis === null && live.state === "off" && !recordingGuard && (
                <View style={[styles.row, styles.rowStacked]}>
                  <Text style={styles.rowLabel}>Prefer to hold instead?</Text>
                  <RecordButton
                    onPressStart={() => {
                      recordingGenerations.current.push(stoppedGeneration.current);
                      voice.unlock();
                    }}
                    cancelSignal={recordCancel}
                    disabled={say.isPending || speak.isPending || voice.speaking}
                    onRecorded={async (uri) => {
                      const generation = recordingGenerations.current.shift();
                      if (generation === undefined || generation !== stoppedGeneration.current) return;
                      await speak.mutateAsync({ uri, generation });
                    }}
                    onStateChange={setRecording}
                    onError={setRecordError}
                    tone="dark"
                  />
                </View>
              )}

              {voice.unavailable && (
                <Text style={styles.diagnostic}>
                  Spoken replies aren't set up on this server — {voice.lastError}
                </Text>
              )}
              {!voice.unavailable && voice.lastError && (
                <Text style={styles.diagnostic}>
                  Couldn't speak the last reply — {voice.lastError}
                </Text>
              )}

              <Pressable
                style={styles.row}
                onPress={() => setTranscriptOpen(true)}
                accessibilityRole="button"
                disabled={turns.length === 0}
              >
                <Text style={[styles.rowLabel, turns.length === 0 && styles.disabledText]}>
                  View transcript
                </Text>
                <Text style={styles.rowMeta}>
                  {turns.length > 0 ? `${turns.length} turns` : "Nothing yet"}
                </Text>
              </Pressable>

              <MotionSurface
                style={[
                  styles.finish,
                  (closeReceipt !== null ||
                    !saidSomething ||
                    finish.isPending ||
                    say.isPending ||
                    speak.isPending ||
                    live.state === "thinking" ||
                    recording === "uploading" ||
                    recordingGuard ||
                    pendingText.length > 0 ||
                    pendingVoice.length > 0) && styles.disabled,
                ]}
                disabled={
                  closeReceipt !== null ||
                  !saidSomething ||
                  finish.isPending ||
                  say.isPending ||
                  speak.isPending ||
                  live.state === "thinking" ||
                  recording === "uploading" ||
                  recordingGuard ||
                  pendingText.length > 0 ||
                  pendingVoice.length > 0
                }
                onPress={() => {
                  if (
                    closeReceipt !== null ||
                    !saidSomething ||
                    finish.isPending ||
                    say.isPending ||
                    speak.isPending ||
                    live.state === "thinking" ||
                    recording === "uploading" ||
                    recordingGuard ||
                    pendingText.length > 0 ||
                    pendingVoice.length > 0
                  ) return;
                  stoppedGeneration.current += 1;
                  recordingGenerations.current = [];
                  setRecordCancel((n) => n + 1);
                  live.stop();
                  voice.stop();
                  finish.mutate();
                }}
              >
                <Text style={styles.finishLabel}>
                  {/* The design says what closing does rather than that it saves:
                      "close · keeps your turns". Which turns are kept is the
                      question someone has while deciding whether to close. */}
                  {finish.isPending ? "Saving…" : "Close conversation · keeps your turns"}
                </Text>
              </MotionSurface>

              <Text style={styles.footnote} accessibilityLabel={`${TALK_DISCLOSURE.heading}. ${TALK_DISCLOSURE.body}`}>
                {TALK_DISCLOSURE.heading}: {TALK_DISCLOSURE.body}
              </Text>
            </ScrollView>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={transcriptOpen}
        transparent
        animationType={reducedMotion ? "none" : "slide"}
        onRequestClose={() => setTranscriptOpen(false)}
      >
        <Pressable
          style={styles.transcriptScrim}
          onPress={() => setTranscriptOpen(false)}
          accessibilityLabel="Close transcript"
        />
        <View style={styles.transcriptSheet}>
          <View style={styles.handle} />
          <Text style={styles.transcriptTitle}>Transcript</Text>
          <ScrollView contentContainerStyle={styles.thread}>
            {turns.map((turn) => (
              <View
                key={turn.id}
                style={[styles.bubble, turn.speaker === "user" ? styles.mine : styles.theirs]}
              >
                <Text style={turn.speaker === "user" ? styles.mineText : styles.theirsText}>
                  {turn.content}
                </Text>
              </View>
            ))}
            {streamed.length > 0 && (
              <View style={[styles.bubble, styles.theirs]}>
                <Text style={styles.theirsText}>{streamed}</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </AtmosphericShell>
  );
}

/** A minimal chevron, rotated by the sheet's own open state rather than a
 *  second animated value — one thing driving one thing. */
function Chevron({ open }: { open: boolean }) {
  return (
    <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
      <Svg width={12} height={8} viewBox="0 0 12 8">
        <Path
          d="M1 1.5 6 6.5 11 1.5"
          fill="none"
          stroke={colors.inkMuted}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.room },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  dotSurface: { alignItems: "center" },
  dotLabel: {
    marginTop: 14,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.inkMuted,
    textAlign: "center",
  },
  stageBody: {
    paddingHorizontal: 28,
    paddingTop: 18,
    minHeight: 76,
    alignItems: "center",
    gap: 8,
  },
  disclosure: {
    color: colors.inkMuted,
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  opening: {
    color: colors.inkMuted,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  heard: {
    color: colors.inkMuted,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  reply: {
    color: colors.ink,
    fontFamily: fonts.sans,
    fontSize: 17,
    lineHeight: 25,
    textAlign: "center",
  },
  thinking: { marginTop: 2 },
  error: { color: colors.danger, fontFamily: fonts.sans, fontSize: 13, textAlign: "center" },
  recovery: { gap: 6 },
  recoveryRow: { gap: 8, alignItems: "center" },
  recoveryAction: { alignSelf: "center" },
  recoveryLabel: { color: colors.cyan, fontFamily: fonts.sans, fontWeight: "700" },

  receipt: { marginHorizontal: 16, borderWidth: 1, borderColor: colors.cyan, borderRadius: radii.surface, padding: 12, gap: 6, marginBottom: 8 },
  receiptTitle: { fontFamily: fonts.sans, fontWeight: "700", color: colors.ink },
  receiptBody: { fontFamily: fonts.sans, color: colors.ink, lineHeight: 21 },
  receiptRow: { gap: 6, paddingTop: 4 },
  receiptChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  returnAction: { paddingVertical: 6 },
  returnLabel: { color: colors.cyan, fontFamily: fonts.sans, fontWeight: "700" },

  crisis: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radii.surface,
    padding: 12,
    gap: 6,
    marginBottom: 8,
  },
  crisisTitle: { fontWeight: "700", fontFamily: fonts.sans, fontSize: 15, color: colors.danger },
  crisisLine: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, color: colors.ink },
  crisisNote: { fontFamily: fonts.sans, fontSize: 12, color: colors.inkMuted, lineHeight: 18 },

  sheet: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.roomRaised },
  sheetPeek: { paddingTop: 8, paddingBottom: 10 },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginBottom: 8,
  },
  peekRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  peekVoice: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.inkMuted,
  },
  peekChevron: { flexDirection: "row", alignItems: "center", gap: 6 },
  peekLabel: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.inkMuted,
  },
  peekUrgent: {
    fontFamily: fonts.mono,
    fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
    color: colors.inkMuted,
  },
  sheetBody: { overflow: "hidden" },
  sheetContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24, gap: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: 12,
  },
  // The default row puts a label and a control on one line; the record button
  // has its own text and a pip and does not shrink to make room, so on a
  // narrow phone the two together ran past the edge. Stacked, neither has to.
  rowStacked: { flexDirection: "column", alignItems: "flex-start", gap: 10 },
  rowLabel: { flex: 1, color: colors.ink, fontFamily: fonts.sans, fontSize: 15 },
  rowMeta: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 12 },
  disabledText: { color: colors.inkMuted },
  diagnostic: {
    color: colors.warning,
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
  },
  finish: {
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radii.surface,
    paddingVertical: 13,
    alignItems: "center",
  },
  finishLabel: {
    color: colors.inkSoft,
    fontFamily: fonts.mono,
    fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
  },
  disabled: { opacity: 0.35 },
  footnote: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.inkMuted,
    textAlign: "center",
    lineHeight: 16,
  },

  transcriptScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  transcriptSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "78%",
    backgroundColor: colors.roomRaised,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 10,
  },
  transcriptTitle: {
    textAlign: "center",
    fontFamily: fonts.mono,
    fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
    color: colors.inkMuted,
    marginBottom: 4,
  },
  thread: { padding: 16, gap: 10, paddingBottom: 28 },
  bubble: { borderRadius: radii.surface, padding: 12, maxWidth: "88%" },
  mine: { alignSelf: "flex-end", backgroundColor: colors.ink },
  mineText: { color: colors.room, fontFamily: fonts.sans, fontSize: 16, lineHeight: 22 },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.surfaceBright },
  theirsText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, lineHeight: 22 },
});
