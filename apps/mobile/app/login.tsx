import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiError, api } from "@/lib/api";
import { useSession } from "@/state/session";

const MIN_PASSWORD_LENGTH = 12;

export default function LoginScreen() {
  const signIn = useSession((s) => s.signIn);
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
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
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

      <Pressable
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        disabled={!canSubmit}
        onPress={() => submit.mutate()}
      >
        <Text style={styles.buttonLabel}>
          {submit.isPending ? "…" : isSignup ? "Create account" : "Sign in"}
        </Text>
      </Pressable>

      {submit.isError && (
        <Text style={styles.error}>
          {submit.error instanceof ApiError
            ? submit.error.message
            : "Could not reach the server."}
        </Text>
      )}

      <Pressable
        onPress={() => {
          setMode(isSignup ? "login" : "signup");
          submit.reset();
        }}
      >
        <Text style={styles.switch}>
          {isSignup ? "I already have an account" : "Create an account instead"}
        </Text>
      </Pressable>

      <Text style={styles.footnote}>
        Your entries are stored on the server so they can be analysed. Nothing is
        shared with anyone else.
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  header: { marginBottom: 12, gap: 4 },
  title: { fontSize: 32, fontWeight: "700" },
  subtitle: { fontSize: 16, color: "#71717a" },
  input: {
    borderWidth: 1,
    borderColor: "#d4d4d8",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#18181b",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { color: "#fafafa", fontWeight: "600", fontSize: 16 },
  switch: { color: "#3f3f46", textAlign: "center", paddingVertical: 8 },
  hint: { fontSize: 13, color: "#71717a" },
  hintWarn: { fontSize: 13, color: "#b45309" },
  error: { color: "#b91c1c", fontSize: 14 },
  footnote: {
    marginTop: 16,
    fontSize: 12,
    lineHeight: 18,
    color: "#a1a1aa",
    textAlign: "center",
  },
});
