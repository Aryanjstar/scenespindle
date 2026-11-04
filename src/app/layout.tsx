import type { Metadata, Viewport } from "next";
import { Anek_Devanagari, Bricolage_Grotesque, Caveat, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display" });
const body = Instrument_Sans({ subsets: ["latin"], variable: "--font-body" });
const hand = Caveat({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-hand" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const hindi = Anek_Devanagari({ subsets: ["devanagari", "latin"], variable: "--font-hindi" });

export const metadata: Metadata = {
  title: "SceneSpindle",
  description: "A studio that spins a topic, a script, a song, your photos or a piece of code into a narrated, captioned short film.",
};

export const viewport: Viewport = { themeColor: "#fff6e8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} ${hand.variable} ${mono.variable} ${hindi.variable}`}>
        {children}
      </body>
    </html>
  );
}
