import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono, Lora } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import { SiteHeader } from "@/components/site-header"

const _geist = Geist({ subsets: ["latin"] })
const _geistMono = Geist_Mono({ subsets: ["latin"] })
const _lora = Lora({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "GooseGrade - UWaterloo Grade Calculator",
  description: "Track your assignments and calculate your grades for University of Waterloo courses.",
  icons: {
    icon: [
      { url: "/goosegrade.png", href: "/goosegrade.png" },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="font-serif antialiased" style={{ fontFamily: "var(--font-lora)" }}>
        <SiteHeader />
        <div>{children}</div>
        <Analytics />
      </body>
    </html>
  )
}
