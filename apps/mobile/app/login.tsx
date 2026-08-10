import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { MotionSurface } from "@/components/MotionSurface";
import { FieldFrame } from "@/components/SpatialField";
import { AtmosphericShell } from "@/components/Atmospheric";
import { ApiError, api } from "@/lib/api";
import { colors } from "@/theme";
import { useSession } from "@/state/session";

const MIN_PASSWORD_LENGTH = 12;

export default function LoginScreen() {
  const signIn = useSession((s) => s.signIn);
  const { width } = useWindowDimensions();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      const device = Platform.OS === "ios" ? "iPhone" : Platform.OS;
      const result =
        mode === "signup"
          ? await api.signup(email.trim(), password, device)
          : await api.login(email.trim(), password, device);
      await signIn(result.token, result.user_id);
    },
  });

  const isSignup = mode === "signup";
  const passwordTooShort = isSignup && password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const canSubmit =
    email.trim().length > 0 && password.length > 0 && !passwordTooShort && !submit.isPending;

  return (
    <AtmosphericShell variant="login">
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.bay, width >= 760 && styles.bayWide]}>
          {width >= 760 && <View style={[styles.dockLabel, styles.dockLabelWide]}><Text style={styles.dockKicker}>LIVING OBSERVATORY</Text><Text style={styles.dockTitle}>A private field for noticing.</Text><Text style={styles.dockCopy}>Enter through the quiet side of the room. Your words stay yours.</Text></View>}
        <FieldFrame label="Account portal">
        <View style={[styles.form, width >= 760 && styles.formWide]}>
          <View style={styles.header}>
        <Text style={styles.title}>Tlön</Text>
        <Text style={styles.subtitle}>
          {isSignup ? "Create an account." : "Welcome back."}
        </Text>
      </View>

      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        accessibilityLabel="Email address"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        editable={!submit.isPending}
      />
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        accessibilityLabel="Password"
        secureTextEntry
        autoCapitalize="none"
        // Prompts the OS keychain to offer a strong password on signup.
        textContentType={isSignup ? "newPassword" : "password"}
        editable={!submit.isPending}
      />

      {isSignup && (
        <Text style={passwordTooShort ? styles.hintWarn : styles.hint}>
          At least {MIN_PASSWORD_LENGTH} characters. A few plain words beat one
          clever one.
        </Text>
      )}

      <MotionSurface
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        disabled={!canSubmit}
        onPress={() => submit.mutate()}
      >
        <Text style={styles.buttonLabel}>
          {submit.isPending ? "…" : isSignup ? "Create account" : "Sign in"}
        </Text>
      </MotionSurface>

      {submit.isError && (
        <Text style={styles.error}>
          {submit.error instanceof ApiError
            ? submit.error.message
            : "Could not reach the server."}
        </Text>
      )}

      <MotionSurface
        onPress={() => {
          setMode(isSignup ? "login" : "signup");
          submit.reset();
        }}
      >
        <Text style={styles.switch}>
          {isSignup ? "I already have an account" : "Create an account instead"}
        </Text>
      </MotionSurface>

          <Text style={styles.footnote}>
            Your entries are stored on the server so they can be analysed. Nothing is
            shared with anyone else.
          </Text>
        </View>
        </FieldFrame>
        </View>
      </KeyboardAvoidingView>
    </AtmosphericShell>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", padding: 24 },
  bay: { width: "100%", alignSelf: "center", maxWidth: 980 },
  bayWide: {
    flexDirection: "row",
    alignItems: "center",
    gap: 64,
    // `bay` sets alignSelf:center, which makes the row hug its content instead
    // of filling the screen. The form is a fixed 460, so the text column got
    // whatever was left — 48px, which is why it wrapped one character per line.
    // Stretching the row is the actual fix; the fixed form width alone was not.
    alignSelf: "stretch",
    width: "100%",
  },
  // And a floor, so no future layout change can squeeze this column to nothing
  // again without something visibly overflowing instead.
  dockLabelWide: { minWidth: 260 },
  dockLabel: { flex: 1, gap: 12, paddingLeft: 8 },
  dockKicker: { color: colors.cyan, fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  dockTitle: { color: colors.ink, fontSize: 34, lineHeight: 39, fontWeight: "700" },
  dockCopy: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, maxWidth: 250 },
  form: { width: "100%", maxWidth: 460, alignSelf: "center", gap: 12 },
  // In the wide two-column layout the form sits in a row, where width:100% makes
  // it claim the whole bay and squeezes the text column to nothing — which is
  // what wrapped that column one character per line. Fixed width and no shrink
  // keeps both columns real.
  formWide: { width: 460, flexGrow: 0, flexShrink: 0, alignSelf: "auto" },
  header: { marginBottom: 12, gap: 4 },
  title: { fontSize: 32, fontWeight: "700", color: colors.ink, letterSpacing: -0.6 },
  subtitle: { fontSize: 16, color: colors.inkMuted },
  input: {
    backgroundColor: colors.surface,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
  },
  button: {
    backgroundColor: colors.violet,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { color: colors.room, fontWeight: "600", fontSize: 16 },
  switch: { color: colors.inkSoft, textAlign: "center", paddingVertical: 8 },
  hint: { fontSize: 13, color: colors.inkMuted },
  hintWarn: { fontSize: 13, color: colors.warning },
  error: { color: colors.danger, fontSize: 14 },
  footnote: {
    marginTop: 16,
    fontSize: 12,
    lineHeight: 18,
    color: colors.inkMuted,
    textAlign: "center",
  },
});
