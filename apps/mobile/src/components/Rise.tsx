import { Children, useEffect, useRef } from "react";
import { Animated, Easing, type ViewStyle } from "react-native";

import { useReducedMotion } from "@/lib/motion";

/**
 * Content arriving, rather than appearing.
 *
 * The web's `sUp` and `jEnter` are the same fourteen pixels and the same half
 * second: opacity 0 to 1, translateY 14 to 0, cubic-bezier(.2,.8,.2,1). Screens
 * settle instead of blinking into place, and a saved entry rises into the list
 * rather than materialising in it.
 *
 * `index` staggers a list the way the web's `nth-child` delays do — each item a
 * little after the one above, so a day reads top to bottom.
 *
 * Reduced motion skips all of it and renders at rest. That is not a nicety: this
 * is an app people open when they are not at their best, and a screen that
 * moves under someone with vestibular trouble is worse than a plain one.
 */
const RISE_MS = 500;
const RISE_PX = 14;
/** 30ms apart, and nothing waits longer than 300 — the web's `.scr > *`
 *  nth-child delays, which stop incrementing at the eleventh child so a long
 *  screen does not take a second and a half to finish arriving. */
const STAGGER_MS = 30;
const STAGGER_CAP_MS = 300;

/**
 * Every top-level block of a screen, arriving in sequence.
 *
 * The web gives `.scr > *` the same treatment, which is what makes a screen feel
 * like it settles rather than blinks. Applying it per-list only, as this did at
 * first, animates the one part of a screen that was already the most obviously
 * alive and leaves the rest static — which reads as less considered than no
 * motion at all.
 */
export function Rising({ children }: { children: React.ReactNode }) {
  return (
    <>
      {Children.toArray(children).map((child, i) => (
        <Rise key={i} index={i}>
          {child}
        </Rise>
      ))}
    </>
  );
}

export function Rise({
  children,
  index = 0,
  style,
  duration = RISE_MS,
  stagger = STAGGER_MS,
  restartKey,
}: {
  children: React.ReactNode;
  index?: number;
  style?: ViewStyle;
  /** The web gives search results .4s rather than .5 — they arrive a little
   *  quicker because you are waiting on them. */
  duration?: number;
  /** Search results step 50ms apart on the web rather than 30 — a shorter list
   *  of answers, each worth landing separately. */
  stagger?: number;
  /** Changing this re-runs the animation. Search results re-animate on every
   *  query on the web, because each search is a new answer rather than the same
   *  list filtered. */
  restartKey?: string;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay: Math.min(index * stagger, STAGGER_CAP_MS),
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, index, reduced, duration, stagger, restartKey]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [RISE_PX, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
