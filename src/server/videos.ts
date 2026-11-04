import mongoose from "mongoose";
import { Project, ShareLink, Video } from "./db";

export const FILE_KINDS = ["mp4", "thumb", "sheet", "srt", "vtt"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const PUBLIC_KINDS: FileKind[] = ["mp4", "thumb", "vtt"];

export function artifactKey(video: { artifacts?: Partial<Record<FileKind, string>> | null }, kind: FileKind): string | null {
  return video.artifacts?.[kind] ?? null;
}

export function downloadName(title: string, kind: FileKind, version: number): string {
  const base = title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "").slice(0, 60) || "film";
  const ext = { mp4: "mp4", thumb: "jpg", sheet: "jpg", srt: "srt", vtt: "vtt" }[kind];
  return `${base}-v${version}${kind === "sheet" ? "-frames" : ""}.${ext}`;
}

export function videoJson(video: {
  _id: unknown; version: number; state: string; kind?: string | null; durationMs?: number | null; warnings?: string[];
  createdAt?: Date; timing?: string | null; voiceId?: string | null; qa?: unknown; artifacts?: unknown; mp4Path?: string | null; commercialSafe?: boolean | null;
}, currentId?: unknown) {
  const id = String(video._id);
  const isMp4 = video.kind === "mp4" && Boolean(video.artifacts);
  // Legacy HTML-only "ready" records are previews.
  const state = video.state === "ready" && !isMp4 ? "preview" : video.state;
  return {
    id,
    version: video.version,
    kind: isMp4 ? "mp4" : "preview",
    state,
    current: currentId != null && String(currentId) === id,
    durationMs: video.durationMs ?? 0,
    warnings: video.warnings ?? [],
    timing: video.timing ?? undefined,
    voiceId: video.voiceId ?? undefined,
    commercialSafe: video.commercialSafe ?? false,
    qa: isMp4 ? video.qa : undefined,
    createdAt: video.createdAt,
    files: isMp4
      ? Object.fromEntries(["mp4", "thumb", "sheet", "srt", "vtt"].filter((kind) => (video.artifacts as Record<string, unknown> | undefined)?.[kind]).map((kind) => [kind, `/api/videos/${id}/file/${kind}`]))
      : undefined,
    previewUrl: isMp4 ? undefined : `/api/videos/${id}/preview`,
  };
}

/** A share token resolves only to a ready MP4 of a live project, and only while not revoked. */
export async function sharedVideo(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const link = await ShareLink.findOne({ token, revokedAt: { $exists: false } });
  if (!link) return null;
  const video = await Video.findOne({ _id: link.videoId, ownerId: link.ownerId, state: "ready", kind: "mp4" });
  if (!video) return null;
  const project = await Project.findOne({ _id: link.projectId, ownerId: link.ownerId, deletedAt: { $exists: false } }).select("title");
  if (!project) return null;
  return { link, video, title: project.title as string };
}

export function isId(id: string) {
  return mongoose.isValidObjectId(id);
}
