import mongoose from "mongoose";
import { z } from "zod";
import { NextResponse } from "next/server";
import { connectDb, Draft, Project } from "../../../server/db";
import { apiError, originOk } from "../../../server/http";
import { currentUser } from "../../../server/session";

const MODES = new Set(["explainer", "code_lab", "story", "audio", "cartoon", "montage", "lyrics"]);
const OPEN = new Set(["explainer", "code_lab", "audio", "montage", "story", "cartoon", "lyrics"]);

export async function GET(request: Request) {
  try {
    await connectDb();
  } catch {
    return apiError(503, "UNAVAILABLE", "DB_DOWN", "The studio database is not reachable.");
  }
  const user = await currentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "NO_SESSION", "Sign in to open the studio.");
  try {
    const deleted = new URL(request.url).searchParams.get("deleted") === "1";
    const items = deleted
      ? await Project.find({ ownerId: user._id, deletedAt: { $gt: new Date(Date.now() - 7 * 86_400_000) } }, null, { withDeleted: true }).sort({ deletedAt: -1 }).limit(50).lean()
      : await Project.find({ ownerId: user._id }).sort({ updatedAt: -1, _id: -1 }).limit(50).maxTimeMS(8_000).lean();
    return NextResponse.json({
      items: items.map((project) => ({
        id: String(project._id),
        title: project.title,
        mode: project.mode,
        format: project.format,
        targetMs: project.targetMs,
        badge: project.badge,
        updatedAt: project.updatedAt,
        deletedAt: project.deletedAt,
        poster: project.currentVideoId ? `/api/videos/${String(project.currentVideoId)}/file/thumb` : undefined,
      })),
    });
  } catch {
    return apiError(503, "UNAVAILABLE", "DB_DOWN", "The studio database is not reachable.");
  }
}

export async function POST(request: Request) {
  if (!originOk(request)) return apiError(403, "FORBIDDEN", "ORIGIN", "This request came from the wrong site.");
  try {
    await connectDb();
  } catch {
    return apiError(503, "UNAVAILABLE", "DB_DOWN", "The studio database is not reachable.");
  }
  const user = await currentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "NO_SESSION", "Sign in to open the studio.");
  const parsed = z.object({
    mode: z.string().optional(),
    title: z.string().max(120).optional(),
    topic: z.string().max(2000).optional(),
  }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_PROJECT", "Check the project fields.");
  const body = parsed.data;
  const mode = body.mode || user.prefs?.defaultMode || "explainer";
  if (!MODES.has(mode)) return apiError(400, "VALIDATION", "UNKNOWN_FIELD", "That mode is not known.");
  if (!OPEN.has(mode)) return apiError(422, "VALIDATION", "MODE_UNAVAILABLE", "That mode is not open yet.");
  const title = (body.title || body.topic || "Untitled").slice(0, 120);
  return mongoose.connection.transaction(async session => {
    const [project] = await Project.create([{
      ownerId: user._id,
      title,
      mode,
      format: user.prefs?.defaultFormat || "9x16",
      targetMs: user.prefs?.defaultTargetMs || 45000,
      language: user.prefs?.defaultLanguage || "en",
      voiceId: user.prefs?.defaultVoiceId || "elevenlabs:alice",
      styleId: user.prefs?.defaultStyleId || "chalk-and-chai@1",
      keepPrivate: false,
      badge: "draft",
    }], { session });
    const [draft] = await Draft.create([{
      ownerId: user._id,
      projectId: project._id,
      idea: { topic: (body.topic || "").slice(0, 2000), mustInclude: [] },
    }], { session });
    return NextResponse.json({ project: { id: String(project._id), title }, draft: { id: String(draft._id) } }, { status: 201 });
  });
}
