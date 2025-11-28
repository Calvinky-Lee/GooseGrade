'use client'

import Link from "next/link"
import Image from "next/image"
import { ArrowLeft } from "lucide-react"
import { usePathname } from "next/navigation"

export function SiteHeader() {
  const pathname = usePathname()
  const showBackArrow = pathname?.startsWith("/course/")

  return (
    <header className="relative z-20 flex items-center border-b border-gray-300 px-8 py-2">
      <div className="flex items-center gap-3">
        {showBackArrow && (
          <Link
            href="/"
            className="rounded-full border border-gray-300 p-2 text-gray-700 transition hover:bg-gray-100"
            aria-label="Back to search"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        <Link href="/" className="ml-2 flex items-center space-x-2 transition-opacity hover:opacity-90">
          <Image src="/goosegrade.png" alt="GooseGrade" width={56} height={56} priority />
          <span className="text-[1.65rem] font-semibold text-gray-900">GooseGrade</span>
        </Link>
      </div>
    </header>
  )
}

