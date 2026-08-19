'use client';

/**
 * Signed-out course preview — the moat, on a public page.
 *
 * Replaces the 1,821-line v1 page: same grouping, section picking and calculation, but the
 * maths is @goosegrade/engine and the table is the shared GradeTable. What is left here is the
 * catalog lookup, the section picker, provenance, and the sign-up path.
 *
 * Two behaviour changes from v1, both deliberate:
 *   1. Edits are LOCAL. v1 wrote renames straight to the shared `courses` table, so one
 *      student's edit changed the course for everyone — the bug specs/02 §fork-on-add exists to
 *      fix. Nothing on this page writes to the catalog.
 *   2. Data comes through lib/api, not a direct Supabase query, so this page no longer breaks
 *      when the catalog tables are renamed by 03_v2_catalog.sql.
 */

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';

import { api, type CatalogCourseDetail } from '@goosegrade/api';
import type { Course } from '@goosegrade/types';

import { GradeSummary, GradeTable } from '@/components/gg/GradeTable';

import '../../dashboard/tokens.css';

/** A catalog course is a template; give it a local, editable identity for previewing. */
function toPreviewCourse(detail: CatalogCourseDetail): Course {
  return {
    id: `preview:${detail.id}`,
    catalogCourseId: detail.id,
    code: detail.code,
    name: detail.name,
    section: detail.section,
    creditWeight: detail.creditWeight,
    gradeBasis: detail.gradeBasis,
    gradingRules: detail.gradingRules,
    rulesOverridden: false,
    targetGrade: null,
    assessments: detail.assessments,
  };
}

