'use client'

import Link from "next/link"
import Image from "next/image"
import { Search } from "lucide-react"
import { useRouter, usePathname } from "next/navigation"
import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase/client"

type CourseResult = {
  id: string
  code: string
  name: string
  term: string
}

export function SiteHeader() {
  const router = useRouter()
  const pathname = usePathname()
  const isHomePage = pathname === "/"

  const [query, setQuery] = useState("")
  const [results, setResults] = useState<CourseResult[]>([])
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    async function searchCourses() {
      if (query.trim().length < 2) {
        setResults([])
        return
      }

      const { data } = await supabase
        .from("courses")
        .select("id, code, name, term")
        .ilike("code", `%${query.trim()}%`)
        .order("term_date", { ascending: false })
        .limit(10)

      if (!controller.signal.aborted) {
        setResults(data ?? [])
      }
    }

    const timeout = setTimeout(searchCourses, 200)
    return () => {
      controller.abort()
      clearTimeout(timeout)
    }
  }, [query])

  return (
    <header className={`relative z-20 ${!isHomePage ? 'grid grid-cols-3' : 'flex'} items-center border-b border-gray-300 px-4 sm:px-8 py-2 bg-white`}>
      <div className="flex items-center gap-3 shrink-0">
        <Link href="/" className="flex items-center space-x-1 transition-opacity hover:opacity-90">
          <Image src="/goosegrade.png" alt="GooseGrade" width={48} height={48} priority className="w-10 h-10 sm:w-14 sm:h-14" />
          <span className="text-xl sm:text-[1.5rem] font-semibold text-gray-900">GooseGrade</span>
        </Link>
      </div>

      {/* Centered Search Bar - Hidden on home page */}
      {!isHomePage && (
        <div className="flex justify-center relative hidden sm:block">
          <div className="w-full max-w-3xl relative">
            <div className="flex items-center space-x-4 rounded-2xl bg-[#d6dbe5] px-6 py-3 shadow-inner shadow-white/70">
              <Search className="h-4 w-4 text-gray-700" />
              <input
                type="text"
                placeholder="Search course..."
                className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-500 outline-none"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setTimeout(() => setFocused(false), 200)}
              />
            </div>

            {/* Dropdown Results */}
            {focused && results.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg z-50">
                {results.map((course) => (
                  <button
                    key={course.id}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      router.push(`/course/${course.code}?section=${course.id}`)
                      setQuery("") 
                      setFocused(false)
                    }}
                  >
                    <div className="overflow-hidden">
                      <p className="text-sm font-medium text-gray-900 truncate">{course.code}</p>
                      <p className="text-xs text-gray-500 truncate">{course.name}</p>
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 ml-2 shrink-0">
                      {course.term}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!isHomePage && <div className="hidden sm:block" />} {/* Spacer for visual balance */}
    </header>
  )
}
