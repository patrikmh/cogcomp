import { type as scale } from "@tlon/design";
import { GUIDES, guideBody } from "@tlon/copy/guides";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useReducedMotion } from "@/lib/motion";
import { colors, fonts } from "@/theme";

/**
 * A "?" beside a heading, and one sentence behind it.
 *
 * The design puts this on every screen that makes a claim, and the sentences do
 * a particular job: they say what the screen shows *and* where it stops. "A
 * pattern is not a diagnosis or a cause." "Positions are not meaning." An app
 * that draws conclusions about someone has to be able to say where its
 * conclusions end, and a person has to be able to ask without leaving the
 * screen to find out.
 *
 * Neither client had this. It is the difference between a map you are shown and
 * a map you can interrogate.
 */
const OPEN_MS = 200;
const OPEN_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

export function Guide({ id, lens }: { id: string; lens?: string }) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(0)).current;
  const entry = GUIDES[id];

  useEffect(() => {
    if (reduced) {
      fade.setValue(open ? 1 : 0);
      return;
    }
    const animation = Animated.timing(fade, {
      toValue: open ? 1 : 0,
      duration: OPEN_MS,
      easing: OPEN_EASING,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [fade, open, reduced]);

  if (!entry) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`About ${entry.title}`}
        // 44 square, as the design sizes it: a mark this quiet still has to be
        // reachable with a thumb.
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
        hitSlop={6}
      >
        <View style={styles.ring}>
          <Text style={styles.mark}>?</Text>
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          accessibilityLabel="Close"
        >
          <Animated.View style={[styles.dialog, { opacity: fade }]}>
            <ScrollView>
              <Text style={styles.title}>{entry.title}</Text>
              <Text style={styles.body}>{guideBody(id, lens)}</Text>
            </ScrollView>
            <Pressable
              onPress={() => setOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.close}
            >
              <Text style={styles.closeMark}>×</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.6 },
  ring: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  mark: { color: colors.inkMuted, fontFamily: fonts.monoMedium, fontSize: 12, lineHeight: 14 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(5,8,7,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  dialog: {
    width: "100%",
    maxWidth: 420,
    maxHeight: 520,
    padding: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 4,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.sansBold,
    fontSize: scale.heading.size,
    lineHeight: scale.heading.line,
    marginBottom: 8,
  },
  body: {
    color: colors.inkSoft,
    fontFamily: fonts.sans,
    fontSize: scale.body.size,
    lineHeight: scale.body.line,
  },
  close: { position: "absolute", top: 6, right: 8, padding: 10 },
  closeMark: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 20, lineHeight: 20 },
});
