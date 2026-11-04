import { NextResponse } from "next/server";
import { connectDb } from "../../../server/db";

export async function GET() {
  let db: "up" | "down" = "down";
  let reason = "";
  try {
    await connectDb();
    db = "up";
  } catch (error) {
    db = "down";
    const message = error instanceof Error ? error.message : "";
    reason = /whitelist/i.test(message)
      ? "whitelist"
      : /bad auth|authentication failed/i.test(message)
        ? "auth"
        : /ENOTFOUND|getaddrinfo/i.test(message)
          ? "dns"
          : /timed out|server selection/i.test(message)
            ? "timeout"
            : "other";
  }
  return NextResponse.json({ ok: true, db, ...(reason ? { reason } : {}), version: process.env.APP_VERSION || "0.2.0" });
}
