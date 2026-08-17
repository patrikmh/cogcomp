import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";

import "@tlon/design/tokens.css";
import "./styles/fonts.css";
import "./styles/tlon.css";
import { App } from "./App";
import { useSession } from "@/state/session";

function UserQueryBoundary() {
  const userId = useSession((session) => session.userId);
  const queryClient = useMemo(
    () => new QueryClient({
      defaultOptions: {
        queries: {
          retry: 1,
          refetchOnWindowFocus: false,
          staleTime: 15_000,
          meta: { userId },
        },
      },
    }),
    [userId],
  );

  return (
    <QueryClientProvider client={queryClient} key={userId ?? "signed-out"}>
      {/* Hash routing, because the prototype's URLs are already #/patterns and
          the design tool's whole QA trail is recorded against them. */}
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UserQueryBoundary />
  </StrictMode>,
);
