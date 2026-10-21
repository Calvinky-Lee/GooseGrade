"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  BookOpen,
  Check,
  SlidersHorizontal,
} from "lucide-react";
import { CourseSearch } from "@/components/course-search";
import { catalogCounts } from "@/lib/catalog/queries";
import { DEFAULT_TERM } from "@/lib/catalog/terms";
export default function Page() {
  const [counts, setCounts] = useState<{ total: number; ready: number } | null>(
    null,
  );
  useEffect(() => {
    catalogCounts(DEFAULT_TERM)
      .then(setCounts)
      .catch(() => {});
  }, []);
  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <span className="pill">
            <span className="dot" /> WINTER 2027 EDITION
          </span>
          <h1>
            A little clarity.
            <br />
            <em>A better next step.</em>
          </h1>
          <p>
            Your course. Your weightings. Your next move.
            <br />
            Make sense of your UWaterloo grade, one assessment at a time.
          </p>
          <div className="hero-actions">
            <a className="button button-dark" href="#courses">
              Find your course <ArrowDown size={17} />
            </a>
            <Link className="text-link" href="/calculator">
              Start from scratch <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className="hero-proof">
            <span>
              <Check size={15} /> No account needed
            </span>
            <span>
              <Check size={15} /> Built for Waterloo
            </span>
          </div>
        </div>
        <div className="hero-visual" aria-label="Example grade calculation">
          <div className="example-top">
            <span className="eyebrow">LESS GUESSWORK. MORE CLARITY.</span>
            <span className="example-badge">EXAMPLE</span>
          </div>
          <div className="example-title">
            Your next chapter<span>One course at a time</span>
          </div>
          <div className="example-grade">
            84<span>%</span>
            <small>average on graded work</small>
          </div>
          <div className="example-rule" />
          <div className="example-row">
            <span>
              <span className="mini-dot" /> Assignments
            </span>
            <strong>
              88 <small>/ 100</small>
            </strong>
          </div>
          <div className="example-row">
            <span>
              <span className="mini-dot dark" /> Midterm
            </span>
            <strong>
              80 <small>/ 100</small>
            </strong>
          </div>
          <div className="example-row muted">
            <span>Final exam</span>
            <span>Still ahead</span>
          </div>
          <div className="example-note">
            <span>Looking ahead</span>
            <p>See what you need to reach your goal.</p>
            <ArrowUpRight size={22} />
          </div>
        </div>
      </section>
      <section className="trust-strip" aria-label="How GooseGrade works">
        <div>
          <BookOpen size={21} />
          <span>
            <strong>Start with the source</strong>Weightings from official
            course outlines
          </span>
        </div>
        <div>
          <SlidersHorizontal size={21} />
          <span>
            <strong>Make it your own</strong>Try scenarios without changing the
            catalog
          </span>
        </div>
        <div className="catalog-stat">
          <strong>{counts ? counts.total.toLocaleString() : "—"}</strong>
          <span>
            Winter 2027 courses
            <br />
            {counts
              ? `${counts.ready} with ready weightings`
              : "Catalog totals loading"}
          </span>
        </div>
      </section>
      <Suspense fallback={<p className="loading-message">Loading catalog…</p>}>
        <CourseSearch />
      </Suspense>
    </main>
  );
}
