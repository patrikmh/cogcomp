import { Suspense } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";

import { lazySkia } from "@/lib/lazySkia";
import { colors } from "@/theme";
import { SpatialDock } from "@/components/SpatialField";

const LazyBlob = lazySkia(() => import("@/components/Blob"));

type AtmosphereVariant = "login" | "journal" | "secondary";

interface AtmosphericBackdropProps {
  variant?: AtmosphereVariant;
}

/** A quiet, non-interactive light source for screens that need a little depth. */
export function AtmosphericBackdrop({
  variant = "journal",
}: AtmosphericBackdropProps) {
  const { width, height } = useWindowDimensions();
  const size = Math.min(390, Math.max(240, width * 0.46));
  const isLogin = variant === "login";
  const isSecondary = variant === "secondary";

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[
          styles.orbit,
          {
            width: size * 1.48,
            height: size * 1.48,
            top: isLogin ? -size * 0.48 : isSecondary ? height * 0.02 : height * 0.04,
            right: isLogin ? -size * 0.52 : isSecondary ? -size * 0.7 : -size * 0.58,
            borderColor: isLogin ? `${colors.violet}38` : isSecondary ? `${colors.cyan}18` : `${colors.cyan}25`,
          },
        ]}
      />
      <View
        style={[
          styles.orbit,
          styles.orbitInner,
          {
            width: size * 1.12,
            height: size * 1.12,
            top: isLogin ? -size * 0.28 : isSecondary ? height * 0.1 : height * 0.13,
            right: isLogin ? -size * 0.34 : isSecondary ? -size * 0.5 : -size * 0.41,
            borderColor: isLogin ? `${colors.pink}30` : isSecondary ? `${colors.violet}16` : `${colors.violet}22`,
          },
        ]}
      />
      <View
        style={[
          styles.signal,
          { top: isLogin ? size * 0.28 : isSecondary ? height * 0.24 : height * 0.28, right: size * 0.3 },
        ]}
      />
      <Suspense fallback={null}>
        <View
          style={[
            styles.blob,
            {
              width: size,
              height: size,
              top: isLogin ? -size * 0.16 : isSecondary ? height * 0.02 : height * 0.08,
              right: isLogin ? -size * 0.18 : isSecondary ? -size * 0.3 : -size * 0.22,
            },
          ]}
        >
          {/* This is decorative only: keep it static so background ambience does
              not consume a timer/frame budget behind the active screen. */}
          <LazyBlob state="idle" size={size} paused />
        </View>
      </Suspense>
      <View
        style={[
          styles.edgeLight,
          {
            top: isLogin ? size * 0.6 : isSecondary ? height * 0.42 : height * 0.46,
            right: isLogin ? size * 0.1 : size * 0.04,
          },
        ]}
      />
    </View>
  );
}

/** Centers a route's working area while keeping the atmospheric layer full bleed. */
export function AtmosphericShell({
  children,
  variant = "journal",
  contentStyle,
}: {
  children: React.ReactNode;
  variant?: AtmosphereVariant;
  contentStyle?: object;
}) {
  return (
    <View style={styles.shell}>
      <AtmosphericBackdrop variant={variant} />
      {/* The dock moved to the root layout, so it is on every screen rather
          than on the eight that happened to use this shell. */}
      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.room, overflow: "hidden" },
  content: {
    flex: 1,
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
    zIndex: 1,
  },
  blob: { position: "absolute", opacity: 0.82 },
  orbit: {
    position: "absolute",
    borderWidth: 1,
    borderRadius: 999,
    opacity: 0.7,
    transform: [{ rotate: "-18deg" }],
  },
  orbitInner: { transform: [{ rotate: "28deg" }] },
  signal: {
    position: "absolute",
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.cyan,
    opacity: 0.75,
  },
  edgeLight: {
    position: "absolute",
    width: 42,
    height: 1,
    backgroundColor: colors.pink,
    opacity: 0.6,
    transform: [{ rotate: "-28deg" }],
  },
});
