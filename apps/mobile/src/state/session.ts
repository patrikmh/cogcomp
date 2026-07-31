import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

/**
 * The token lives in the device keychain (Keychain on iOS, Keystore on Android),
 * not AsyncStorage. A bearer token grants full access to someone's journal, so it
 * belongs behind the OS's hardware-backed store rather than in plain app storage
 * that a device backup would carry off.
 */
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
      const [token, userId] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(USER_KEY),
      ]);
      set({ token, userId, ready: true });
    } catch {
      // A keychain read can fail on a locked device. Treat that as signed out
      // rather than crashing into an unusable app.
      set({ token: null, userId: null, ready: true });
    }
  },

  signIn: async (token, userId) => {
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, token),
      SecureStore.setItemAsync(USER_KEY, userId),
    ]);
    set({ token, userId });
  },

  signOut: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
    set({ token: null, userId: null });
  },
}));
