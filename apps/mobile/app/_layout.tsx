import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useSession } from "@/state/session";

/** Sends signed-out users to /login and signed-in users away from it. */
function useAuthGate() {
  const { token, ready, restore } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    // Wait for the keychain read, or we would redirect someone who is in fact
    // still signed in.
    if (!ready) return;
    const onLoginScreen = segments[0] === "login";
    if (!token && !onLoginScreen) {
      router.replace("/login");
    } else if (token && onLoginScreen) {
      router.replace("/");
    }
  }, [token, ready, segments, router]);

  return ready;
}

export default function RootLayout() {
  // One client per app instance, created lazily so a fast refresh does not
  // discard the cache mid-session.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 2,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <Gate />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

function Gate() {
  const ready = useAuthGate();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: "600" },
        }}
      >
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="index" options={{ title: "Journal" }} />
        <Stack.Screen name="today" options={{ title: "Today" }} />
        <Stack.Screen name="talk" options={{ title: "Talk it through" }} />
        <Stack.Screen name="graph" options={{ title: "Graph" }} />
        <Stack.Screen name="explore" options={{ title: "Explore" }} />
        <Stack.Screen name="node/[id]" options={{ title: "Where this came from" }} />
      </Stack>
    </>
  );
}
