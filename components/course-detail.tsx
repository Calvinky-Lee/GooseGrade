"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Clock3 } from "lucide-react";
import { loadCourse } from "@/lib/catalog/queries";
import { DEFAULT_TERM, termInfo, normalizeCode } from "@/lib/catalog/terms";
import { GradeCalculator } from "./grade-calculator";
export function CourseDetail({ code }: { code: string }) {
  const params = useSearchParams(),
    router = useRouter();
  const termString = params.get("term"),
    section = params.get("section"),
    term = termString ? Number(termString) : DEFAULT_TERM;
  const [data, setData] = useState<Awaited<
      ReturnType<typeof loadCourse>
    > | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const normalized = normalizeCode(code);
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    loadCourse(normalized, term, section, !!termString)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [normalized, term, section, termString, retry]);
  if (error)
    return (
      <main className="page-shell course-page">
        <Link
          href={`/?term=${data?.term || term}#courses`}
          className="back-link"
        >
          ← Back to courses
        </Link>
        <div className="empty-state" role="alert">
          <h1>We couldn’t open that course.</h1>
          <p>{error}</p>
          <button className="button" onClick={() => setRetry((x) => x + 1)}>
            Retry
          </button>
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="page-shell course-page" aria-busy="true">
        <p className="loading-message">Loading your course…</p>
      </main>
    );
  const label = termInfo(data.term).label,
    scheme = data.selected,
    status =
      scheme?.validation_status || data.offering?.outline_status || "pending";
  const ready =
      scheme?.validation_status === "ready" && data.assessments.length > 0,
    legacy = scheme?.validation_status === "legacy";
  const safeOutline = scheme?.outline_url?.startsWith(
    "https://outline.uwaterloo.ca/",
  )
    ? scheme.outline_url
    : null;
  return (
    <main className="page-shell course-page">
      <Link href={`/?term=${data?.term || term}#courses`} className="back-link">
        ← Back to courses
      </Link>
      <div className="course-heading">
        <span className="pill">{label}</span>
        <h1>
          {normalized}
          <span>{data.offering?.name || scheme?.name}</span>
        </h1>
        <div className="course-source">
          <span>
            {ready
              ? "Source-checked weightings"
              : legacy
                ? "Historical outline · Not revalidated"
                : status === "review"
                  ? "Weightings under review"
                  : status === "error"
                    ? "Outline check delayed"
                    : "Weightings pending"}
          </span>
          {safeOutline && (
            <a href={safeOutline} target="_blank" rel="noreferrer">
              View official outline <ArrowUpRight size={15} />
            </a>
          )}
        </div>
      </div>
      {data.sections.length > 1 && (
        <label className="section-selector">
          Course section
          <select
            value={scheme?.id}
            onChange={(e) =>
              router.push(
                `/course/${encodeURIComponent(normalized)}?term=${data.term}&section=${e.target.value}`,
              )
            }
          >
            {data.sections.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name} · {s.outline_url.split("/").pop()}
              </option>
            ))}
          </select>
        </label>
      )}
      {ready ? (
        <GradeCalculator
          key={scheme!.id}
          sourceLabel={`${normalized} · ${label}`}
          initial={data.assessments.map((a) => ({
            id: a.id,
            name: a.name,
            weight: String(a.weight),
            grade: "",
            group: a.group_name || "",
          }))}
        />
      ) : (
        <section className="pending-panel">
          <div className="pending-icon">
            <Clock3 size={30} />
          </div>
          <span className="eyebrow">GOOD INFORMATION IS WORTH WAITING FOR</span>
          <h2>
            {legacy
              ? "A historical outline, with a fresh start."
              : status === "review"
                ? "These weightings need a closer look."
                : status === "error"
                  ? "We couldn’t finish checking this outline."
                  : "Your course is here. Its weightings are on the way."}
          </h2>
          <p>
            {legacy
              ? "This older grading scheme has not been revalidated. Open its official outline and enter the confirmed weights in the custom calculator."
              : status === "review"
                ? "The source contains grading details that need review before we can offer a reliable calculation."
                : status === "error"
                  ? "A source check failed. This does not mean the outline is unpublished."
                  : "We haven’t found a published, validated grading scheme for this term yet. We won’t substitute weights from another term."}
          </p>
          {data.offering?.checked_at && (
            <p className="last-checked">
              Last checked{" "}
              {new Date(data.offering.checked_at).toLocaleDateString("en-CA", {
                timeZone: "America/Toronto",
              })}
              .
            </p>
          )}
          <div className="button-row">
            <Link className="button button-dark" href="/calculator">
              Use the custom calculator <ArrowUpRight size={16} />
            </Link>
            <a
              className="text-link"
              href={`https://outline.uwaterloo.ca/viewer/?q=${encodeURIComponent(normalized)}`}
              target="_blank"
              rel="noreferrer"
            >
              Look for an outline <ArrowUpRight size={16} />
            </a>
          </div>
        </section>
      )}
    </main>
  );
}
