import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isLoginAllowed, isSessionAllowed } from "@/lib/auth/login-policy";

// Public paths that must stay reachable without a session. /r and /s are
// token-gated share pages (report deck / board overview) - the page itself
// validates the token, so the middleware must not bounce them to /login.
// The app manifest too: the phone fetches it without a session (before
// login, and without cookies), and a redirect to /login broke the "Dodaj do
// ekranu początkowego" install. (Icons are .png - the matcher skips them.)
const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/privacy",
  "/terms",
  "/r",
  "/s",
  "/demo",
  "/demo-full",
  "/manifest.webmanifest",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export async function middleware(request: NextRequest) {
  // Dev query log (lib/supabase/perf.ts) labels each request by its path.
  if (process.env.PERF_LOG) {
    request.headers.set("x-perf-path", request.nextUrl.pathname + request.nextUrl.search);
  }
  // Response we mutate so refreshed auth cookies flow back to the browser.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: CookieOptions;
          }[]
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: getUser() revalidates the token and refreshes the session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Sessions outside the allowed domains end here - including ones opened
  // before the rule existed - unless the agency invited this person: a
  // client user with a seat and a verified address (lib/auth/login-policy.ts).
  // Only those outside the domains pay the extra read (their own users row,
  // readable under RLS).
  if (user && !isLoginAllowed(user.email) && !isPublicPath(request.nextUrl.pathname)) {
    const { data: profile, error } = await supabase
      .from("users")
      .select("role, client_id")
      .eq("id", user.id)
      .maybeSingle();
    // A failed read is not a verdict: the request goes on and RLS still
    // decides what it can see. Signing a client out over a hiccup is worse.
    if (error || isSessionAllowed(user, profile)) return response;
    await supabase.auth.signOut();
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "?error=domain";
    const redirect = NextResponse.redirect(loginUrl);
    // signOut cleared the auth cookies on `response`; carry that over.
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  return response;
}

export const config = {
  // Run on everything except Next internals, static assets and API routes
  // (API routes carry their own auth — CRON_SECRET / OAuth state).
  // "api/" with the slash: a bare "api" also skipped every client slug that
  // merely starts with it ("/apix"), so those dashboards never had their
  // session refreshed here.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
