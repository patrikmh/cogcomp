import { type as scale } from "@tlon/design";
import { Image, StyleSheet, Text, View } from "react-native";

import { colors, fonts } from "@/theme";

/**
 * The bar across the top: the wordmark, and one line about where your words go.
 *
 * The design puts the mark here and never the screen's name, because every
 * screen already names itself — a kicker and a title, in its own words. This
 * client put the route's title here instead, so screens said their own name
 * twice, six pixels apart, and the app had no fixed point at the top at all.
 *
 * The design's line reads "private · on device". This app's does not, because
 * this app's entries are stored on an account and sent to a model to draw
 * readings from them. Copying that line because the prototype has it would put
 * a false claim about someone's privacy at the top of every screen. It says
 * what is true here instead, and Words says the rest.
 */
export function TopBar() {
  return (
    <View style={styles.bar}>
      {/* The design sets the mark and the word side by side, 24px then 72px.
          Only the word was drawn here, so the bar had no fixed glyph at its
          left edge the way every screen of the prototype does. */}
      <Image
        source={require("../../assets/tlon-mark.png")}
        style={styles.mark}
        resizeMode="contain"
        accessibilityLabel="Tlön"
      />
      <Image
        source={require("../../assets/tlon-logo.png")}
        style={styles.wordmark}
        resizeMode="contain"
        accessibilityLabel=""
      />
      <Text style={styles.note}>private · never shared</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.room,
  },
  mark: { width: 24, height: 24 },
  wordmark: { width: 72, height: 22, opacity: 0.92 },
  note: {
    marginLeft: "auto",
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 0.36,
  },
});
