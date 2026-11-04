"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Brand } from "../brand";

const LINKS = [
  { href: "/studio", label: "Projects" },
  { href: "/studio/library", label: "Library" },
  { href: "/studio/settings", label: "Settings" },
];

export function StudioBar({ name, status }: { name?: string; status?: string }) {
  const path = usePathname();
  const router = useRouter();
  return (
    <header className="site-bar">
      <Brand href="/studio" />
      <nav className="site-nav" aria-label="Studio">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} aria-current={path === link.href ? "page" : undefined}>{link.label}</Link>
        ))}
      </nav>
      <div className="site-bar-end">
        {status ? <span className="status-line" role="status">{status}</span> : null}
        {name ? <span className="muted">{name}</span> : null}
        <button
          className="btn quiet sm"
          type="button"
          onClick={async () => {
            await fetch("/api/auth/sign-out", { method: "POST" });
            router.push("/");
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
