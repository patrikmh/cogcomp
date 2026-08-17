import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import { colors, fonts } from "@/theme";
import { constellationPoint } from "@/lib/spatial";

/** Shared, static geometry for the Living Observatory routes. */
export function Orbit({ small = false }: { small?: boolean }) {
  return <View pointerEvents="none" style={[styles.orbit, small ? styles.small : styles.large]} />;
}

export function SignalPoint({ style }: { style?: object }) {
  return <View accessibilityElementsHidden pointerEvents="none" style={[styles.point, style]} />;
}

export function SpatialCore({ children }: { children: ReactNode }) {
  return <View style={styles.core}>{children}</View>;
}

/** A semantic, reachable observation light rather than a generic card. */
export function ObservablePearl({
  label,
  meta,
  onPress,
  tentative = false,
}: {
  label: string;
  meta?: string;
  onPress?: () => void;
  tentative?: boolean;
}) {
  const content = <><View style={[styles.pearl, tentative && styles.pearlTentative]} /><View style={styles.pearlCopy}><Text style={styles.pearlLabel}>{label}</Text>{meta && <Text style={styles.pearlMeta}>{meta}</Text>}</View></>;
  if (!onPress) return <View accessibilityRole="summary" style={styles.pearlRow}>{content}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.pearlRow, pressed && styles.pressed]}>{content}</Pressable>;
}

export function InferenceLens({ label, meta, onPress, tentative = false }: { label: string; meta?: string; onPress?: () => void; tentative?: boolean }) {
  return <ObservablePearl label={label} meta={meta ? `Lens · ${meta}` : "Lens · hypothesis"} onPress={onPress} tentative={tentative} />;
}

export function MetricBeacon({ value, label, tone = colors.cyan }: { value: string | number; label: string; tone?: string }) {
  return <View accessibilityLabel={`${value} ${label}`} style={styles.beacon}><Text style={[styles.beaconValue, { color: tone }]}>{value}</Text><Text style={styles.beaconLabel}>{label}</Text></View>;
}

export function EvidenceRail({ children, label = "Evidence sequence" }: { children: ReactNode; label?: string }) {
  return <View accessibilityLabel={label} style={styles.rail}><View style={styles.railSpine} /><View style={styles.railItems}>{children}</View></View>;
}

/** Deterministic constellation for lists that need a visual overview and a readable fallback. */
export function SpatialConstellation({ ids, labels, onSelect }: { ids: string[]; labels: string[]; onSelect?: (id: string) => void }) {
  return <View accessibilityLabel="Signal constellation" style={styles.constellation}>{ids.map((id, index) => { const point = constellationPoint(id, index); return <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Focus ${labels[index]}`} onPress={() => onSelect?.(id)} style={[styles.constellationNode, { left: `${point.x * 100}%`, top: `${point.y * 100}%` }]}><View style={styles.constellationDot} /><Text numberOfLines={2} style={styles.constellationLabel}>{labels[index]}</Text></Pressable>; })}</View>;
}

/**
 * The frame the Observatory routes sit in.
 *
 * It used to draw two tilted rings behind whatever it held — a cyan one and a
 * pink one, on six screens. The design draws none: its stages are the contours
 * and the ground they sit on, and nothing else. On the talk screen the outer
 * ring read as part of the avatar, which made a shape that has nine rings look
 * like it had ten and one of them was stuck.
 *
 * The frame stays, because it is what lays these screens out. Only the paint is
 * gone — both rings were absolutely positioned and took no pointer events, so
 * nothing moved when they went.
 */
export function FieldFrame({ children, label = "Living Observatory field" }: { children: ReactNode; label?: string }) {
  return <View accessibilityLabel={label} style={styles.fieldFrame}>{children}</View>;
}

export function LoadingLens({ label = "Reading the field…" }: { label?: string }) { return <View accessibilityRole="progressbar" style={styles.state}><View style={styles.loadingRing} /><Text style={styles.stateText}>{label}</Text></View>; }
export function EmptyLens({ label }: { label: string }) { return <View accessibilityRole="summary" style={styles.state}><View style={styles.emptyRing} /><Text style={styles.stateText}>{label}</Text></View>; }
export function ErrorLens({ label, onRetry }: { label: string; onRetry?: () => void }) { return <View accessibilityRole="alert" style={styles.state}><View style={[styles.emptyRing, styles.errorRing]} /><Text style={styles.stateText}>{label}</Text>{onRetry && <Pressable accessibilityRole="button" accessibilityLabel="Retry loading" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable>}</View>; }

const styles = StyleSheet.create({
  orbit: { position: "absolute", alignSelf: "center", borderWidth: 1, borderRadius: 999, transform: [{ rotate: "24deg" }] },
  large: { width: "78%", height: "82%", top: "9%", borderColor: `${colors.cyan}45` },
  small: { width: "46%", height: "84%", top: "8%", borderColor: `${colors.pink}35`, transform: [{ rotate: "-42deg" }] },
  point: { position: "absolute", width: 8, height: 8, borderRadius: 4, backgroundColor: colors.cyan },
  core: { position: "absolute", top: "31%", alignSelf: "center", alignItems: "center" },
  pearlRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 54, paddingVertical: 8, paddingRight: 8 },
  pearl: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.cyan, shadowColor: colors.cyan, shadowOpacity: 0.7, shadowRadius: 8 },
  pearlTentative: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.warning, shadowOpacity: 0 },
  pearlCopy: { flex: 1, gap: 3 }, pearlLabel: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, lineHeight: 22 }, pearlMeta: { color: colors.inkMuted, fontSize: 12 },
  pressed: { opacity: 0.65 },
  beacon: { alignItems: "center", justifyContent: "center", minWidth: 82, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineStrong }, beaconValue: { fontFamily: fonts.sans, fontSize: 25, fontWeight: "700" }, beaconLabel: { color: colors.inkMuted, fontSize: 10, textAlign: "center" },
  rail: { position: "relative", paddingLeft: 20, marginTop: 8 }, railSpine: { position: "absolute", left: 6, top: 0, bottom: 0, width: 1, backgroundColor: colors.lineStrong }, railItems: { gap: 4 },
  constellation: { height: 190, position: "relative", overflow: "hidden", borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line }, constellationNode: { position: "absolute", width: 82, gap: 4 }, constellationDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.cyan }, constellationLabel: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 10, lineHeight: 13 },
  fieldFrame: { minHeight: 120, position: "relative", overflow: "hidden", borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 12 },
  dock: { flexDirection: "row", justifyContent: "space-around", alignItems: "center", borderTopWidth: 1, borderColor: colors.line, paddingTop: 8, paddingBottom: 8, backgroundColor: colors.room },
  dockItem: { alignItems: "center", gap: 3, paddingHorizontal: 5, paddingVertical: 4 },
  // `quiet` finally does something. It has been on Settings since the list was
  // written and no menu had ever read it.
  dockMarkQuiet: { opacity: 0.5 }, dockLabelQuiet: { opacity: 0.6 }, dockMark: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.cyan }, dockLabel: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 10 },
  state: { alignItems: "center", justifyContent: "center", gap: 10, minHeight: 120, padding: 24 }, retry: { minHeight: 44, paddingHorizontal: 18, paddingVertical: 10, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 4 }, retryText: { color: colors.ink, fontFamily: fonts.sans, fontWeight: "600" }, loadingRing: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.cyan, borderRightColor: "transparent" }, emptyRing: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.lineStrong }, errorRing: { borderColor: colors.danger }, stateText: { color: colors.inkMuted, textAlign: "center", lineHeight: 20 },
});
