import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * Tactile feedback, safe to call anywhere.
 *
 * `expo-haptics` has no web implementation — the native module is simply
 * absent there, and calling it rejects with `UnavailabilityError` rather than
 * quietly doing nothing. Every call in this app goes through here so that
 * fact lives in one place instead of a `.catch(() => undefined)` next to every
 * press handler that wants a tap.
 */

/** A short, discrete confirmation — starting or stopping something. */
export function tapHaptic(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium) {
  if (Platform.OS === "web") return;
  void Haptics.impactAsync(style).catch(() => undefined);
}

/** The lighter tick for a state changing without a distinct start/stop — a
 *  toggle, a sheet opening. */
export function selectHaptic() {
  if (Platform.OS === "web") return;
  void Haptics.selectionAsync().catch(() => undefined);
}

export { Haptics };
