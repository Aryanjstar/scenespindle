import { createHmac } from "node:crypto";

/**
 * Minimal Azure Blob Storage client over REST with Shared Key auth and service SAS.
 * No SDK: four operations are all the studio needs. Works against Azure and Azurite.
 */
export type BlobConfig = { account: string; key: string; container: string; endpoint: string };

const VERSION = "2021-08-06";

export function blobConfig(): BlobConfig | null {
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  const key = process.env.AZURE_STORAGE_KEY;
  const container = process.env.AZURE_STORAGE_CONTAINER;
  if (!account || !key || !container) return null;
  const endpoint = (process.env.AZURE_STORAGE_ENDPOINT || `https://${account}.blob.core.windows.net`).replace(/\/$/, "");
  return { account, key, container, endpoint };
}

function encodePath(name: string): string {
  return name.split("/").map(encodeURIComponent).join("/");
}

function blobUrl(cfg: BlobConfig, name: string): URL {
  return new URL(`${cfg.endpoint}/${cfg.container}/${encodePath(name)}`);
}

function sign(cfg: BlobConfig, text: string): string {
  return createHmac("sha256", Buffer.from(cfg.key, "base64")).update(text, "utf8").digest("base64");
}

/** Shared Key authorization header for one request. */
function authorize(cfg: BlobConfig, method: string, url: URL, headers: Record<string, string>): Record<string, string> {
  const all: Record<string, string> = { "x-ms-date": new Date().toUTCString(), "x-ms-version": VERSION, ...headers };
  const xms = Object.keys(all).filter((name) => name.startsWith("x-ms-")).sort().map((name) => `${name}:${all[name]}\n`).join("");
  const query = [...url.searchParams.keys()].map((name) => name.toLowerCase()).sort()
    .map((name) => `\n${name}:${url.searchParams.getAll(name).sort().join(",")}`).join("");
  const length = all["content-length"] && all["content-length"] !== "0" ? all["content-length"] : "";
  const toSign = [method, "", "", length, "", all["content-type"] ?? "", "", "", "", "", "", all["range"] ?? ""].join("\n")
    + `\n${xms}/${cfg.account}${url.pathname}${query}`;
  return { ...all, authorization: `SharedKey ${cfg.account}:${sign(cfg, toSign)}` };
}

async function call(cfg: BlobConfig, method: string, url: URL, headers: Record<string, string> = {}, body?: Buffer): Promise<Response> {
  const response = await fetch(url, { method, headers: authorize(cfg, method, url, headers), body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(120_000) });
  return response;
}

export async function ensureContainer(cfg: BlobConfig): Promise<void> {
  const url = new URL(`${cfg.endpoint}/${cfg.container}?restype=container`);
  const response = await call(cfg, "PUT", url, { "content-length": "0" });
  if (!response.ok && response.status !== 409) throw new Error(`Blob container check failed (${response.status})`);
}

export async function putBlob(cfg: BlobConfig, name: string, data: Buffer, contentType: string): Promise<void> {
  const response = await call(cfg, "PUT", blobUrl(cfg, name), {
    "content-length": String(data.length),
    "content-type": contentType,
    "x-ms-blob-type": "BlockBlob",
  }, data);
  if (!response.ok) throw new Error(`Blob upload failed (${response.status})`);
}

export async function getBlobText(cfg: BlobConfig, name: string): Promise<string | null> {
  const response = await call(cfg, "GET", blobUrl(cfg, name));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Blob read failed (${response.status})`);
  return response.text();
}

export async function getBlobBuffer(cfg: BlobConfig, name: string): Promise<Buffer | null> {
  const response = await call(cfg, "GET", blobUrl(cfg, name));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Blob read failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

export async function blobExists(cfg: BlobConfig, name: string): Promise<boolean> {
  const response = await call(cfg, "HEAD", blobUrl(cfg, name));
  return response.ok;
}

export async function deletePrefix(cfg: BlobConfig, prefix: string): Promise<number> {
  const url = new URL(`${cfg.endpoint}/${cfg.container}`);
  url.searchParams.set("restype", "container");
  url.searchParams.set("comp", "list");
  url.searchParams.set("prefix", prefix.endsWith("/") ? prefix : `${prefix}/`);
  const response = await call(cfg, "GET", url);
  if (!response.ok) throw new Error(`Blob list failed (${response.status})`);
  const xml = await response.text();
  const names = [...xml.matchAll(/<Name>([^<]+)<\/Name>/g)].map((match) => match[1].replaceAll("&amp;", "&"));
  for (const name of names) {
    const deleted = await call(cfg, "DELETE", blobUrl(cfg, name));
    if (!deleted.ok && deleted.status !== 404) throw new Error(`Blob delete failed (${deleted.status})`);
  }
  return names.length;
}

/** Read-only service SAS for one blob, valid for a few minutes. */
export function signedBlobUrl(cfg: BlobConfig, name: string, opts: { minutes?: number; download?: string; contentType?: string } = {}): string {
  const start = new Date(Date.now() - 2 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const expiry = new Date(Date.now() + (opts.minutes ?? 10) * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const rscd = opts.download ? `attachment; filename="${opts.download}"` : "";
  const rsct = opts.contentType ?? "";
  const resource = `/blob/${cfg.account}/${cfg.container}/${name}`;
  const toSign = ["r", start, expiry, resource, "", "", "", VERSION, "b", "", "", "", rscd, "", "", rsct].join("\n");
  const url = blobUrl(cfg, name);
  url.searchParams.set("sv", VERSION);
  url.searchParams.set("st", start);
  url.searchParams.set("se", expiry);
  url.searchParams.set("sr", "b");
  url.searchParams.set("sp", "r");
  if (rscd) url.searchParams.set("rscd", rscd);
  if (rsct) url.searchParams.set("rsct", rsct);
  url.searchParams.set("sig", sign(cfg, toSign));
  return url.toString();
}
