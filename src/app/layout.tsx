import type { Metadata, Viewport } from "next";
import "@fontsource/bricolage-grotesque/latin-600.css";
import "@fontsource/bricolage-grotesque/latin-700.css";
import "@fontsource/bricolage-grotesque/latin-800.css";
import "@fontsource/inter/latin.css";
import "@fontsource/caveat/latin-600.css";
import "@fontsource/caveat/latin-700.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/anek-devanagari/devanagari-700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "SceneSpindle",
  description: "A studio that spins a topic, a script, a song, your photos or a piece of code into a narrated, captioned short film.",
};

export const viewport: Viewport = { themeColor: "#fff6e8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
