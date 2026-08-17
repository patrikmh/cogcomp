import { create } from "zustand";

import { ApiError, api, currentToken, setToken } from "@/lib/api";

/**
 * Who is signed in.
 *
 * The token lives in `localStorage`, which is the honest limit of a browser
 * session. The important boundary is still here: every screen is behind this
 * store, and the store swaps the query client before a new principal can see
 * the old one.
 */
interface SessionState {
  token: string | null;
  userId: string | null;
  email: string | null;
  ready: boolean;
  restore: () => Promise<void>;
  signIn: (email: string, password: string, mode: "login" | "signup") => Promise<void>;
  signOut: () => Promise<void>;
  retrySignOut: () => Promise<void>;
  signOutError: string | null;
}

const PENDING_LOGOUT_KEY = "tlon.pendingLogout";
function readPendingLogoutTokens(): string[] {
  const raw = localStorage.getItem(PENDING_LOGOUT_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((token): token is string => typeof token === "string");
  } catch { /* Migrate the old single-token representation. */ }
  return [raw];
}
let pendingLogoutTokens = readPendingLogoutTokens();
let sessionGeneration = 0;

function storePendingLogoutTokens(tokens: string[]) {
  pendingLogoutTokens = [...new Set(tokens)];
  if (pendingLogoutTokens.length) localStorage.setItem(PENDING_LOGOUT_KEY, JSON.stringify(pendingLogoutTokens));
  else localStorage.removeItem(PENDING_LOGOUT_KEY);
}

async function retryPendingLogout(): Promise<boolean> {
  const tokens = [...pendingLogoutTokens];
  let allRevoked = true;
  for (const token of tokens) {
    try {
      await api.logout(token);
      storePendingLogoutTokens(readPendingLogoutTokens().filter((pending) => pending !== token));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        storePendingLogoutTokens(readPendingLogoutTokens().filter((pending) => pending !== token));
      } else {
        allRevoked = false;
      }
    }
  }
  return allRevoked;
}

export const useSession = create<SessionState>((set) => ({
  token: currentToken(),
  userId: localStorage.getItem("tlon.user"),
  email: null,
  ready: false,
  signOutError: null,

  restore: async () => {
    const capturedToken = currentToken();
    const operation = sessionGeneration;
    const pendingRestore = retryPendingLogout();
    if (!capturedToken) {
      const pendingRevoked = await pendingRestore;
      set({
        ready: true,
        token: null,
        userId: null,
        email: null,
        ...(pendingRevoked ? {} : { signOutError: "The session could not be revoked. Try again when the server is reachable." }),
      });
      return;
    }
    try {
      const me = await api.me();
      if (operation !== sessionGeneration || currentToken() !== capturedToken) return;
      const pendingRevoked = await pendingRestore;
      if (operation !== sessionGeneration || currentToken() !== capturedToken) return;
      set({
        ready: true,
        email: me.email,
        userId: me.user_id,
        token: capturedToken,
        ...(pendingRevoked ? {} : { signOutError: null }),
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        operation === sessionGeneration &&
        currentToken() === capturedToken
      ) {
        setToken(null);
        localStorage.removeItem("tlon.user");
        set({ ready: true, token: null, userId: null, email: null });
        return;
      }
      // The token is retained when the server is merely unreachable.
      await pendingRestore;
      set({ ready: true });
    }
  },

  signIn: async (email, password, mode) => {
    const result = mode === "signup" ? await api.signup(email, password) : await api.login(email, password);
    sessionGeneration += 1;
    setToken(result.token);
    localStorage.setItem("tlon.user", result.user_id);
    set({ token: result.token, userId: result.user_id, email, ready: true, signOutError: null });
  },

  signOut: async () => {
    const capturedToken = currentToken();
    if (!capturedToken) return;
    const operation = ++sessionGeneration;
    // Tear down the local auth boundary before the network operation so no
    // private query can remain rendered while revocation is pending.
    setToken(null);
    localStorage.removeItem("tlon.user");
    set({ token: null, userId: null, email: null, signOutError: null });
    try {
      await api.logout(capturedToken);
      if (operation === sessionGeneration) set({ signOutError: null });
    } catch {
      // Preserve the failed revocation even if a later sign-in owns the UI now.
      // A newer pending token wins rather than being overwritten by this one.
      try {
        storePendingLogoutTokens([...readPendingLogoutTokens(), capturedToken]);
      } catch {
        // Keep the in-memory retry when browser storage is unavailable.
      }
      if (operation !== sessionGeneration || currentToken() !== null) return;
      set({ signOutError: "The session could not be revoked. You are signed out here; try again to finish revocation." });
    }
  },

  retrySignOut: async () => {
    if (!pendingLogoutTokens.length || currentToken() !== null) return;
    const operation = sessionGeneration;
    const revoked = await retryPendingLogout();
    if (revoked) {
      if (operation === sessionGeneration) set({ signOutError: null });
    } else {
      if (operation === sessionGeneration && currentToken() === null) {
        set({ signOutError: "The session could not be revoked. Try again when the server is reachable." });
      }
    }
  },
}));
