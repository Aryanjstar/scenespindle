import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { appEnv } from "../config/app";

type DbCache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalCache = globalThis as unknown as { __leelaDb?: DbCache };

function cache(): DbCache {
  globalCache.__leelaDb ??= { conn: null, promise: null };
  return globalCache.__leelaDb;
}

export async function connectDb() {
  const env = appEnv();
  if (!env.mongoUri) throw new Error("MONGODB_URI is not set");
  const cached = cache();
  if (cached.conn && mongoose.connection.readyState === 1) return cached.conn;
  if (mongoose.connection.readyState !== 1) {
    cached.conn = null;
  }
  if (!cached.promise) {
    mongoose.set("bufferTimeoutMS", 5_000);
    cached.promise = mongoose.connect(env.mongoUri, {
      dbName: env.mongoDb,
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 5_000,
      socketTimeoutMS: 8_000,
    });
  }
  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (error) {
    cached.promise = null;
    cached.conn = null;
    const message = error instanceof Error ? error.message : "";
    const kind = /whitelist/i.test(message)
      ? "whitelist"
      : /bad auth|authentication failed/i.test(message)
        ? "auth"
        : /ENOTFOUND|getaddrinfo/i.test(message)
          ? "dns"
          : /timed out|server selection/i.test(message)
            ? "timeout"
            : "other";
    console.error("leela-db", kind);
    throw error;
  }
}

const prefs = {
  defaultMode: { type: String, default: "explainer" },
  defaultFormat: { type: String, default: "9x16" },
  defaultTargetMs: { type: Number, default: 45000 },
  defaultLanguage: { type: String, default: "en" },
  defaultVoiceId: { type: String, default: "elevenlabs:alice" },
  defaultStyleId: { type: String, default: "chalk-and-chai@1" },
  timezone: { type: String, default: "Asia/Kolkata" },
  glass: { type: String, default: "tinted" },
  reducedMotion: { type: Boolean, default: false },
  funCopy: { type: Boolean, default: true },
  uiSound: { type: Boolean, default: false },
};

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    name: { type: String, required: true, maxlength: 120 },
    passwordHash: { type: String, required: true },
    passwordChangedAt: { type: Date, required: true },
    prefs: { type: new Schema(prefs, { _id: false }), default: () => ({}) },
    pronunciations: { type: [{ written: String, spoken: String }], default: [] },
  },
  { timestamps: true },
);

const sessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  userAgent: { type: String, maxlength: 200 },
});

const inviteSchema = new Schema({
  email: { type: String, required: true, lowercase: true },
  tokenHash: { type: String, required: true, unique: true },
  createdBy: { type: Schema.Types.ObjectId, required: true },
  expiresAt: { type: Date, required: true },
  usedAt: Date,
  revokedAt: Date,
}, { timestamps: true });

const projectSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    title: { type: String, required: true, maxlength: 120 },
    mode: { type: String, required: true, enum: ["explainer", "code_lab", "story", "audio", "cartoon", "montage", "lyrics"] },
    seriesId: { type: Schema.Types.ObjectId },
    episodeNumber: { type: Number },
    castIds: { type: [Schema.Types.ObjectId], default: [] },
    lyrics: { type: new Schema({ songAssetId: Schema.Types.ObjectId, lrc: { type: String, maxlength: 20000 } }, { _id: false }) },
    format: { type: String, required: true, enum: ["9x16", "16x9", "1x1"] },
    targetMs: { type: Number, required: true },
    language: { type: String, required: true, enum: ["en", "hi", "hinglish"] },
    voiceId: { type: String, required: true },
    styleId: { type: String, required: true },
    keepPrivate: { type: Boolean, required: true, default: false },
    badge: { type: String, required: true, enum: ["draft", "planning", "review", "rendering", "ready", "failed"], default: "draft" },
    storyboardVersion: { type: Number, default: 0 },
    videoVersion: { type: Number, default: 0 },
    currentVideoId: { type: Schema.Types.ObjectId },
    deletedAt: Date,
  },
  { timestamps: true },
);

