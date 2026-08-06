import { create } from "zustand";

/**
 * Choices about the app itself, mirroring `apps/mobile/src/state/preferences.ts`.
 *
 * `findings` is the one that matters: patterns, regions and changes can be
 * switched off while capture keeps working and nothing is deleted. Someone who
 * finds the readings unhelpful this week needs a way to stop reading them that
 * is not "delete the account".
 */
interface PreferencesState {
  findings: boolean;
  motion: boolean;
  /** Whether the agent reads its side aloud in Talk. */
  voice: boolean;
  setFindings: (on: boolean) => void;
  setMotion: (on: boolean) => void;
  setVoice: (on: boolean) => void;
}

const read = (key: string, fallback: boolean) => {
  const value = localStorage.getItem(key);
  return value === null ? fallback : value === "true";
};

export const usePreferences = create<PreferencesState>((set) => ({
  findings: read("tlon.findings", true),
  motion: read("tlon:hspace-paused", false) === false,
  voice: read("tlon.voice", true),

  setFindings: (on) => {
    localStorage.setItem("tlon.findings", String(on));
    set({ findings: on });
  },
  setMotion: (on) => {
    localStorage.setItem("tlon:hspace-paused", String(!on));
    set({ motion: on });
  },
  setVoice: (on) => {
    localStorage.setItem("tlon.voice", String(on));
    set({ voice: on });
  },
}));
