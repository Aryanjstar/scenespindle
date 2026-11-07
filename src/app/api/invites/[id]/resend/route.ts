import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { Invite } from "../../../../../server/db";
import { authed, isOwner, json } from "../../../../../server/guard";
import { apiError } from "../../../../../server/http";
import { hashToken } from "../../../../../server/session";
import { appEnv } from "../../../../../config/app";
import { sendMail } from "../../../../../server/mail";

/** Issue a fresh link for an unused invitation. The old link stops working. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  if (!isOwner(auth.user)) return apiError(403, "FORBIDDEN", "OWNER_ONLY", "Only the studio owner can manage invitations.");
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That invitation is not here.");
  const token = randomBytes(32).toString("base64url");
  const invite = await Invite.findOneAndUpdate(
    { _id: id, createdBy: auth.user!._id, usedAt: { $exists: false }, revokedAt: { $exists: false } },
    { $set: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 7 * 86400000) } },
    { new: true },
  );
  if (!invite) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That invitation is not here, or it was already used.");
  const url = `${appEnv().origin}/join#${token}`;
  const delivery = await sendMail(invite.email, "Your SceneSpindle invitation", `You are invited to the SceneSpindle studio. This link works once and expires in seven days:\n\n${url}`);
  return json({ id: String(invite._id), email: invite.email, expiresAt: invite.expiresAt, url, delivery: delivery === "sent" ? "email" : delivery === "failed" ? "email_failed" : "copy_link" });
}
