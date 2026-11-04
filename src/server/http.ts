import { NextResponse } from "next/server";

export function apiError(
  status: number,
  code: string,
  reason: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return NextResponse.json(
    { error: { code, reason, message, fields: {}, requestId: `req_${crypto.randomUUID().slice(0, 8)}`, details } },
    { status },
  );
}

export function originOk(request: Request): boolean {
  // Token-authenticated API clients are not exposed to cross-site request forgery:
  // browsers cannot attach this header cross-origin, and such requests never use cookies.
  if (/^Bearer\s+ss_/.test(request.headers.get("authorization") ?? "")) return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const expected = process.env.APP_ORIGIN || "http://localhost:3000";
  // The configured origin is authoritative. Forwarded host headers are client-controlled
  // unless a trusted proxy has explicitly sanitized them.
  return origin === expected;
}
