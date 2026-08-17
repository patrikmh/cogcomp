/** Routes that may render without a session. Keep this list deliberately small. */
export const PUBLIC_ROUTES = ["/login", "/words"] as const;

export function isPublicRoute(pathname: string): boolean {
  const route = (pathname.split("?")[0] ?? "/").replace(/\/$/, "") || "/";
  return (PUBLIC_ROUTES as readonly string[]).includes(route);
}
