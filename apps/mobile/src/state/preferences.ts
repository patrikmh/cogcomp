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
const FINDINGS_KEY = "tlon.findings";

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
  /**
   * Whether the app shows what it has concluded across time — patterns,
   * regions, what changed.
   *
   * On by default, and turning it off is not the same as leaving. Capture keeps
   * working, nothing is deleted, and the findings are still there when someone
   * turns this back on.
   *
   * It exists because the evidence says it has to. Reviews of mood monitoring
   * report that being shown recurring negative material can make things worse
   * for some people some of the time, and this app has no clinician in the loop
   * to notice that. Someone who finds the readings unhelpful this week should be
   * able to stop reading them without abandoning the writing — which is the only
   * part with evidence of helping on its own.
   */
  findings: boolean;
  ready: boolean;
  restore: () => Promise<void>;
  setVoice: (on: boolean) => Promise<void>;
  setDeveloper: (on: boolean) => Promise<void>;
  setFindings: (on: boolean) => Promise<void>;
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
  findings: true,
  ready: false,

  restore: async () => {
    try {
      const [voice, developer, findings] = await Promise.all([
        getItem(VOICE_KEY),
        getItem(DEVELOPER_KEY),
        getItem(FINDINGS_KEY),
      ]);
      set({
        voice: read(voice, true),
        developer: read(developer, false),
        findings: read(findings, true),
        ready: true,
      });
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

  setFindings: async (on) => {
    set({ findings: on });
    await setItem(FINDINGS_KEY, String(on)).catch(() => undefined);
  },
}));
