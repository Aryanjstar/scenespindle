"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string; reason?: string; details?: Record<string, unknown> };

/**
 * The one way screens call the studio API. Never throws: network failures, HTML error pages and
 * 5xx answers all come back as { ok: false, error } with a sentence a person can act on.
 */
export async function api<T = Record<string, unknown>>(path: string, opts: { method?: string; body?: unknown; form?: FormData; raw?: BodyInit; idempotencyKey?: string; signal?: AbortSignal } = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.raw !== undefined) { body = opts.raw; headers["content-type"] = "application/octet-stream"; }
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers["content-type"] = "application/json"; }
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, signal: opts.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { ok: false, status: 0, error: "Stopped." };
    return { ok: false, status: 0, error: "The studio could not be reached. Check your connection and try again." };
  }
  if (response.status === 204) return { ok: true, status: 204, data: {} as T };
  const text = await response.text().catch(() => "");
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : {}; } catch { json = null; }
  if (response.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/")) {
    window.location.assign(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
  }
  if (!response.ok || json === null) {
    const err = (json as { error?: { message?: string; reason?: string; details?: Record<string, unknown> } } | null)?.error;
    const fallback = response.status >= 500 || json === null ? "Something went wrong on our side. Try again in a moment." : "That did not work.";
    return { ok: false, status: response.status, error: err?.message ?? fallback, reason: err?.reason, details: err?.details };
  }
  return { ok: true, status: response.status, data: json as T };
}

export function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type JobView = { id: string; type: string; state: string; stages: { name: string; state: string; done?: number; total?: number }[]; progress?: number; error?: { message?: string; retryable?: boolean }; result?: Record<string, unknown> };
export const ACTIVE = ["queued", "running", "waiting_quota"];

/**
 * Follows one job until it finishes, then calls onDone. Polling stops when the screen unmounts or
 * a new job is followed. Shows real job state only: no invented progress.
 */
export function useJob(onDone?: (job: JobView) => void | Promise<void>) {
  const [job, setJob] = useState<JobView | null>(null);
  const token = useRef(0);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => () => { token.current += 1; }, []);
  const follow = useCallback(async (id: string) => {
    const mine = ++token.current;
    for (let attempt = 0; attempt < 3600 && token.current === mine; attempt++) {
      const res = await api<JobView>(`/api/jobs/${id}`);
      if (token.current !== mine) return;
      if (!res.ok) {
        if (res.status === 404) { setJob(null); return; }
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      setJob(res.data);
      if (!ACTIVE.includes(res.data.state)) { await done.current?.(res.data); return; }
      await new Promise((r) => setTimeout(r, attempt < 15 ? 800 : 1600));
    }
  }, []);
  const stop = useCallback(() => { token.current += 1; }, []);
  const clear = useCallback(() => { token.current += 1; setJob(null); }, []);
  return { job, follow, stop, clear, active: Boolean(job && ACTIVE.includes(job.state)) };
}

/** Wait for a job to finish without rendering it (for quick jobs like brainstorm). */
export async function waitForJob(id: string, onUpdate?: (job: JobView) => void): Promise<JobView | null> {
  for (let attempt = 0; attempt < 900; attempt++) {
    const res = await api<JobView>(`/api/jobs/${id}`);
    if (res.ok) {
      onUpdate?.(res.data);
      if (!ACTIVE.includes(res.data.state)) return res.data;
    } else if (res.status === 404) return null;
    await new Promise((r) => setTimeout(r, attempt < 15 ? 700 : 1500));
  }
  return null;
}

/** Per-action pending flags, so one slow button never freezes the others. */
export function usePending() {
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const inFlight = useRef(new Set<string>());
  const run = useCallback(async <T,>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
    // A second click while the first is still running is ignored (no double submits).
    if (inFlight.current.has(name)) return undefined;
    inFlight.current.add(name);
    setPending((p) => ({ ...p, [name]: true }));
    try { return await fn(); } finally {
      inFlight.current.delete(name);
      setPending((p) => ({ ...p, [name]: false }));
    }
  }, []);
  return { pending, run, busy: (name: string) => Boolean(pending[name]) };
}

/** Upload a file: small files in one request, large ones in resumable 8 MB parts. */
export async function uploadFile(file: File, opts: { rights?: "own" | "licensed" | "unknown"; kind?: "auto" | "mask"; onProgress?: (fraction: number) => void } = {}): Promise<ApiResult<{ asset: { id: string; name: string; kind: string } }>> {
  if (file.size <= 20 * 1024 * 1024) {
    const form = new FormData();
    form.set("file", file);
    form.set("rights", opts.rights ?? "own");
    if (opts.kind === "mask") form.set("kind", "mask");
    opts.onProgress?.(0.5);
    const res = await api<{ asset: { id: string; name: string; kind: string } }>("/api/library/assets", { form });
    opts.onProgress?.(1);
    return res;
  }
  const start = await api<{ id: string; partBytes: number; parts: number }>("/api/uploads", { body: { name: file.name.slice(0, 120), size: file.size, rights: opts.rights ?? "own", kind: opts.kind ?? "auto" } });
  if (!start.ok) return start;
  const { id, partBytes, parts } = start.data;
  for (let part = 0; part < parts; part++) {
    const chunk = file.slice(part * partBytes, Math.min(file.size, (part + 1) * partBytes));
    let res: ApiResult<unknown> = { ok: false, status: 0, error: "" };
    for (let attempt = 0; attempt < 3 && !res.ok; attempt++) res = await api(`/api/uploads/${id}?part=${part}`, { method: "PUT", raw: chunk });
    if (!res.ok) return res as ApiResult<never>;
    opts.onProgress?.((part + 1) / parts);
  }
  return api<{ asset: { id: string; name: string; kind: string } }>(`/api/uploads/${id}/complete`, { body: {} });
}
