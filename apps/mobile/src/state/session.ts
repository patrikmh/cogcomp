import { create } from "zustand";

import { deleteItem, getItem, setItem } from "./storage";

/** Where the token is kept, and the tradeoff per platform, lives in ./storage. */
const TOKEN_KEY = "tlon.token";
const USER_KEY = "tlon.userId";

interface SessionState {
  token: string | null;
  userId: string | null;
  /**
   * False until the keychain has been read, so the login screen doesn't flash at
   * someone who is already signed in.
   */
  ready: boolean;
  restore: () => Promise<void>;
  signIn: (token: string, userId: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  token: null,
  userId: null,
  ready: false,

  restore: async () => {
    try {
      const [token, userId] = await Promise.all([getItem(TOKEN_KEY), getItem(USER_KEY)]);
      set({ token, userId, ready: true });
    } catch {
      // A keychain read can fail on a locked device. Treat that as signed out
      // rather than crashing into an unusable app.
      set({ token: null, userId: null, ready: true });
    }
  },

  signIn: async (token, userId) => {
    await Promise.all([setItem(TOKEN_KEY, token), setItem(USER_KEY, userId)]);
    set({ token, userId });
  },

  signOut: async () => {
    await Promise.all([deleteItem(TOKEN_KEY), deleteItem(USER_KEY)]);
    set({ token: null, userId: null });
  },
}));
