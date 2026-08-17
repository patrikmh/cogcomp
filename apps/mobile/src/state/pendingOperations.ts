import { deleteItem, getItem, setItem } from "./storage";

export type PendingTalkOperation = {
  id: string;
  userId: string;
  conversationId: string;
  source: "text" | "voice";
  /** Text is immutable. A native URI is retained only as a reconciliation hint. */
  content?: string;
  recordingUri?: string;
  metadata?: { timezone: string };
};

const talkKey = (userId: string, conversationId: string) =>
  `tlon.pending-talk-operations.${encodeURIComponent(userId)}.${encodeURIComponent(conversationId)}`;

let mutationTail: Promise<void> = Promise.resolve();

function serializeMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(mutation, mutation);
  mutationTail = result.then(() => undefined, () => undefined);
  return result;
}

async function read<T>(key: string): Promise<T[]> {
  try { return JSON.parse((await getItem(key)) ?? "[]") as T[]; } catch { return []; }
}

export function pendingTalkOperations(userId: string, conversationId: string): Promise<PendingTalkOperation[]> {
  return read<PendingTalkOperation>(talkKey(userId, conversationId));
}

export function rememberTalkOperation(operation: PendingTalkOperation): Promise<void> {
  return serializeMutation(async () => {
    const key = talkKey(operation.userId, operation.conversationId);
    const values = await read<PendingTalkOperation>(key);
    // The envelope is durable evidence for the server request. Never replace it
    // with a same-ID payload that may belong to a later render or account.
    if (values.some((item) => item.id === operation.id)) return;
    await setItem(key, JSON.stringify([...values, operation]));
  });
}

export function forgetTalkOperation(userId: string, conversationId: string, id: string): Promise<void> {
  return serializeMutation(async () => {
    const key = talkKey(userId, conversationId);
    const values = (await read<PendingTalkOperation>(key)).filter((item) => item.id !== id);
    if (values.length) await setItem(key, JSON.stringify(values));
    else await deleteItem(key);
  });
}

export type PendingCheckin = {
  id: string;
  userId: string;
  experimentId: string;
  content: string;
  capturedAt: string;
  timezone: string;
};

const checkinKey = (userId: string, experimentId: string) =>
  `tlon.pending-checkins.${encodeURIComponent(userId)}.${encodeURIComponent(experimentId)}`;

export function pendingCheckins(userId: string, experimentId: string): Promise<PendingCheckin[]> {
  return read<PendingCheckin>(checkinKey(userId, experimentId));
}

export function rememberCheckin(checkin: PendingCheckin): Promise<void> {
  return serializeMutation(async () => {
    const key = checkinKey(checkin.userId, checkin.experimentId);
    const values = await read<PendingCheckin>(key);
    if (values.some((item) => item.id === checkin.id)) return;
    await setItem(key, JSON.stringify([...values, checkin]));
  });
}

export function forgetCheckin(userId: string, experimentId: string, id: string): Promise<void> {
  return serializeMutation(async () => {
    const key = checkinKey(userId, experimentId);
    const values = (await read<PendingCheckin>(key)).filter((item) => item.id !== id);
    if (values.length) await setItem(key, JSON.stringify(values));
    else await deleteItem(key);
  });
}
