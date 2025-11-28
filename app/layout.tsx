import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono, Lora } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"

const _geist = Geist({ subsets: ["latin"] })
const _geistMono = Geist_Mono({ subsets: ["latin"] })
const _lora = Lora({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "GooseGrade - UWaterloo Grade Calculator",
  description: "Track your assignments and calculate your grades for University of Waterloo courses.",
  icons: {
    icon: [
      { url: "/logo.png", href: "/logo.png" },
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
        {children}
        <Analytics />
      </body>
    </html>
  )
}
