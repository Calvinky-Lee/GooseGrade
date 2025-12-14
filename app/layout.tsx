import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono, Lora } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"

const geist = Geist({ subsets: ["latin"] })
const geistMono = Geist_Mono({ subsets: ["latin"] })
const lora = Lora({ subsets: ["latin"] })

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
      <body className={`${lora.className} antialiased flex flex-col h-screen`}>
        <SiteHeader />
        <div className="flex-1 overflow-y-auto">{children}</div>
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  )
}
