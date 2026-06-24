import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const demoMode = process.env.NEXT_PUBLIC_AUTHCLAW_DEMO_MODE !== "false";
  const demoBlockedPaths = ["/agent", "/frameworks", "/evidence", "/findings", "/aws"];
  
  // 1. Define public and asset paths
  const isPublicPath = path === "/login" || path === "/signup" || path.startsWith("/api/auth");
  const isAssetPath =
    path.startsWith("/_next") ||
    path.startsWith("/favicon.ico") ||
    path.startsWith("/api/"); // skip standard middleware for internal APIs (handled in routes)

  if (isAssetPath) {
    return NextResponse.next();
  }

  // 2. Extract session cookie
  const sessionCookie = request.cookies.get("authclaw_session")?.value;
  let sessionRole = "viewer";
  if (sessionCookie) {
    try {
      sessionRole = (JSON.parse(sessionCookie).role || "viewer").toLowerCase();
    } catch {
      sessionRole = "viewer";
    }
  }

  // 3. Handle redirects
  if (!sessionCookie && !isPublicPath) {
    // Redirect unauthenticated user to login
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (sessionCookie && path === "/login") {
    // Redirect authenticated user away from login to the demo onboarding flow
    return NextResponse.redirect(new URL("/connect", request.url));
  }

  if (sessionCookie && path === "/signup") {
    return NextResponse.redirect(new URL("/connect", request.url));
  }

  if (sessionCookie && path === "/") {
    // Redirect root to the demo onboarding flow
    return NextResponse.redirect(new URL("/connect", request.url));
  }

  if (demoMode && demoBlockedPaths.some((blockedPath) => path === blockedPath || path.startsWith(`${blockedPath}/`))) {
    return NextResponse.redirect(new URL("/connect", request.url));
  }

  const viewerBlockedPaths = ["/connect", "/gateway", "/policies", "/settings"];
  if (
    sessionCookie &&
    sessionRole === "viewer" &&
    viewerBlockedPaths.some((blockedPath) => path === blockedPath || path.startsWith(`${blockedPath}/`))
  ) {
    return NextResponse.redirect(new URL("/overview", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
