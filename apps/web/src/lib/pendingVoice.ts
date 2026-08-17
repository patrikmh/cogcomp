export type PendingVoiceEnvelope = {
  id: string;
  userId: string;
  source: "journal" | "talk";
  capturedAt: string;
  timezone: string;
  conversationId?: string;
  audio: Blob;
};

const DB = "tlon-pending-voice";
const STORE = "envelopes";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}
const key = (e: Pick<PendingVoiceEnvelope, "userId" | "source" | "id" | "conversationId">) =>
  `${e.userId}:${e.source}:${e.conversationId ?? ""}:${e.id}`;

export async function putPendingVoice(e: PendingVoiceEnvelope): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put({ ...e, key: key(e) });
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  db.close();
}
export async function listPendingVoice(userId: string, source?: PendingVoiceEnvelope["source"]): Promise<PendingVoiceEnvelope[]> {
  const db = await open();
  return await new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => { db.close(); resolve((request.result as (PendingVoiceEnvelope & { key: string })[]).filter((e) => e.userId === userId && (!source || e.source === source))); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
export async function deletePendingVoice(e: Pick<PendingVoiceEnvelope, "userId" | "source" | "id" | "conversationId">): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => { const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(key(e)); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
  db.close();
}
