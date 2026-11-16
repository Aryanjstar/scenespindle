import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const display = localFont({ src: "../../node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2", variable: "--font-display", weight: "700", display: "swap" });
const body = localFont({ src: [
  { path: "../../node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-400-normal.woff2", weight: "400" },
  { path: "../../node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2", weight: "700" },
], variable: "--font-body", display: "swap" });
const hindi = localFont({ src: "../../node_modules/@fontsource/kalam/files/kalam-devanagari-700-normal.woff2", variable: "--font-hindi", weight: "700", display: "swap" });

export const metadata: Metadata = {
  title: "SceneSpindle",
  description: "Any idea, at play. A studio that turns a topic, notes, or code into a short narrated film.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} ${hindi.variable}`}>
        <div className="aurora" aria-hidden="true">
          <svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
            <g fill="none" stroke="#f3f3f3" strokeWidth="1" opacity="0.18">
              <path d="M-20 120 L180 40 L420 160 L240 280 Z" />
              <path d="M180 40 L420 160 L560 60 L360 -20 Z" />
              <path d="M860 640 L1040 520 L1180 700 L980 820 Z" />
              <path d="M1040 520 L1180 700 L1320 560 L1160 420 Z" />
              <path d="M80 620 L220 540 L300 680 L140 760 Z" />
            </g>
            <path d="M980 90c40 0 70 28 70 64s-30 64-70 64c-28 0-52-14-64-36 12 22 36 36 64 36 40 0 70-28 70-64s-30-64-70-64c-28 0-52 14-64 36 12-22 36-36 64-36z" fill="none" stroke="#f3f3f3" strokeWidth="1.2" opacity="0.28" transform="translate(-40 20) scale(1.15)" />
          </svg>
        </div>
        {children}
      </body>
    </html>
  );
}
