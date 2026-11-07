import { cookies } from "next/headers";
import { Session } from "../../../../server/db";
import { authed, json } from "../../../../server/guard";
import { hashToken } from "../../../../server/session";

async function currentHash() {
  const token = (await cookies()).get("leela_session")?.value;
  return token ? hashToken(token) : "";
}

/** Your signed-in browsers. */
export async function GET() {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const mine = await currentHash();
  const rows = await Session.find({ userId: auth.user!._id, expiresAt: { $gt: new Date() } }).sort({ lastSeenAt: -1 }).limit(50);
  return json({ items: rows.map((row) => ({ id: String(row._id), lastSeenAt: row.lastSeenAt, userAgent: row.userAgent ?? "", current: row.tokenHash === mine })) });
}

/** Sign out everywhere else. The current browser stays signed in. */
export async function DELETE(request: Request) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const mine = await currentHash();
  const result = await Session.deleteMany({ userId: auth.user!._id, tokenHash: { $ne: mine } });
  return json({ signedOut: result.deletedCount ?? 0 });
}
