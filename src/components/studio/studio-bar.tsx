"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "../brand";
import { api } from "../ui/client";
import { MODE_LABEL } from "../ui/kit";

const LINKS = [
  { href: "/studio", label: "Projects" },
  { href: "/studio/library", label: "Library" },
  { href: "/studio/series", label: "Series" },
  { href: "/studio/tools", label: "Tools" },
  { href: "/studio/queue", label: "Queue" },
  { href: "/studio/settings", label: "Settings" },
];

type Command = { id: string; label: string; hint: string; run: () => void | Promise<void> };

/** Studio navigation with a command palette (Ctrl or Cmd + K). */
export function StudioBar({ status }: { name?: string; status?: string }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<{ id: string; title: string; mode: string }[]>([]);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPalette((v) => !v); }
      if (event.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!palette) return;
    const t = setTimeout(() => input.current?.focus(), 0);
    void api<{ items: { id: string; title: string; mode: string }[] }>("/api/projects").then((res) => { if (res.ok) setProjects(res.data.items); });
    return () => clearTimeout(t);
  }, [palette]);

  const commands = useMemo<Command[]>(() => {
    const create = (mode: string) => async () => {
      const res = await api<{ project: { id: string } }>("/api/projects", { body: { mode, title: `New ${MODE_LABEL[mode] ?? "film"}` } });
      if (res.ok) router.push(`/studio/p/${res.data.project.id}`);
    };
    return [
      ...LINKS.map((link) => ({ id: link.href, label: `Go to ${link.label}`, hint: "Page", run: () => router.push(link.href) })),
      ...Object.keys(MODE_LABEL).map((mode) => ({ id: `new-${mode}`, label: `New ${MODE_LABEL[mode]}`, hint: "Create", run: create(mode) })),
      ...projects.map((project) => ({ id: project.id, label: project.title, hint: MODE_LABEL[project.mode] ?? project.mode, run: () => router.push(`/studio/p/${project.id}`) })),
    ];
  }, [projects, router]);

  const shown = commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase().trim())).slice(0, 12);
  const openPalette = () => { setQuery(""); setIndex(0); setPalette(true); };

  return (
    <>
      <header className={`site-bar studio-bar ${open ? "is-open" : ""}`}>
        <Brand href="/studio" />
        <nav className="site-nav" aria-label="Studio">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)} aria-current={(link.href === "/studio" ? path === "/studio" || path.startsWith("/studio/p/") : path.startsWith(link.href)) ? "page" : undefined}>{link.label}</Link>
          ))}
        </nav>
        <div className="site-bar-end">
          {status ? <span className="status-line" role="status">{status}</span> : null}
          <button className="btn quiet sm kbd-btn" type="button" onClick={openPalette} aria-label="Open command palette"><span className="kbd">⌘K</span></button>
          <button
            className="btn quiet sm"
            type="button"
            onClick={async () => {
              await api("/api/auth/sign-out", { body: {} });
              router.push("/");
            }}
          >
            Sign out
          </button>
          <button className="menu" type="button" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}><span /><span /></button>
        </div>
      </header>
      {palette ? (
        <div className="palette-backdrop" role="presentation" onClick={() => setPalette(false)}>
          <div className="palette surface" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
            <input
              ref={input}
              className="field"
              placeholder="Jump to a project, page, or make something new"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(shown.length - 1, i + 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
                if (e.key === "Enter" && shown[index]) { e.preventDefault(); setPalette(false); void shown[index].run(); }
              }}
              aria-label="Search commands"
            />
            <ul className="palette-list" role="listbox" aria-label="Commands">
              {shown.map((command, i) => (
                <li key={command.id} role="option" aria-selected={i === index}>
                  <button type="button" className={i === index ? "is-on" : ""} onMouseEnter={() => setIndex(i)} onClick={() => { setPalette(false); void command.run(); }}>
                    <span>{command.label}</span><small>{command.hint}</small>
                  </button>
                </li>
              ))}
              {!shown.length ? <li className="fine" style={{ padding: 12 }}>Nothing matches.</li> : null}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
