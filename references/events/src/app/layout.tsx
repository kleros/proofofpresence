import type { Metadata } from "next";
import { Suspense } from "react";
import { Instrument_Serif, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./styles/console.css";
import "./styles/admin.css";
import "./styles/transcript.css";
import "./styles/studio.css";
import "./styles/ask.css";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import AskLauncher from "@/components/ask/AskLauncher";
import { SITE_URL } from "@/lib/kleros";

// Kleros house faces: Instrument Serif for display, Geist for text, a mono for chips.
const display = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-display" });
const body = Geist({ subsets: ["latin"], variable: "--font-body" });
const mono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Kleros Events", template: "%s · Kleros Events" },
  description: "Every event Kleros hosts or takes part in, with the talks, slides and recordings to match.",
  openGraph: { siteName: "Kleros Events", type: "website" },
  twitter: { card: "summary_large_image", site: "@kleros_io" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
        {/* checks the question counter (up to 2 s) without holding up the page */}
        <Suspense fallback={null}><AskLauncher /></Suspense>
      </body>
    </html>
  );
}
