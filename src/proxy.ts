import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

/**
 * Next.js 16 renamed the `middleware` convention to `proxy` (Node.js runtime).
 * Here it drives next-intl locale negotiation and prefixing. Tenant/session
 * authorization is enforced server-side in the DAL (`getOrgContext` /
 * `requireOrgContext` in `@/lib/tenant`), not here.
 */
const handle = createMiddleware(routing);

export default handle;

export const config = {
  // Run on every path except API routes, Next internals and files with an
  // extension (images, fonts, etc.).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
