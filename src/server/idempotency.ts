import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { Idempotency } from "./db";
import { apiError } from "./http";

/**
 * Idempotency-Key support for create and enqueue routes. The same key with the same body returns
 * the first response; the same key with a different body is a conflict. Keys are per creator and
 * operation and expire after 24 hours.
 */
export async function idempotent(request: Request, ownerId: unknown, operation: string, bodyText: string, handler: () => Promise<Response>): Promise<Response> {
  const key = request.headers.get("idempotency-key");
  if (!key) return handler();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) return apiError(400, "VALIDATION", "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 8 to 100 letters, digits, - or _.");
  const scoped = createHash("sha256").update(`${String(ownerId)}|${operation}|${key}`).digest("hex");
  const requestHash = createHash("sha256").update(bodyText).digest("hex");
  const prior = await Idempotency.findOne({ key: scoped });
  if (prior) {
    if (prior.requestHash !== requestHash) return apiError(409, "CONFLICT", "IDEMPOTENCY_MISMATCH", "This Idempotency-Key was used with a different request.");
    return NextResponse.json(prior.body, { status: prior.status, headers: { "idempotent-replay": "true" } });
  }
  const response = await handler();
  if (response.status < 500) {
    const body = await response.clone().json().catch(() => null);
    await Idempotency.create({ key: scoped, requestHash, status: response.status, body, expiresAt: new Date(Date.now() + 24 * 3600_000) }).catch(() => {});
  }
  return response;
}