// Deleted projects are hidden from every find unless a caller opts in with { withDeleted: true }.
projectSchema.index({ seriesId: 1, episodeNumber: 1 }, { unique: true, partialFilterExpression: { seriesId: { $exists: true } } });
projectSchema.pre(/^find/, function (this: mongoose.Query<unknown, unknown>) {
  const options = this.getOptions() as { withDeleted?: boolean };
  if (options.withDeleted) return;
  const filter = this.getFilter();
  if (!("deletedAt" in filter)) this.where({ deletedAt: { $exists: false } });
});

const draftSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true, unique: true },
    revision: { type: Number, required: true, default: 1 },
    idea: {
      topic: { type: String, default: "" },
      audience: String,
      notes: String,
      mustInclude: { type: [String], default: [] },
    },
    plan: { type: Schema.Types.Mixed },
    planHash: { type: String },
    planValid: { type: Boolean, required: true, default: false },
    issues: { type: [Schema.Types.Mixed], default: undefined },
    traceId: { type: Schema.Types.ObjectId },
    messageSeq: { type: Number, required: true, default: 0 },
    approvalFence: { type: String },
  },
  { timestamps: true, minimize: false },
);

const jobSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, required: true, index: true },
    type: { type: String, required: true, enum: ["brainstorm", "plan", "revise", "scene_regen", "render", "image", "cleanup", "publish"] },
    state: { type: String, required: true, enum: ["queued", "running", "waiting_quota", "succeeded", "failed", "cancelled"], default: "queued" },
    activeSlot: { type: Boolean },
    input: { type: Schema.Types.Mixed, required: true },
    stages: { type: [Schema.Types.Mixed], default: [] },
    progress: Number,
    attempts: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true, default: 3 },
    runAfter: { type: Date, required: true },
    leaseToken: String,
    leaseExpiresAt: Date,
    error: { type: Schema.Types.Mixed },
    result: { type: Schema.Types.Mixed },
    finishedAt: Date,
  },
  { timestamps: true, minimize: false },
);

const storyboardSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    version: { type: Number, required: true },
    schemaVersion: { type: Number, required: true },
    plan: { type: Schema.Types.Mixed, required: true },
    planHash: { type: String, required: true },
    storyHash: { type: String, required: true },
    traceId: Schema.Types.ObjectId,
    origin: { type: String, required: true, enum: ["approve", "revision", "restore"] },
    seriesVersion: Number,
    plannerModel: String,
    approvedAt: { type: Date, required: true },
  },
  // Plans contain empty prop objects that must survive storage exactly.
  { timestamps: true, minimize: false },
);

const videoSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    storyboardId: { type: Schema.Types.ObjectId },
    version: { type: Number, required: true },
    format: { type: String, required: true },
    state: { type: String, required: true, enum: ["building", "preview", "ready", "failed"], default: "building" },
    jobId: { type: Schema.Types.ObjectId, required: true },
    durationMs: Number,
    warnings: { type: [String], default: [] },
    previewHtml: String,
    audioPath: String,
    mp4Path: String,
    kind: { type: String, enum: ["preview", "mp4"], default: "preview" },
    voiceId: String,
    timing: { type: String, enum: ["aligned", "estimated"] },
    renderer: String,
    artifacts: {
      type: new Schema({
        mp4: String, thumb: String, sheet: String, srt: String, vtt: String,
        bytes: Number, sha256: String,
      }, { _id: false }),
    },
    qa: { type: Schema.Types.Mixed },
    commercialSafe: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const shareSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    videoId: { type: Schema.Types.ObjectId, required: true },
    token: { type: String, required: true, unique: true },
    allowDownload: { type: Boolean, required: true, default: false },
    revokedAt: Date,
    views: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

const messageSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    seq: { type: Number, required: true },
    role: { type: String, required: true, enum: ["user", "assistant", "note"] },
    text: { type: String, required: true, maxlength: 4000 },
    sceneIds: { type: [String], default: [] },
    jobId: Schema.Types.ObjectId,
    candidate: { type: Schema.Types.Mixed },
  },
  { timestamps: true, minimize: false },
);

const traceSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    language: { type: String, required: true },
    entry: { type: String, required: true },
    input: { type: Schema.Types.Mixed, required: true },
    summary: { type: Schema.Types.Mixed, required: true },
    tracerVersion: { type: String, required: true },
    code: { type: String, maxlength: 8000 },
    returned: { type: Schema.Types.Mixed },
    steps: { type: [Schema.Types.Mixed], required: true },
  },
  { timestamps: true },
);

videoSchema.index({ projectId: 1, version: 1 }, { unique: true });
storyboardSchema.index({ projectId: 1, version: 1 }, { unique: true });
jobSchema.index({ projectId: 1, activeSlot: 1 }, { unique: true, partialFilterExpression: { activeSlot: true } });
jobSchema.index({ type: 1, state: 1, runAfter: 1 });

const usageSchema = new Schema({
  provider: { type: String, required: true },
  period: { type: String, required: true },
  used: { type: Number, required: true, default: 0 },
  reserved: { type: Number, required: true, default: 0 },
}, { timestamps: true });
usageSchema.index({ provider: 1, period: 1 }, { unique: true });

const rateLimitSchema = new Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, required: true, default: 0 },
  expiresAt: { type: Date, required: true },
});
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const resetSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  usedAt: Date,
}, { timestamps: true });

const characterSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, maxlength: 40 },
    description: { type: String, default: "", maxlength: 280 },
    style: { type: String, required: true, enum: ["flat", "cartoon", "storybook", "clay"], default: "cartoon" },
    voiceId: { type: String, default: "" },
    referenceAssetId: { type: Schema.Types.ObjectId },
    rights: { type: String, enum: ["own", "licensed", "original-generated"], default: "own" },
    rightsNote: { type: String, default: "", maxlength: 280 },
    version: { type: Number, default: 0 },
    sheetAssetId: { type: Schema.Types.ObjectId },
    state: { type: String, enum: ["draft", "drawing", "ready", "failed"], default: "draft" },
  },
  { timestamps: true },
);

/** Immutable look of a character at one point in time. Films freeze the version they used. */
const characterVersionSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
  characterId: { type: Schema.Types.ObjectId, required: true },
  version: { type: Number, required: true },
  sheetAssetId: { type: Schema.Types.ObjectId, required: true },
  referenceAssetId: { type: Schema.Types.ObjectId },
  style: { type: String, required: true },
  description: { type: String, default: "" },
  model: { type: String, required: true },
}, { timestamps: true });
characterVersionSchema.index({ characterId: 1, version: 1 }, { unique: true });

const seriesSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
  title: { type: String, required: true, maxlength: 120 },
  logline: { type: String, default: "", maxlength: 400 },
  mode: { type: String, enum: ["story", "cartoon"], default: "story" },
  style: { type: String, enum: ["flat", "cartoon", "storybook", "clay"], default: "storybook" },
  bible: { type: new Schema({ world: { type: String, default: "", maxlength: 2000 }, tone: { type: String, default: "", maxlength: 400 }, rules: { type: [String], default: [] } }, { _id: false }), default: () => ({}) },
  castIds: { type: [Schema.Types.ObjectId], default: [] },
  revision: { type: Number, default: 1 },
  version: { type: Number, default: 0 },
  deletedAt: Date,
}, { timestamps: true, minimize: false });

/** Approved series snapshot: bible and the exact cast versions episodes are made with. */
const seriesVersionSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
  seriesId: { type: Schema.Types.ObjectId, required: true },
  version: { type: Number, required: true },
  snapshot: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true, minimize: false });
seriesVersionSchema.index({ seriesId: 1, version: 1 }, { unique: true });

const apiTokenSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
  name: { type: String, required: true, maxlength: 60 },
  tokenHash: { type: String, required: true, unique: true },
  prefix: { type: String, required: true },
  lastUsedAt: Date,
  expiresAt: { type: Date, required: true },
  revokedAt: Date,
}, { timestamps: true });

const assetSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    kind: { type: String, required: true, enum: ["image", "audio", "video"] },
    name: { type: String, required: true, maxlength: 120 },
    path: { type: String, required: true },
    mime: { type: String, required: true },
    licence: { type: String, required: true },
    source: { type: String, required: true, enum: ["system", "mine", "generated"], default: "mine" },
    provenance: { type: Schema.Types.Mixed },
    projectId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

const connectionSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    provider: { type: String, required: true, enum: ["youtube", "instagram"] },
    label: { type: String, default: "" },
    status: { type: String, required: true, enum: ["pending", "connected"], default: "pending" },
  },
  { timestamps: true },
);

const briefSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, required: true, unique: true },
  revision: { type: Number, required: true, default: 1 },
  version: { type: Number, required: true, default: 0 },
  input: { type: Schema.Types.Mixed, required: true },
  result: { type: Schema.Types.Mixed, required: true },
  state: { type: String, required: true, enum: ['needs_input', 'ready_for_review', 'approved'] },
  approvedAt: Date,
}, { timestamps: true });

const briefVersionSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, required: true, index: true },
  briefId: { type: Schema.Types.ObjectId, required: true },
  version: { type: Number, required: true },
  contentHash: { type: String, required: true },
  snapshot: { type: Schema.Types.Mixed, required: true },
  promptBundle: { type: Schema.Types.Mixed, required: true },
  approvedAt: { type: Date, required: true },
}, { timestamps: true });
briefVersionSchema.index({ briefId: 1, version: 1 }, { unique: true });

export const User = mongoose.models.User || mongoose.model("User", userSchema);
export const Session = mongoose.models.Session || mongoose.model("Session", sessionSchema);
export const Invite = mongoose.models.Invite || mongoose.model("Invite", inviteSchema);
export const Project = mongoose.models.Project || mongoose.model("Project", projectSchema);
export const Draft = mongoose.models.Draft || mongoose.model("Draft", draftSchema);
export const Job = mongoose.models.Job || mongoose.model("Job", jobSchema);
export const Storyboard = mongoose.models.Storyboard || mongoose.model("Storyboard", storyboardSchema);
export const Video = mongoose.models.Video || mongoose.model("Video", videoSchema);
export const ShareLink = mongoose.models.ShareLink || mongoose.model("ShareLink", shareSchema);
export const Message = mongoose.models.Message || mongoose.model("Message", messageSchema);
export const Trace = mongoose.models.Trace || mongoose.model("Trace", traceSchema);
export const Character = mongoose.models.Character || mongoose.model("Character", characterSchema);
export const Asset = mongoose.models.Asset || mongoose.model("Asset", assetSchema);
export const Connection = mongoose.models.Connection || mongoose.model("Connection", connectionSchema);
export const Brief = mongoose.models.Brief || mongoose.model("Brief", briefSchema);
export const BriefVersion = mongoose.models.BriefVersion || mongoose.model("BriefVersion", briefVersionSchema);

export const CharacterVersion = mongoose.models.CharacterVersion || mongoose.model("CharacterVersion", characterVersionSchema, "characterversions");
export const Series = mongoose.models.Series || mongoose.model("Series", seriesSchema, "series");
export const SeriesVersion = mongoose.models.SeriesVersion || mongoose.model("SeriesVersion", seriesVersionSchema, "seriesversions");
export const ApiToken = mongoose.models.ApiToken || mongoose.model("ApiToken", apiTokenSchema, "apitokens");
export const Usage = mongoose.models.Usage || mongoose.model("Usage", usageSchema);
export const RateLimit = mongoose.models.RateLimit || mongoose.model("RateLimit", rateLimitSchema, "ratelimits");
export const Reset = mongoose.models.Reset || mongoose.model("Reset", resetSchema, "resets");

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };
