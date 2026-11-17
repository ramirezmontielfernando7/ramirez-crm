import { NextResponse, type NextRequest } from "next/server";
import { isCrossSiteWrite } from "@/lib/security/csrf";

/**
 * Auditoría 2026-11 — Freno CSRF de la API (ver `src/lib/security/csrf.ts`).
 * Solo mira cabeceras: no toca la base ni la sesión, y corre antes de la ruta.
 */
export function middleware(req: NextRequest) {
  const blocked = isCrossSiteWrite({
    method: req.method,
    pathname: req.nextUrl.pathname,
    cookie: req.headers.get("cookie"),
    origin: req.headers.get("origin"),
    secFetchSite: req.headers.get("sec-fetch-site"),
    host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
  });
  if (!blocked) return NextResponse.next();
  return NextResponse.json(
    { error: { code: "cross_site_request", message: "Solicitud rechazada: no viene de esta aplicación" } },
    { status: 403 }
  );
}

export const config = {
  matcher: "/api/:path*",
};
