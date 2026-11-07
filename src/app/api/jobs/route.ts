import { Job, Project, Series, Style } from "../../../server/db";
import { authed, json } from "../../../server/guard";

/** Your recent and active jobs across projects: the render queue. */
export async function GET(request: Request) {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const activeOnly = new URL(request.url).searchParams.get("active") === "1";
  const jobs = await Job.find({ ownerId: auth.user!._id, ...(activeOnly ? { state: { $in: ["queued", "running", "waiting_quota"] } } : {}) })
    .sort({ createdAt: -1 }).limit(60).select("type state stages progress error projectId target input.output input.kind input.tool createdAt finishedAt");
  const ids = [...new Set(jobs.map((job) => String(job.projectId)))];
  const [projects, series, styles] = await Promise.all([
    Project.find({ _id: { $in: ids }, ownerId: auth.user!._id }, null, { withDeleted: true }).select("title mode"),
    Series.find({ _id: { $in: ids }, ownerId: auth.user!._id }).select("title"),
    Style.find({ _id: { $in: ids }, ownerId: auth.user!._id }).select("name"),
  ]);
  const names = new Map<string, { title: string; href: string | null; mode?: string }>();
  for (const p of projects) names.set(String(p._id), { title: p.title, href: `/studio/p/${String(p._id)}`, mode: p.mode });
  for (const s of series) names.set(String(s._id), { title: s.title, href: `/studio/series/${String(s._id)}` });
  for (const s of styles) names.set(String(s._id), { title: `Style: ${s.name}`, href: "/studio/library?tab=styles" });
  return json({
    items: jobs.map((job) => {
      const scope = names.get(String(job.projectId));
      const what = job.type === "render" ? (job.input?.output === "mp4" ? "Film render" : job.input?.output === "montage" ? "Montage render" : "Preview") : job.type === "image" ? (job.input?.kind === "character" ? "Character sheet" : "Story stills") : job.type === "tool" ? (job.input?.tool === "banner" ? "Banner" : "Profile copy") : job.type === "caption" ? "Reel captions" : job.type === "analysis" ? "Learning a style" : job.type === "export" ? "Export" : job.type === "brief_refine" ? "Brief research" : job.type[0].toUpperCase() + job.type.slice(1).replace("_", " ");
      return { id: String(job._id), type: job.type, what, state: job.state, progress: job.progress ?? null, stages: job.stages, error: job.error?.message ?? null, target: job.target ?? "hosted", title: scope?.title ?? "Your account", href: scope?.href ?? null, mode: scope?.mode ?? null, createdAt: job.createdAt, finishedAt: job.finishedAt ?? null };
    }),
  });
}
