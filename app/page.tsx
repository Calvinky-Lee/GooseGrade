"use client"

import { Search } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase/client"

type CourseResult = {
  id: string
  code: string
  name: string
  term: string
}

export default function Page() {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<CourseResult[]>([])
  const [focused, setFocused] = useState(false)
  const router = useRouter()

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
        .limit(10) // Increase limit to show multiple sections

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
    <div className="relative min-h-screen overflow-hidden bg-[#f8f8f8] font-sans text-black">
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div
          className="absolute left-[calc(50%+10px)] bottom-[-10px] h-[360px] w-[360px] rounded-full bg-gradient-to-br from-[#b76e79] via-[#a85c68] to-[#8f3f4c] blur-3xl opacity-55"
          style={{ animation: "glow-fade 4s ease-in-out infinite" }}
          aria-hidden="true"
        />
        <div
          className="absolute left-[75%] top-[80px] h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-gradient-to-br from-[#ffeaa7] via-[#f9c74f] to-[#f08a24] blur-3xl opacity-65"
          style={{ animation: "glow-fade 4s ease-in-out infinite" }}
          aria-hidden="true"
        />
        <div
          className="absolute right-[-10px] bottom-[-10px] h-[380px] w-[380px] rounded-full bg-gradient-to-br from-[#ffd29c] via-[#ff9d47] to-[#ff6b1a] blur-3xl opacity-55"
          style={{ animation: "glow-fade 4s ease-in-out infinite" }}
          aria-hidden="true"
        />
      </div>

      <main className="relative z-10 px-6 pb-24 pt-20 sm:px-12 sm:pt-28">
        <div className="max-w-[720px]">
          <h1 className="font-light leading-none tracking-tight text-[6rem] sm:text-[8rem]">
            <span className="block text-[6.75rem] font-semibold sm:text-[8.75rem]">
              Calculate
            </span>
            <span className="ml-2 block text-[2.1rem] font-medium sm:text-[2.6rem]">
              Your UWaterloo Grade
            </span>
          </h1>

          <p className="ml-2 mt-6 max-w-2xl text-base font-medium text-gray-700 sm:text-[1.25rem]">
            Enter Your Course Code To See Your
            <br />
            Assessment Weightings From Your Outline
          </p>

          <div className="mt-10 w-full max-w-[1100px]">
            <div className="flex items-center space-x-4 rounded-2xl bg-[#d6dbe5] px-6 py-4 shadow-inner shadow-white/70">
              <Search className="h-5 w-5 text-gray-700" />
              <input
                type="text"
                placeholder="Enter In Your Course To Start"
                className="flex-1 bg-transparent text-base text-gray-800 placeholder:text-gray-500 outline-none sm:text-lg"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setTimeout(() => setFocused(false), 200)}
              />
            </div>

            {focused && results.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                {results.map((course) => (
                  <button
                    key={course.id}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      router.push(`/course/${course.code}?section=${course.id}`)
                    }}
                  >
                    <div>
                      <p className="text-lg font-semibold text-gray-900">{course.code}</p>
                      <p className="text-sm text-gray-600">{course.name}</p>
                    </div>
                    <span className="text-xs font-semibold uppercase tracking-[0.3em] text-gray-500 whitespace-nowrap">
                      {course.term}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
