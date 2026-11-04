import { NextResponse } from "next/server";
import { connectDb, User } from "../../../../server/db";
import { apiError, originOk } from "../../../../server/http";
import { checkPassword, openSession } from "../../../../server/session";
import { limit } from "../../../../server/rate-limit";

// A real cost-12 hash, so unknown emails take as long as wrong passwords.
const DUMMY = "$2b$12$CwTycUXWue0Thq9StjUM0uJ8.dFHaNm8iHOKmY9rWfEfwQnGx7wNO";

export async function POST(request: Request) {
  if (!originOk(request)) return apiError(403, "FORBIDDEN", "ORIGIN", "This request came from the wrong site.");
  const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  if (!email || !password) return apiError(400, "VALIDATION", "UNKNOWN_FIELD", "Email and password are required.");
  try {
    await connectDb();
    if (!(await limit(request, "sign-in", 10, 15 * 60_000, email))) {
      return apiError(429, "RATE_LIMITED", "RATE_LIMITED", "Too many sign-in attempts. Try again in 15 minutes.");
    }
    const user = await User.findOne({ email }).maxTimeMS(8_000);
    const ok = await checkPassword(password, user?.passwordHash || DUMMY).catch(() => false);
    if (!user || !ok) {
      return apiError(401, "UNAUTHENTICATED", "INVALID_CREDENTIALS", "That email or password is not right.");
    }
    await openSession(user._id, request.headers.get("user-agent"));
    return NextResponse.json({
      user: { id: String(user._id), email: user.email, name: user.name, isOwner: user.email === (process.env.OWNER_EMAIL || "").toLowerCase() },
    });
  } catch {
    return apiError(503, "UNAVAILABLE", "DB_DOWN", "The studio database is not reachable.");
  }
}
