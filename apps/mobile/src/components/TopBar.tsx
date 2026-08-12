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
      <Image
        source={require("../../assets/tlon-logo.png")}
        style={styles.wordmark}
        resizeMode="contain"
        accessibilityLabel="Tlön"
      />
      <Text style={styles.note}>private · never shared</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 12 },
  wordmark: { width: 86, height: 26, opacity: 0.9 },
  note: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: scale.kicker.size,
    letterSpacing: 0.8,
  },
});
