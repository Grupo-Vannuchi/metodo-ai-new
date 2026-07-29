/**
 * Screen context shared between the client widget and the server route — the
 * "where am I" signal that makes the copilot context-aware. Kept free of
 * server-only imports so the client can build it too.
 */
export type AssistantScreenContext = {
  /** Screen key derived from the path, e.g. "crm", "proposals", "dashboard". */
  screen: string;
  /** Current in-app pathname (locale stripped), e.g. "/app/crm/123". */
  path: string;
  /** Primary entity id in view, when the screen is a detail route. */
  entityId?: string;
};

/**
 * Derive the screen key + entity id from an in-app pathname. `usePathname` from
 * the next-intl navigation helper already returns the locale-stripped path
 * (e.g. "/app/crm/123").
 */
export function screenContextFromPath(pathname: string): AssistantScreenContext {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  // ["app", <screen?>, <id?>, ...]
  const screen = parts[1] || "dashboard";
  const maybeId = parts[2];
  // Treat a segment that isn't a known sub-route word as an entity id.
  const isEntity = maybeId && !["new", "pipelines", "products", "closed", "templates", "entries", "cashflow", "dre", "employees", "payroll", "timeoff", "settings", "access", "audit", "plans", "team", "profile"].includes(maybeId);
  return { screen, path: pathname, entityId: isEntity ? maybeId : undefined };
}
