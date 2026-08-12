import { type as scale } from "@tlon/design";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Glyph } from "@/components/Glyph";
import { Kicker } from "@/components/Marks";
import { GROUPS, type Destination } from "@/lib/destinations";
import { useReducedMotion } from "@/lib/motion";
import { colors, fonts } from "@/theme";

/**
 * The whole map, behind one tab.
 *
 * Grouped by what each destination is *for* rather than listed flat, and each
 * row carries how much is behind it — a count is the difference between a door
 * you open and a door you know is worth opening. Where there is nothing to
 * count, nothing is shown: "0" reads as a failure, and an empty week is not one.
 *
 * It rises from the bottom on the design's own curve rather than appearing, so
 * it reads as a drawer being pulled rather than a screen replacing the one you
 * were on — you have not gone anywhere until you choose to.
 */
const RISE_MS = 260;
const RISE_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

export function MoreSheet({
  open,
  onClose,
  counts,
  here,
}: {
  open: boolean;
  onClose: () => void;
  /** How much is behind each door, by the destination's `count` key. */
  counts: Partial<Record<NonNullable<Destination["count"]>, string>>;
  /** The route already being looked at, marked rather than offered. */
  here: string;
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      rise.setValue(open ? 1 : 0);
      return;
    }
    const animation = Animated.timing(rise, {
      toValue: open ? 1 : 0,
      duration: RISE_MS,
      easing: RISE_EASING,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [open, reduced, rise]);

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose}>
      {/* Anywhere off the sheet closes it. A drawer you cannot dismiss by
          looking away is a screen pretending to be a drawer. */}
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <Animated.View
        style={[
          styles.sheet,
          {
            transform: [
              { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) },
            ],
            opacity: rise,
          },
        ]}
      >
        <View style={styles.handle} />
        <ScrollView contentContainerStyle={styles.list}>
          {GROUPS.map((group) => (
            <View key={group.title} style={styles.group}>
              <Kicker>{group.title}</Kicker>
              {group.items.map((item) => {
                const current = item.href === here;
                return (
                  <Pressable
                    key={`${group.title}-${item.href}`}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                    onPress={() => {
                      onClose();
                      router.push(item.href);
                    }}
                    accessibilityRole="link"
                    accessibilityState={{ selected: current }}
                  >
                    <Glyph
                      name={item.glyph}
                      size={22}
                      tone={current ? colors.cyan : colors.inkMuted}
                    />
                    <Text style={[styles.label, current && styles.labelHere]}>{item.label}</Text>
                    {item.count && counts[item.count] ? (
                      <Text style={styles.count}>{counts[item.count]}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "82%",
    backgroundColor: colors.roomRaised,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginTop: 10,
  },
  list: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
  group: { marginBottom: 14, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 11 },
  pressed: { opacity: 0.6 },
  label: { flex: 1, color: colors.ink, fontFamily: fonts.sans, fontSize: scale.body.size },
  labelHere: { color: colors.cyan },
  count: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size },
});
