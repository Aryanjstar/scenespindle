import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Values already in the environment win over .env.local, so a test database can be targeted.
const envFile = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
for (const line of envFile.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const i = trimmed.indexOf("=");
  const key = trimmed.slice(0, i).trim();
  if (process.env[key] === undefined) process.env[key] = trimmed.slice(i + 1).trim().replace(/^"(.*)"$/, "$1");
}

const { connectDb, User } = await import("../src/server/db.js");
const { hashPassword } = await import("../src/server/session.js");

const { Session } = await import("../src/server/db.js");
const rotate = process.argv.includes("--rotate");
const email = (process.env.OWNER_EMAIL || "").toLowerCase();
if (!email) throw new Error("OWNER_EMAIL is not set");
await connectDb();
const existing = await User.findOne({ email });
if (existing && !rotate) {
  console.log("owner already exists. Use --rotate to set a new password.");
  process.exit(0);
}
// --password-stdin sets a chosen password (local development); otherwise a random one is made.
const chosen = process.argv.includes("--password-stdin") ? readFileSync(0, "utf8").trim() : "";
if (chosen && chosen.length < 12) throw new Error("A chosen password needs at least 12 characters.");
const password = chosen || `Spindle-${randomBytes(12).toString("base64url")}`;
const db = (process.env.MONGODB_DB || "leela-dev").replaceAll(/[^a-zA-Z0-9_-]/g, "_");
// One file per database, with a timestamp, so an earlier password file is never overwritten.
const file = resolve(`.data/owner-password-${db}-${Date.now()}.txt`);
mkdirSync(".data", { recursive: true });
if (!chosen) writeFileSync(file, `${email}\n${password}\n`, { mode: 0o600, flag: "wx" });
if (existing) {
  await User.updateOne({ _id: existing._id }, { $set: { passwordHash: await hashPassword(password), passwordChangedAt: new Date() } });
  await Session.deleteMany({ userId: existing._id });
  console.log(chosen ? "owner password set." : `owner password rotated. password file: ${file}`);
} else {
  await User.create({
    email,
    name: process.env.OWNER_NAME || "Studio owner",
    passwordHash: await hashPassword(password),
    passwordChangedAt: new Date(),
  });
  console.log(chosen ? "owner created." : `owner created. password file: ${file}`);
}
process.exit(0);
