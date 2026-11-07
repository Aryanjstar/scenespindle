import { NextResponse } from "next/server";
import { connectDb } from "./db";
import { apiError, originOk } from "./http";
import { currentUser } from "./session";

export async function authed(request?: Request) {
  if (request && !originOk(request)) {
    return { error: apiError(403, "FORBIDDEN", "ORIGIN", "This request came from the wrong site.") };
  }
  try {
    await connectDb();
  } catch {
    return { error: apiError(503, "UNAVAILABLE", "DB_DOWN", "The studio database is not reachable.") };
  }
  const user = await currentUser();
  if (!user) return { error: apiError(401, "UNAUTHENTICATED", "NO_SESSION", "Sign in to open the studio.") };
  return { user };
}

export function busy(error: unknown) {
  if (error instanceof Error && error.message === "PROJECT_BUSY") {
    return apiError(409, "CONFLICT", "PROJECT_BUSY", "A job is already running for this project.", {
      activeJobId: (error as Error & { jobId?: string }).jobId,
    });
  }
  return null;
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

/** The studio owner is the configured OWNER_EMAIL account. */
export function isOwner(user: { email?: string } | null | undefined): boolean {
  const owner = (process.env.OWNER_EMAIL || "").toLowerCase();
  return Boolean(owner) && (user?.email ?? "").toLowerCase() === owner;
}
