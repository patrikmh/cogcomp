import { create } from "zustand";

import { ApiError, api } from "@/lib/api";
import { deleteItem, getItem, setItem } from "./storage";

/** Where the token is kept, and the tradeoff per platform, lives in ./storage. */
const TOKEN_KEY = "tlon.token";
const USER_KEY = "tlon.userId";
const SIGNED_OUT_KEY = "tlon.signedOut";
const PENDING_LOGOUT_KEY = "tlon.pendingLogout";
let pendingLogoutTokens: string[] = [];
let storageCleanupPending = false;
let sessionGeneration = 0;
let storageQueue = Promise.resolve();

function withStorageLock<T>(task: () => Promise<T>): Promise<T> {
  const next = storageQueue.then(task, task);
  storageQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function parsePendingLogout(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((token): token is string => typeof token === "string");
  } catch { /* Migrate the old single-token representation. */ }
  return [value];
}

async function retryPendingLogout(): Promise<boolean> {
  const tokens = [...pendingLogoutTokens];
  let allRevoked = true;
  for (const token of tokens) {
    try {
      await api.logout(token);
      await withStorageLock(async () => {
        const current = parsePendingLogout(await getItem(PENDING_LOGOUT_KEY));
        const remaining = [...new Set(current.filter((pending) => pending !== token))];
        pendingLogoutTokens = remaining;
        if (remaining.length) await setItem(PENDING_LOGOUT_KEY, JSON.stringify(remaining));
        else await deleteItem(PENDING_LOGOUT_KEY);
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await withStorageLock(async () => {
          const current = parsePendingLogout(await getItem(PENDING_LOGOUT_KEY));
          const remaining = [...new Set(current.filter((pending) => pending !== token))];
          pendingLogoutTokens = remaining;
          if (remaining.length) await setItem(PENDING_LOGOUT_KEY, JSON.stringify(remaining));
          else await deleteItem(PENDING_LOGOUT_KEY);
        });
      } else {
        allRevoked = false;
      }
    }
  }
  return allRevoked;
}

interface SessionState {
  token: string | null;
  userId: string | null;
  ready: boolean;
  restore: () => Promise<void>;
  signIn: (token: string, userId: string) => Promise<void>;
  signOut: () => Promise<void>;
  retrySignOut: () => Promise<void>;
  signOutError: string | null;
}

export const useSession = create<SessionState>((set) => ({
  token: null,
  userId: null,
  ready: false,
  signOutError: null,

  restore: async () => {
    const operation = sessionGeneration;
    try {
      // A tombstone makes a failed keychain deletion fail closed on relaunch:
      // do not restore a token that was captured by a completed sign-out.
      const stored = await withStorageLock(async () => {
        if (await getItem(SIGNED_OUT_KEY)) {
          await Promise.all([deleteItem(TOKEN_KEY), deleteItem(USER_KEY)]);
          await deleteItem(SIGNED_OUT_KEY);
          return { token: null, userId: null, pendingLogout: await getItem(PENDING_LOGOUT_KEY) };
        }
        const [token, userId, pendingLogout] = await Promise.all([
          getItem(TOKEN_KEY),
          getItem(USER_KEY),
          getItem(PENDING_LOGOUT_KEY),
        ]);
        return { token, userId, pendingLogout };
      });
      pendingLogoutTokens = parsePendingLogout(stored.pendingLogout);
      const pendingRestore = retryPendingLogout();
      if (stored.token === null) {
        const pendingRevoked = await pendingRestore;
        if (operation !== sessionGeneration) return;
        set({
          ready: true,
          token: null,
          userId: null,
          ...(pendingRevoked ? {} : { signOutError: "The session could not be revoked. Try again when the server is reachable." }),
        });
        return;
      }
      const { token, userId } = stored;
      await pendingRestore;
      if (operation !== sessionGeneration) return;
      set({ ready: true, token, userId });
    } catch {
      // If storage is unavailable, fail closed rather than rendering an
      // authenticated screen with an unverified principal.
      set({ ready: true, token: null, userId: null, signOutError: "Could not restore the session securely." });
    }
  },

  signIn: async (token, userId) => {
    await withStorageLock(async () => {
      await deleteItem(SIGNED_OUT_KEY);
      await Promise.all([setItem(TOKEN_KEY, token), setItem(USER_KEY, userId)]);
    });
    sessionGeneration += 1;
    storageCleanupPending = false;
    set({ token, userId, signOutError: null });
  },

  signOut: async () => {
    const capturedToken = useSession.getState().token;
    if (!capturedToken) return;
    const operation = ++sessionGeneration;
    storageCleanupPending = false;
    // Clear the in-memory auth boundary before either storage or network I/O.
    set({ token: null, userId: null, signOutError: null });

    let storageError = false;
    try {
      // Leave the tombstone until both bearer-token keys are deleted. If the
      // tombstone write itself fails, still attempt deletion so a transient
      // marker failure cannot skip the actual bearer cleanup.
      await withStorageLock(async () => {
        let markerWritten = false;
        try {
          await setItem(SIGNED_OUT_KEY, "1");
          markerWritten = true;
        } finally {
          await Promise.all([deleteItem(TOKEN_KEY), deleteItem(USER_KEY)]);
          if (markerWritten) await deleteItem(SIGNED_OUT_KEY);
        }
      });
    } catch {
      storageError = true;
    }

    let revocationError = false;
    try {
      await api.logout(capturedToken);
    } catch {
      revocationError = true;
    }

    // A later sign-in owns the UI now; never attach an old logout failure to it.
    if (revocationError) {
      await withStorageLock(async () => {
        const pending = parsePendingLogout(await getItem(PENDING_LOGOUT_KEY));
        pendingLogoutTokens = [...new Set([...pending, capturedToken])];
        await setItem(PENDING_LOGOUT_KEY, JSON.stringify(pendingLogoutTokens));
      }).catch(() => undefined);
    }
    if (operation !== sessionGeneration) return;
    if (storageError || revocationError) {
      storageCleanupPending = storageError;
      set({
        signOutError: storageError
          ? "The session could not be cleared from this device. Try signing out again."
          : "The session could not be revoked. You are signed out here; try again to finish revocation.",
      });
    }
  },

  retrySignOut: async () => {
    if (useSession.getState().token !== null) return;
    const operation = sessionGeneration;
    try {
      if (storageCleanupPending) {
        await withStorageLock(async () => {
          await setItem(SIGNED_OUT_KEY, "1");
          await Promise.all([deleteItem(TOKEN_KEY), deleteItem(USER_KEY)]);
          await deleteItem(SIGNED_OUT_KEY);
        });
        storageCleanupPending = false;
      }
      if (pendingLogoutTokens.length && !(await retryPendingLogout())) {
        throw new Error("logout retry failed");
      }
      if (operation === sessionGeneration) set({ signOutError: null });
    } catch {
      if (operation === sessionGeneration && useSession.getState().token === null) {
        set({ signOutError: "The session could not be cleared or revoked. Try again when the server is reachable." });
      }
    }
  },
}));
