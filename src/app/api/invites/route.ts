import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Invite, User } from "../../../server/db";
import { authed, json } from "../../../server/guard";
import { apiError } from "../../../server/http";
import { hashToken } from "../../../server/session";
import { appEnv } from "../../../config/app";
import { sendMail } from "../../../server/mail";

function isOwner(email: string) { return Boolean(appEnv().ownerEmail) && email === appEnv().ownerEmail; }
export async function GET() {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  if (!isOwner(auth.user!.email)) return apiError(403, "FORBIDDEN", "OWNER_ONLY", "Only the studio owner can manage invitations.");
  const invites = await Invite.find({ createdBy: auth.user!._id }).sort({ createdAt: -1 }).limit(100);
  return json({ items: invites.map(invite => ({ id: String(invite._id), email: invite.email, expiresAt: invite.expiresAt, usedAt: invite.usedAt, revokedAt: invite.revokedAt })) });
}
export async function POST(request: Request) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  if (!isOwner(auth.user!.email)) return apiError(403, "FORBIDDEN", "OWNER_ONLY", "Only the studio owner can manage invitations.");
  const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_EMAIL", "Enter a valid email address.");
  if (await User.exists({ email: parsed.data.email })) return apiError(409, "CONFLICT", "ACCOUNT_EXISTS", "That account already exists.");
  const token = randomBytes(32).toString("base64url");
  const invite = await Invite.create({ email: parsed.data.email, tokenHash: hashToken(token), createdBy: auth.user!._id, expiresAt: new Date(Date.now() + 7 * 86400000) });
  const url = `${appEnv().origin}/join#${token}`;
  const delivery = await sendMail(invite.email, "Your SceneSpindle invitation", `You are invited to the SceneSpindle studio. This link works once and expires in seven days:\n\n${url}`);
  // The owner always gets the link too, so a mail failure never strands an invite.
  return json({ id: String(invite._id), email: invite.email, expiresAt: invite.expiresAt, url, delivery: delivery === "sent" ? "email" : delivery === "failed" ? "email_failed" : "copy_link" }, 201);
}
