import Link from "next/link";

export function Lattu({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 6 L50 40 H14 Z" fill="#f3f3f3" />
      <path d="M32 6 L50 40 H32 Z" fill="#c8c8c8" />
      <ellipse cx="32" cy="40" rx="18" ry="6" fill="#8e8e8e" />
      <ellipse cx="32" cy="39" rx="10" ry="3" fill="#f7f7f7" />
      <circle cx="26" cy="26" r="1.7" fill="#111" />
      <circle cx="36" cy="26" r="1.7" fill="#111" />
      <path d="M34 42 C40 50 28 56 24 60" fill="none" stroke="#f3f3f3" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand">
      <Lattu className="brand-mark" />
      <span>SceneSpindle</span>
    </Link>
  );
}
