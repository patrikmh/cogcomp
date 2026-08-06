import { create } from "zustand";
import { api, currentToken, setToken } from "@/lib/api";

/**
 * Who is signed in.
 *
 * The token lives in `localStorage`, which is the honest limit of a browser
 * client: there is no keychain here, so anything with script access to this
 * origin can read it. Recorded in the known gaps rather than dressed up.
 */
interface SessionState {
  token: string | null;
  userId: string | null;
  email: string | null;
  ready: boolean;
  restore: () => Promise<void>;
  signIn: (email: string, password: string, mode: "login" | "signup") => Promise<void>;
  signOut: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  token: currentToken(),
  userId: localStorage.getItem("tlon.user"),
  email: null,
  ready: false,

  restore: async () => {
    if (!currentToken()) {
      set({ ready: true, token: null, userId: null });
      return;
    }
    try {
      const me = await api.me();
      set({ token: currentToken(), userId: me.user_id, email: me.email, ready: true });
      localStorage.setItem("tlon.user", me.user_id);
    } catch {
      // A token the server has forgotten. The client clears it in `api.ts`.
      set({ token: null, userId: null, email: null, ready: true });
    }
  },

  signIn: async (email, password, mode) => {
    const result = mode === "signup" ? await api.signup(email, password) : await api.login(email, password);
    setToken(result.token);
    localStorage.setItem("tlon.user", result.user_id);
    set({ token: result.token, userId: result.user_id, email, ready: true });
  },

  signOut: async () => {
    // Revoked server-side too, so a copied token cannot outlive signing out.
    await api.logout().catch(() => undefined);
    setToken(null);
    localStorage.removeItem("tlon.user");
    set({ token: null, userId: null, email: null });
  },
}));
