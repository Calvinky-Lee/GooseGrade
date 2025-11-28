"use client"

import Image from "next/image"
import { ArrowRight, Search } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase/client"

type CourseResult = {
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
        .select("code, name, term")
        .ilike("code", `%${query.trim()}%`)
        .order("term_date", { ascending: false })
        .limit(5)

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

  const handleSubmit = () => {
    if (results[0]) {
      router.push(`/course/${results[0].code}`)
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f8f8] font-sans text-black">
      <header className="flex items-center justify-between border-b border-gray-300 px-8 py-4">
        <div className="flex items-center space-x-3">
          <Image src="/goosegrade.png" alt="GooseGrade" width={56} height={56} priority />
          <a
            href="#"
            className="border-b border-black text-base font-medium transition-colors hover:text-gray-700 hover:border-gray-700"
          >
            New Calculator
          </a>
        </div>
      </header>

      <main className="relative px-6 pb-24 pt-12 sm:px-12">
        <div
          className="pointer-events-none absolute right-12 top-10 h-[420px] w-[420px] rounded-full bg-gradient-to-br from-yellow-300 via-yellow-400 to-amber-400 blur-3xl opacity-70"
          style={{ animation: "glow-fade 4s ease-in-out infinite" }}
          aria-hidden="true"
        />

        <div className="relative z-10 max-w-[720px]">
          <h1 className="font-light leading-none tracking-tight text-[6rem] sm:text-[8rem]">
            <span className="block text-[6.75rem] font-semibold sm:text-[8.75rem]">
              Calculate
            </span>
            <span className="ml-2 block text-[2.1rem] font-medium sm:text-[2.6rem]">
              Your UWaterloo Grade
            </span>
          </h1>

          <p className="ml-2 mt-6 max-w-2xl text-base font-medium text-gray-700 sm:text-[1.25rem]">
            Enter Your Course Code To Use An Assessment
            <br />
            Weighting Template Straight From Your Outline
          </p>

          <div className="mt-10 max-w-[760px]">
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
              <button
                className="rounded-full bg-[#bcc3d0] p-2.5 text-gray-700 transition hover:bg-[#aab2c0]"
                onClick={handleSubmit}
                aria-label="Go to course"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            {focused && results.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                {results.map((course) => (
                  <button
                    key={course.code + course.term}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      router.push(`/course/${course.code}`)
                    }}
                  >
                    <div>
                      <p className="text-lg font-semibold text-gray-900">{course.code}</p>
                      <p className="text-sm text-gray-600">{course.name}</p>
                    </div>
                    <span className="text-xs font-semibold uppercase tracking-[0.3em] text-gray-500">
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
