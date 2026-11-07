"use client";

import { useState, type ReactNode } from "react";

export function Button({ pending, children, tone = "solid", size, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { pending?: boolean; tone?: "solid" | "ghost" | "quiet" | "accent" | "danger"; size?: "sm" | "lg" }) {
  const cls = ["btn", tone !== "solid" ? tone : "", size ?? "", rest.className ?? ""].filter(Boolean).join(" ");
  return (
    <button type="button" {...rest} className={cls} disabled={rest.disabled || pending} aria-busy={pending || undefined}>
      {pending ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Notice({ tone = "info", children, onClose }: { tone?: "info" | "warn" | "bad" | "good"; children: ReactNode; onClose?: () => void }) {
  if (!children) return null;
  return (
    <div className={`notice ${tone === "info" ? "" : tone}`} role={tone === "bad" ? "alert" : "status"}>
      <div>{children}</div>
      {onClose ? <button type="button" className="notice-x" aria-label="Dismiss" onClick={onClose}>×</button> : null}
    </div>
  );
}

export function Panel({ kicker, title, actions, children, id, className }: { kicker?: string; title?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string; className?: string }) {
  return (
    <section className={`surface panel ${className ?? ""}`} id={id}>
      {kicker || title || actions ? (
        <div className="panel-head">
          <div>{kicker ? <p className="kicker">{kicker}</p> : null}{title ? <h2>{title}</h2> : null}</div>
          {actions ? <div className="row-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function CopyRow({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-row">
      <input className="field" readOnly value={value} aria-label="Link" onFocus={(e) => e.currentTarget.select()} />
      <Button tone="ghost" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the field is selectable */ } }}>{copied ? "Copied" : label}</Button>
    </div>
  );
}

export function Progress({ stages, labels, state }: { stages: { name: string; state: string; done?: number; total?: number }[]; labels: Record<string, string>; state: string }) {
  return (
    <div className="progress" aria-live="polite">
      <p className="kicker">{state === "waiting_quota" ? "Waiting for allowance" : state}</p>
      {stages.length ? (
        <ol>{stages.map((s) => <li key={s.name} data-state={s.state}>{labels[s.name] ?? s.name}{s.total ? ` (${s.done ?? 0} of ${s.total})` : ""}</li>)}</ol>
      ) : null}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="hand empty-title">{title}</p>
      {children}
    </div>
  );
}

export const MODE_LABEL: Record<string, string> = {
  explainer: "Explainer", code_lab: "Code Lab", audio: "Audio", story: "Story", cartoon: "Cartoon", lyrics: "Lyrics", montage: "Montage", reel: "Caption a reel",
};

export const STAGE_LABEL: Record<string, string> = {
  voice: "Recording narration", timeline: "Timing scenes to the voice", frames: "Drawing frames", mix: "Mixing sound, captions and poster", qa: "Checking the file",
  preview: "Building the preview", beats: "Finding the beats", cuts: "Cutting clips to the beat", plan: "Planning the storyboard", brainstorm: "Thinking of angles",
  revise: "Rewriting", scene_regen: "Rewriting the scene", stills: "Drawing stills", sheet: "Drawing the character sheet", listen: "Listening for word times",
  place: "Finding where captions fit", burn: "Writing captions onto the reel", analyze: "Studying your references", export: "Preparing the file", research: "Researching",
  banner: "Drawing the banner", "profile-copy": "Drafting your copy",
};

export function timeAgo(value?: string | Date | null): string {
  if (!value) return "";
  const s = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(value).toLocaleDateString();
}
