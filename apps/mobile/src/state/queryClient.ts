import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/lib/api";

/** True when the server has told us this session is no longer valid. */
export function isExpiredSession(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/**
 * Creates a cache that must only be used for the supplied authenticated principal.
 *
 * Also the single place a dead session is noticed. The auth gate only checks that
 * a token *exists*, so a token the server has since forgotten — revoked, expired,
 * or belonging to an account that no longer exists — used to let you all the way
 * into the app and then fail every request behind it. Every screen showed its own
 * local error ("Could not load this day.") and none of them said the real reason,
 * which is that you are not signed in any more.
 *
 * Handled here rather than per screen because there is no screen this cannot
 * happen on, and a rule enforced in fifteen places is a rule that will be missed
 * in the sixteenth.
 *
 * Retrying is pointless for the same reason: a 401 will still be a 401 in two
 * seconds, so it is excluded from the retry policy and surfaces immediately.
 */
export function createUserQueryClient(
  _userId: string | null,
  onSessionExpired?: () => void,
): QueryClient {
  const expire = (error: unknown) => {
    if (isExpiredSession(error)) onSessionExpired?.();
  };

  return new QueryClient({
    queryCache: new QueryCache({ onError: expire }),
    mutationCache: new MutationCache({ onError: expire }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => !isExpiredSession(error) && failureCount < 2,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
