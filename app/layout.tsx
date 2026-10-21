import { Analytics } from "@vercel/analytics/next";
import type React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
export const metadata: Metadata = {
  title: "GooseGrade — A little clarity for your Waterloo grade",
  description:
    "Explore Winter 2027 UWaterloo courses and calculate your grade with source-backed assessment weightings. No account needed.",
  icons: { icon: "/goosegrade.png" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader />
        <div id="main-content">{children}</div>
        <footer className="site-footer">
          <Link href="/" className="footer-brand">
            GooseGrade.
          </Link>
          <p>A little less grade anxiety. A little more clarity.</p>
          <span>
            Independent student project · Not affiliated with UWaterloo
          </span>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
