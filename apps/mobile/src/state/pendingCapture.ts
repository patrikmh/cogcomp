import { deleteItem, getItem, setItem } from "./storage";

export type PendingCapture = {
  id: string;
  userId: string;
  content?: string;
  source: "text" | "voice";
  uri?: string;
  capturedAt: string;
  timezone: string;
};

const key = (userId: string) => `tlon.pending-captures.${encodeURIComponent(userId)}`;
let writeQueue = Promise.resolve();

function withWriteLock<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
}

export async function pendingCaptures(userId: string): Promise<PendingCapture[]> {
  try {
    const values = JSON.parse((await getItem(key(userId))) ?? "[]") as PendingCapture[];
    return values.filter((item) => item.userId === userId);
  } catch { return []; }
}

export async function rememberCapture(capture: PendingCapture): Promise<void> {
  return withWriteLock(async () => {
    const values = await pendingCaptures(capture.userId);
    // Once an id has been sent, its content, URI, and timestamp are immutable.
    if (values.some((item) => item.id === capture.id)) return;
    await setItem(key(capture.userId), JSON.stringify([...values, capture]));
  });
}

export async function forgetCapture(userId: string, id: string): Promise<void> {
  return withWriteLock(async () => {
    const values = (await pendingCaptures(userId)).filter((item) => item.id !== id);
    if (values.length) await setItem(key(userId), JSON.stringify(values));
    else await deleteItem(key(userId));
  });
}
