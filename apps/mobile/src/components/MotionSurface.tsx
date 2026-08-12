import { useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, type PressableProps, type PressableStateCallbackType, type StyleProp, type ViewStyle } from "react-native";
import { motionPolicy, useReducedMotion } from "@/lib/motion";
import { colors } from "@/theme";

type MotionSurfaceProps = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
  /** Use none for gesture overlays and controls where any visual press feedback is unsafe. */
  motion?: "press" | "none";
};

/** Shared, restrained depth cue for interactive surfaces. */
export function MotionSurface({ style, motion = "press", onPressIn, onPressOut, onFocus, onBlur, ...props }: MotionSurfaceProps) {
  const reduced = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const policy = motionPolicy(reduced);
  const animate = (toValue: number) => {
    if (motion === "none") return;
    Animated.timing(scale, { toValue, duration: policy.duration, useNativeDriver: true }).start();
  };
  const styled = (state: PressableStateCallbackType) => {
    const webState = state as PressableStateCallbackType & { hovered?: boolean; focused?: boolean };
    return [
      typeof style === "function" ? style(state) : style,
      webState.hovered && styles.hovered,
      (focused || webState.focused) && styles.focused,
    ];
  };
  const handlePressIn: NonNullable<PressableProps["onPressIn"]> = (event) => {
    animate(0.97);
    onPressIn?.(event);
  };
  const handlePressOut: NonNullable<PressableProps["onPressOut"]> = (event) => {
    animate(1);
    onPressOut?.(event);
  };
  const handleFocus: NonNullable<PressableProps["onFocus"]> = (event) => {
    setFocused(true);
    onFocus?.(event);
  };
  const handleBlur: NonNullable<PressableProps["onBlur"]> = (event) => {
    setFocused(false);
    onBlur?.(event);
  };
  const layoutStyle = typeof style === "function" ? undefined : extractLayoutStyle(style);
  // Layout normally moves to the animated wrapper, so it is stripped from the
  // Pressable to avoid applying it twice. With `motion="none"` there is no
  // wrapper — stripping it there dropped width, height and margins on the
  // floor, which is how the composer's microphone ended up 22px instead of 44
  // and sitting on its own line.
  const strip = motion !== "none";
  const pressable = (
    <Pressable
      {...props}
      style={
        typeof style === "function"
          ? styled
          : (state) => (strip ? removeLayoutStyle(styled(state)) : styled(state))
      }
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    />
  );

  if (motion === "none") return pressable;
  return (
    <Animated.View style={[styles.wrapper, layoutStyle, { transform: [{ scale }] }]}>
      {pressable}
    </Animated.View>
  );
}

function removeLayoutStyle(style: StyleProp<ViewStyle>): StyleProp<ViewStyle> {
  const flattened = StyleSheet.flatten(style) ?? {};
  const layoutKeys: (keyof ViewStyle)[] = [
    "alignSelf", "flex", "flexBasis", "flexGrow", "flexShrink", "height",
    "margin", "marginBottom", "marginEnd", "marginHorizontal", "marginLeft",
    "marginRight", "marginStart", "marginTop", "marginVertical", "maxHeight",
    "maxWidth", "minHeight", "minWidth", "position", "width",
  ];
  const visual = { ...flattened };
  layoutKeys.forEach((key) => delete visual[key]);
  return visual;
}

function extractLayoutStyle(style: StyleProp<ViewStyle>): ViewStyle {
  const flattened = StyleSheet.flatten(style) ?? {};
  const layoutKeys: (keyof ViewStyle)[] = [
    "alignSelf", "flex", "flexBasis", "flexGrow", "flexShrink", "height",
    "margin", "marginBottom", "marginEnd", "marginHorizontal", "marginLeft",
    "marginRight", "marginStart", "marginTop", "marginVertical", "maxHeight",
    "maxWidth", "minHeight", "minWidth", "position", "width",
  ];
  return Object.fromEntries(
    layoutKeys.filter((key) => flattened[key] !== undefined).map((key) => [key, flattened[key]]),
  ) as ViewStyle;
}

const styles = StyleSheet.create({
  wrapper: { alignSelf: "stretch" },
  hovered: { shadowColor: colors.ink, shadowOpacity: 0.12, shadowRadius: 5, elevation: 2 },
  focused: { shadowColor: colors.cyan, shadowOpacity: 0.28, shadowRadius: 7, elevation: 3 },
});
