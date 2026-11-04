import Link from "next/link";

/** A spindle: one reel, four coloured spokes, turning slowly. */
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14.5" fill="#fffdf8" stroke="#1d1a24" strokeWidth="1.8" />
      <g className="spin">
        <circle cx="16" cy="8.6" r="3.3" fill="#ffb020" stroke="#1d1a24" strokeWidth="1.4" />
        <circle cx="23.4" cy="16" r="3.3" fill="#ff4f8b" stroke="#1d1a24" strokeWidth="1.4" />
        <circle cx="16" cy="23.4" r="3.3" fill="#00a99a" stroke="#1d1a24" strokeWidth="1.4" />
        <circle cx="8.6" cy="16" r="3.3" fill="#4b6bfb" stroke="#1d1a24" strokeWidth="1.4" />
      </g>
      <circle cx="16" cy="16" r="2" fill="#1d1a24" />
    </svg>
  );
}

export function Lattu({ className = "" }: { className?: string }) {
  return <Mark className={className} />;
}

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand">
      <Mark className="brand-mark" />
      <span>SceneSpindle</span>
    </Link>
  );
}

export const MODE_LABEL: Record<string, string> = {
  explainer: "Explainer", code_lab: "Code Lab", audio: "Audio", story: "Story", cartoon: "Cartoon", lyrics: "Lyrics", montage: "Montage",
};
