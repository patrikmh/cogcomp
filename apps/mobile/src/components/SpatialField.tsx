import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import { dockDestinations } from "@/lib/destinations";
import { colors } from "@/theme";
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

export function FieldFrame({ children, label = "Living Observatory field" }: { children: ReactNode; label?: string }) {
  return <View accessibilityLabel={label} style={styles.fieldFrame}><Orbit /><Orbit small />{children}</View>;
}

/** The bar along the bottom. Same destinations as the Journal's orbit — see
 *  `@/lib/destinations` for why that is one list and not two.
 *
 *  It used to sit in the flow at the end of a screen's content, on the eight
 *  screens that happened to wrap themselves in `AtmosphericShell`. Neither half
 *  of that worked: you had to scroll to the bottom to reach it, and the five
 *  screens it points *at* — Journal, Headspace, Today, Week, Identity — were all
 *  in the ten that did not have it. Arriving at Today from a pattern left you
 *  with the back button and nothing else.
 *
 *  Now it is rendered once by the root layout and pinned to the bottom, so it is
 *  the same bar everywhere and cannot be missing from a screen by omission. */
export function SpatialDock() {
  return <View accessibilityRole="toolbar" accessibilityLabel="Observatory routes" style={styles.dock}>{dockDestinations().map(({ href, label, tone }) => <Link key={href} href={href} asChild><Pressable accessibilityRole="link" style={({ pressed }) => [styles.dockItem, pressed && styles.pressed]}><View style={[styles.dockMark, { backgroundColor: tone }]} /><Text style={styles.dockLabel}>{label}</Text></Pressable></Link>)}</View>;
}

export function LoadingLens({ label = "Reading the field…" }: { label?: string }) { return <View accessibilityRole="progressbar" style={styles.state}><View style={styles.loadingRing} /><Text style={styles.stateText}>{label}</Text></View>; }
export function EmptyLens({ label }: { label: string }) { return <View accessibilityRole="summary" style={styles.state}><View style={styles.emptyRing} /><Text style={styles.stateText}>{label}</Text></View>; }
export function ErrorLens({ label }: { label: string }) { return <View accessibilityRole="alert" style={styles.state}><View style={[styles.emptyRing, styles.errorRing]} /><Text style={styles.stateText}>{label}</Text></View>; }

const styles = StyleSheet.create({
  orbit: { position: "absolute", alignSelf: "center", borderWidth: 1, borderRadius: 999, transform: [{ rotate: "24deg" }] },
  large: { width: "78%", height: "82%", top: "9%", borderColor: `${colors.cyan}45` },
  small: { width: "46%", height: "84%", top: "8%", borderColor: `${colors.pink}35`, transform: [{ rotate: "-42deg" }] },
  point: { position: "absolute", width: 8, height: 8, borderRadius: 4, backgroundColor: colors.cyan },
  core: { position: "absolute", top: "31%", alignSelf: "center", alignItems: "center" },
  pearlRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 54, paddingVertical: 8, paddingRight: 8 },
  pearl: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.cyan, shadowColor: colors.cyan, shadowOpacity: 0.7, shadowRadius: 8 },
  pearlTentative: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.warning, shadowOpacity: 0 },
  pearlCopy: { flex: 1, gap: 3 }, pearlLabel: { color: colors.ink, fontSize: 16, lineHeight: 22 }, pearlMeta: { color: colors.inkMuted, fontSize: 12 },
  pressed: { opacity: 0.65 },
  beacon: { alignItems: "center", justifyContent: "center", minWidth: 82, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineStrong }, beaconValue: { fontSize: 25, fontWeight: "700" }, beaconLabel: { color: colors.inkMuted, fontSize: 10, textAlign: "center" },
  rail: { position: "relative", paddingLeft: 20, marginTop: 8 }, railSpine: { position: "absolute", left: 6, top: 0, bottom: 0, width: 1, backgroundColor: colors.lineStrong }, railItems: { gap: 4 },
  constellation: { height: 190, position: "relative", overflow: "hidden", borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line }, constellationNode: { position: "absolute", width: 82, gap: 4 }, constellationDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.cyan }, constellationLabel: { color: colors.inkSoft, fontSize: 10, lineHeight: 13 },
  fieldFrame: { minHeight: 120, position: "relative", overflow: "hidden", borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 12 },
  dock: { flexDirection: "row", justifyContent: "space-around", alignItems: "center", borderTopWidth: 1, borderColor: colors.line, paddingTop: 8, paddingBottom: 8, backgroundColor: colors.room },
  dockItem: { alignItems: "center", gap: 3, paddingHorizontal: 5, paddingVertical: 4 }, dockMark: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.cyan }, dockLabel: { color: colors.inkMuted, fontSize: 10 },
  state: { alignItems: "center", justifyContent: "center", gap: 10, minHeight: 120, padding: 24 }, loadingRing: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.cyan, borderRightColor: "transparent" }, emptyRing: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.lineStrong }, errorRing: { borderColor: colors.danger }, stateText: { color: colors.inkMuted, textAlign: "center", lineHeight: 20 },
});
