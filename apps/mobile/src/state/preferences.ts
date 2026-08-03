import { create } from "zustand";

import { getItem, setItem } from "./storage";

/**
 * Choices the person has made about the app itself.
 *
 * Separate from the session because they outlive it: signing out should not
 * forget that you turned the voice off or that you want the developer surfaces
 * visible. Kept in the same storage adapter as the token, but nothing here is
 * sensitive — these are preferences, not credentials.
 */

const VOICE_KEY = "tlon.voice";
const DEVELOPER_KEY = "tlon.developer";

interface PreferencesState {
  /** Whether the agent speaks its replies aloud. */
  voice: boolean;
  /**
   * Reveals the screens that exist to inspect the machine rather than to use it:
   * the agent run log, the raw graph readout, the experiment engine.
   *
   * Off by default. Those screens are genuinely valuable — the run log is what
   * makes background inference accountable — but they answer questions most
   * people never ask, and putting them in the main navigation made a journal look
   * like a control panel.
   */
  developer: boolean;
  ready: boolean;
  restore: () => Promise<void>;
  setVoice: (on: boolean) => Promise<void>;
  setDeveloper: (on: boolean) => Promise<void>;
}

/** Stored as strings, since the storage adapter is a string map on both
 *  platforms. Absent means the default rather than false. */
function read(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return value === "true";
}

export const usePreferences = create<PreferencesState>((set) => ({
  voice: true,
  developer: false,
  ready: false,

  restore: async () => {
    try {
      const [voice, developer] = await Promise.all([
        getItem(VOICE_KEY),
        getItem(DEVELOPER_KEY),
      ]);
      set({ voice: read(voice, true), developer: read(developer, false), ready: true });
    } catch {
      // Preferences failing to load is not worth blocking the app for. Defaults
      // are safe: voice on, developer surfaces hidden.
      set({ ready: true });
    }
  },

  setVoice: async (on) => {
    set({ voice: on });
    await setItem(VOICE_KEY, String(on)).catch(() => undefined);
  },

  setDeveloper: async (on) => {
    set({ developer: on });
    await setItem(DEVELOPER_KEY, String(on)).catch(() => undefined);
  },
}));