export default function CoursePreviewPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const decoded = decodeURIComponent(code);

  const [sections, setSections] = useState<CatalogCourseDetail[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [target, setTarget] = useState('80');
  const [signedIn, setSignedIn] = useState(false);
  const [outline, setOutline] = useState<{ url: string; scrapedAt: string } | null>(null);
  const [addState, setAddState] = useState<'idle' | 'adding' | 'added' | 'error'>('idle');
  const [addError, setAddError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSession().then((s) => setSignedIn(s != null)).catch(() => setSignedIn(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getCatalogCourse(decoded)
      .then((found) => {
        if (cancelled) return;
        setSections(found);
        if (found.length > 0) {
          setSelectedId(found[0].id);
          setCourse(toPreviewCourse(found[0]));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [decoded]);

  useEffect(() => {
    if (!selectedId) return;
    api.getOutlineSource(selectedId).then(setOutline).catch(() => setOutline(null));
  }, [selectedId]);

  const selected = useMemo(
    () => sections?.find((s) => s.id === selectedId) ?? null,
    [sections, selectedId],
  );

  const pickSection = (id: string) => {
    const next = sections?.find((s) => s.id === id);
    if (!next) return;
    setSelectedId(id);
    // Switching section replaces the scheme, so any marks entered against the old one no longer
    // apply. Resetting is honest; carrying them over would silently mis-attribute them.
    setCourse(toPreviewCourse(next));
  };

  const addToTerm = async () => {
    if (!selected) return;
    setAddState('adding');
    setAddError(null);
    try {
      const term = await api.getCurrentTerm();
      if (!term) {
        setAddError('No current term yet — set one up first.');
        setAddState('error');
        return;
      }
      await api.addCourseFromCatalog(selected.id, term.id);
      setAddState('added');
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
      setAddState('error');
    }
  };

  return (
    <div className="gg-app">
      <div className="gg-wrap">
        <header className="gg-topbar">
          <Link href="/" className="gg-brand">
            <span className="gg-goose" aria-hidden="true" />
            <b>GooseGrade</b>
          </Link>
          <Link
            href={signedIn ? '/dashboard' : '/auth'}
            className="gg-termsel"
            style={{ textDecoration: 'none' }}
          >
            {signedIn ? 'My Term' : 'Sign in'}
          </Link>
        </header>

        {error && <div className="gg-err">{error}</div>}

        {sections != null && sections.length === 0 && (
          <div className="gg-panel">
            <b>No outline on file for {decoded}</b>
            <div className="gg-hint">
              We only have courses whose outline has been published. You can still work it out in
              the <Link href="/calculator" className="gg-link">calculator</Link>.
            </div>
          </div>
        )}

        {course && selected && (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 680, letterSpacing: '-0.03em', margin: 0 }}>
                {selected.code}
              </h1>
              <span className="gg-hint" style={{ margin: 0 }}>{selected.name}</span>
              {selected.schemeConfidence === 'review' && (
                <span className="gg-chip risk">
                  <span className="d" />
                  needs review
                </span>
              )}
              {selected.schemeConfidence === 'verified' && (
                <span className="gg-chip good">
                  <span className="d" />
                  verified
                </span>
              )}
            </div>

            {(sections?.length ?? 0) > 1 && (
              <div style={{ marginTop: 10, maxWidth: 260 }}>
                <select
                  className="gg-select"
                  value={selectedId ?? ''}
                  onChange={(e) => pickSection(e.target.value)}
                  aria-label="section"
                >
                  {(sections ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      Section {s.section ?? '—'} · {s.term}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <GradeSummary course={course} target={target} onTargetChange={setTarget} />
            </div>

            <div className="gg-seclabel">
              <h2>Assessments</h2>
              <span>weights pre-loaded from the official outline</span>
            </div>

            {/* Weights are NOT editable here: this is the official scheme. Editing belongs on a
                forked copy, which is what signing in gets you. */}
            <GradeTable course={course} onChange={setCourse} showStatus />

            <div className="gg-seclabel">
              <h2>Where this comes from</h2>
              <span>catalog trust</span>
            </div>

            <div className="gg-panel">
              {outline ? (
                <>
                  <a href={outline.url} target="_blank" rel="noreferrer" className="gg-link">
                    View the source outline
                  </a>
                  <div className="gg-hint">
                    {outline.scrapedAt
                      ? `Last checked ${new Date(outline.scrapedAt).toLocaleDateString()}.`
                      : 'Scrape date unknown.'}{' '}
                    Weights are extracted automatically — if something looks wrong, tell us and
                    we will re-check it.
                  </div>
                </>
              ) : (
                <div className="gg-hint">No stored outline for this section.</div>
              )}
            </div>

            <div className="gg-seclabel">
              <h2>{signedIn ? 'Track this course' : 'Keep your marks'}</h2>
              <span>{signedIn ? 'adds a copy you own' : 'free, UWaterloo email'}</span>
            </div>

            <div className="gg-panel">
              {addState === 'added' ? (
                <>
                  <b>Added to your term.</b>
                  <div style={{ marginTop: 10 }}>
                    <Link href="/dashboard" className="gg-termsel" style={{ textDecoration: 'none' }}>
                      Open My Term
                    </Link>
                  </div>
                </>
              ) : signedIn ? (
                <>
                  <button
                    type="button"
                    className="gg-termsel"
                    onClick={addToTerm}
                    disabled={addState === 'adding'}
                  >
                    {addState === 'adding' ? 'Adding…' : 'Add to my term'}
                  </button>
                  {/* Fork-on-add, stated plainly: the copy is yours, so edits cannot leak. */}
                  <div className="gg-hint">
                    You get your own editable copy — your changes never affect anyone else.
                  </div>
                  {addError && <div className="gg-err">{addError}</div>}
                </>
              ) : (
                <>
                  <div className="gg-hint" style={{ marginTop: 0 }}>
                    Marks you enter here are not saved. With an account they persist across the
                    whole term, alongside a credit-weighted term average.
                  </div>
                  <Link
                    href="/auth"
                    className="gg-termsel"
                    style={{ marginTop: 10, display: 'inline-block', textDecoration: 'none' }}
                  >
                    Create an account
                  </Link>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
