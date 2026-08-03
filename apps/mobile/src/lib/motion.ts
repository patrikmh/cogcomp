import * as React from "react";
import { AccessibilityInfo, Platform } from "react-native";

export type MotionPolicy = {
  reduced: boolean;
  duration: number;
  allowMomentum: boolean;
  allowScrollAnimation: boolean;
};

/** Pure policy helper kept separate so motion decisions can be tested without a device. */
export function motionPolicy(reduced: boolean): MotionPolicy {
  return {
    reduced,
    duration: reduced ? 0 : 140,
    allowMomentum: !reduced,
    allowScrollAnimation: !reduced,
  };
}

function browserPreference(): boolean | null {
  if (Platform.OS !== "web" || typeof window === "undefined" || !window.matchMedia) return null;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Follows the OS preference on native and prefers-reduced-motion on web. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(browserPreference() ?? false);

  React.useEffect(() => {
    const media = Platform.OS === "web" && typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    const update = (value: boolean) => setReduced(value);
    if (media) {
      update(media.matches);
      const listener = (event: MediaQueryListEvent) => update(event.matches);
      media.addEventListener?.("change", listener);
      return () => media.removeEventListener?.("change", listener);
    }
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) update(value);
    }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", update);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

