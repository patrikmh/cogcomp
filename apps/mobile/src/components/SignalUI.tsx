import { StyleSheet, Text, View } from "react-native";
import { MotionSurface } from "@/components/MotionSurface";
import { colors, fonts } from "@/theme";

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

export function SignalRule() {
  return <View style={styles.rule} />;
}

export function SignalDot({ tone = colors.cyan }: { tone?: string }) {
  return <View accessibilityElementsHidden style={[styles.dot, { backgroundColor: tone }]} />;
}

export function ActionLink({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <MotionSurface accessibilityRole="button" disabled={disabled} onPress={onPress} style={styles.action} hitSlop={8}><Text style={[styles.actionText, disabled && styles.disabled]}>{label}</Text></MotionSurface>;
}

const styles = StyleSheet.create({
  eyebrow: { color: colors.cyan, fontFamily: fonts.sans, fontSize: 11, fontWeight: "700", letterSpacing: 1.8, textTransform: "uppercase" },
  rule: { height: 1, backgroundColor: colors.line, opacity: 0.9 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  action: { minHeight: 44, justifyContent: "center" },
  actionText: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.4 },
});
