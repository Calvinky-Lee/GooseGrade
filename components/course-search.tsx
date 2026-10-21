"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Search, ArrowUpRight, ArrowLeft, ArrowRight } from "lucide-react";
import { catalogTerms, searchCatalog, Offering } from "@/lib/catalog/queries";
import { DEFAULT_TERM, termInfo } from "@/lib/catalog/terms";
export function CourseSearch() {
  const params = useSearchParams(),
    router = useRouter();
  const rawTerm = Number(params.get("term") || DEFAULT_TERM);
  let selectedTerm = DEFAULT_TERM;
  try {
    termInfo(rawTerm);
    selectedTerm = rawTerm;
  } catch {}
  const [term, setTerm] = useState(selectedTerm),
    [terms, setTerms] = useState([DEFAULT_TERM]),
    [query, setQuery] = useState(params.get("q") || ""),
    [page, setPage] = useState(0),
    [rows, setRows] = useState<Offering[]>([]),
    [count, setCount] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    setTerm(selectedTerm);
    setQuery(params.get("q") || "");
    setPage(0);
  }, [selectedTerm, params]);
  useEffect(() => {
    catalogTerms()
      .then(setTerms)
      .catch(() => {});
  }, []);
  useEffect(() => {
    let live = true;
    setBusy(true);
    const timer = setTimeout(() => {
      searchCatalog(query, term, page)
        .then((r) => {
          if (live) {
            setRows(r.rows);
            setCount(r.count);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setBusy(false);
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, term, page, retry]);
  return (
    <section
      id="courses"
      className="catalog-section"
      aria-labelledby="catalog-title"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE COURSE CATALOG</span>
          <h2 id="catalog-title">Find your starting point.</h2>
        </div>
        <label className="term-label">
          Academic term
          <select
            value={term}
            onChange={(e) => {
              setRows([]);
              setTerm(Number(e.target.value));
              setPage(0);
              router.replace(
                `/?term=${e.target.value}&q=${encodeURIComponent(query)}#courses`,
                { scroll: false },
              );
            }}
          >
            {terms.map((t) => (
              <option key={t} value={t}>
                {termInfo(t).label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="search-box">
        <Search size={22} />
        <input
          aria-label="Search courses"
          onKeyDown={(e) => {
            if (e.key === "Enter")
              router.replace(
                `/?term=${term}&q=${encodeURIComponent(query)}#courses`,
                { scroll: false },
              );
          }}
          placeholder="Try CS 135, MATH 137, or a course name…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <span className="search-hint">COURSE / NAME</span>
      </div>
      <div className="catalog-meta" aria-live="polite">
        <span>
          {busy
            ? "Finding courses…"
            : error
              ? "Catalog unavailable"
              : `${count.toLocaleString()} courses · ${termInfo(term).label}`}
        </span>
        <span>Official outlines. Clear weightings.</span>
      </div>
      {error ? (
        <div role="alert" className="empty-state">
          <h3>Let’s try that again.</h3>
          <p>{error}</p>
          <button className="button" onClick={() => setRetry((x) => x + 1)}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <div
            className={`course-grid ${busy ? "is-loading" : ""}`}
            aria-busy={busy}
          >
            {rows.map((c) => (
              <Link
                className="course-card"
                key={c.code}
                href={`/course/${encodeURIComponent(c.code)}?term=${c.term_id}`}
              >
                <div className="course-card-top">
                  <span className="course-code">{c.code}</span>
                  <ArrowUpRight size={19} />
                </div>
                <h3>{c.name}</h3>
                <div className="course-card-foot">
                  <span>{c.term}</span>
                  <span
                    className={`status ${c.outline_status === "ready" ? "status-ready" : ""}`}
                  >
                    {c.outline_status === "ready"
                      ? "Ready to calculate"
                      : c.outline_status === "review"
                        ? "Under review"
                        : c.outline_status === "error"
                          ? "Check delayed"
                          : c.outline_status === "legacy"
                            ? "Historical outline"
                            : "Weightings pending"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
          {!busy && !rows.length && (
            <div className="empty-state">
              <h3>No courses found.</h3>
              <p>Try another course code, name, or academic term.</p>
            </div>
          )}
          <div className="pagination">
            <button
              className="button button-quiet"
              disabled={page === 0 || busy}
              onClick={() => setPage((p) => p - 1)}
            >
              <ArrowLeft size={16} /> Previous
            </button>
            <span>
              Page {page + 1} of {Math.max(1, Math.ceil(count / 12))}
            </span>
            <button
              className="button button-quiet"
              disabled={(page + 1) * 12 >= count || busy}
              onClick={() => setPage((p) => p + 1)}
            >
              Next <ArrowRight size={16} />
            </button>
          </div>
        </>
      )}
      <p className="catalog-note">
        A listed course may not have a published outline yet. We show pending
        weightings rather than borrowing them from another term.
      </p>
    </section>
  );
}
