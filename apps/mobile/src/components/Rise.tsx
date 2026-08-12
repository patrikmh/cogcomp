import { useEffect, useRef } from "react";
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
const STAGGER_MS = 40;

export function Rise({
  children,
  index = 0,
  style,
}: {
  children: React.ReactNode;
  index?: number;
  style?: ViewStyle;
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
      duration: RISE_MS,
      delay: Math.min(index, 8) * STAGGER_MS,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, index, reduced]);

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
