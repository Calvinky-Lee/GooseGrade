'use client';

/**
 * Add courses — specs/06 F2.4, design decision D2 (paste-first intake).
 *
 * The paste box does NOT parse Quest's layout. It harvests course-code-shaped tokens and
 * validates every one against the catalog, then shows a review step before anything is written.
 * Search sits on the same screen as an always-visible fallback, so the worst case degrades to
 * search-first rather than a dead end.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import type { CatalogCourseSummary, ScheduleMatch } from '@/lib/api';

const EXAMPLE = `Spring 2026 | Undergraduate | University of Waterloo

CS 240 - Data Structures & Data Management
  1234  LEC 001  Lecture  MWF 10:30AM - 11:20AM  MC 4021
MATH 239 - Introduction to Combinatorics
  2345  LEC 001  Lecture  TTh 1:00PM - 2:20PM    MC 4045
STAT230 - Probability
  3456  LEC 003  Lecture  MWF 9:30AM - 10:20AM   RCH 101
MUSIC 140 - Rock and Roll
  6789  LEC 001  Lecture  W 7:00PM - 9:50PM      AL 116`;

export default function AddCoursePage() {
  const router = useRouter();
  const [pasted, setPasted] = useState('');
  const [match, setMatch] = useState<ScheduleMatch | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [termId, setTermId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogCourseSummary[]>([]);

  useEffect(() => {
    api.getCurrentTerm().then((t) => setTermId(t?.id ?? null));
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.searchCatalog(query).then((r) => {
        if (!cancelled) setResults(r);
      });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const runMatch = async () => {
    const result = await api.matchPastedSchedule(pasted);
    setMatch(result);
    // Pre-select the first section of each match, which the parser has already ordered so a
    // section hint from the paste wins. The common case needs no interaction at all.
    setChosen(
      Object.fromEntries(result.matched.map((m) => [m.code, m.sections[0]?.id ?? ''])),
    );
    setSkipped({});
  };

  const confirm = async () => {
    if (!termId || !match) return;
    setBusy(true);
    let added = 0;
    const problems: string[] = [];

    for (const m of match.matched) {
      if (skipped[m.code]) continue;
      const catalogId = chosen[m.code];
      if (!catalogId) continue;
      try {
        await api.addCourseFromCatalog(catalogId, termId);
        added += 1;
      } catch (e) {
        problems.push(`${m.code}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    setBusy(false);
    if (problems.length > 0) {
      setNote(`Added ${added}. ${problems.join(' · ')}`);
    } else {
      router.push('/dashboard');
    }
  };

  return (
    <div className="gg-wrap">
      <header className="gg-topbar">
        <Link href="/dashboard" className="gg-brand">
          <span className="gg-goose" aria-hidden="true" />
          <b>GooseGrade</b>
        </Link>
        <Link href="/dashboard" className="gg-termsel" style={{ textDecoration: 'none' }}>
          ← My Term
        </Link>
      </header>

      <div className="gg-seclabel" style={{ marginTop: 0 }}>
        <h2>Paste your schedule</h2>
        <span>fastest way in</span>
      </div>

      <div className="gg-panel">
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="Paste your class schedule from Quest…"
          rows={8}
          style={{
            width: '100%',
            border: '1px solid var(--line-strong)',
            borderRadius: 10,
            padding: 12,
            font: 'inherit',
            fontSize: '0.85rem',
            resize: 'vertical',
            color: 'inherit',
            background: 'var(--panel)',
          }}
        />
        <div className="gg-hint">
          We look for anything shaped like a course code and check it against the catalog —
          we don&apos;t rely on Quest&apos;s formatting, so a messy paste is fine.
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
          <button
            type="button"
            className="gg-termsel"
            onClick={runMatch}
            disabled={pasted.trim().length === 0}
          >
            Find my courses
          </button>
          <button
            type="button"
            className="gg-link"
            style={{ background: 'none', border: 0, cursor: 'pointer' }}
            onClick={() => setPasted(EXAMPLE)}
          >
            use a sample paste
          </button>
        </div>
      </div>

      {match && (
        <>
          <div className="gg-seclabel">
            <h2>Review</h2>
            <span>
              term read from {match.termInferredFrom.replace('_', ' ')}: {match.term}
            </span>
          </div>

          <div className="gg-panel">
            {match.matched.length === 0 && (
              <div className="gg-hint">
                No catalog courses found in that paste. Try search below.
              </div>
            )}

            {match.matched.map((m) => (
              <div className="gg-row" key={m.code} style={{ gridTemplateColumns: '1fr 1fr 90px' }}>
                <div>
                  <div className="label">{m.code}</div>
                  <div className="sub">{m.sections[0]?.name}</div>
                </div>
                <div>
                  {m.sections.length > 1 ? (
                    <select
                      className="gg-select"
                      value={chosen[m.code] ?? ''}
                      onChange={(e) => setChosen((c) => ({ ...c, [m.code]: e.target.value }))}
                      aria-label={`section for ${m.code}`}
                    >
                      {m.sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          Section {s.section ?? '—'}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="gg-hint" style={{ margin: 0 }}>
                      Section {m.sections[0]?.section ?? '—'}
                      {m.sections[0]?.schemeConfidence === 'review' && ' · ⚠ needs review'}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <label className="gg-hint" style={{ margin: 0, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!skipped[m.code]}
                      onChange={(e) =>
                        setSkipped((s) => ({ ...s, [m.code]: !e.target.checked }))
                      }
                    />{' '}
                    add
                  </label>
                </div>
              </div>
            ))}

            {match.unmatched.length > 0 && (
              <div className="gg-warn">
                Not in the catalog: <b>{match.unmatched.join(', ')}</b>. You can still add these
                as custom courses and enter the weights yourself.
              </div>
            )}

            {match.matched.length > 0 && (
              <button
                type="button"
                className="gg-termsel"
                style={{ marginTop: 14 }}
                onClick={confirm}
                disabled={busy || !termId}
              >
                {busy ? 'Adding…' : `Add ${match.matched.filter((m) => !skipped[m.code]).length} courses`}
              </button>
            )}

            {note && <div className="gg-warn">{note}</div>}
          </div>
        </>
      )}

      <div className="gg-seclabel">
        <h2>Or search</h2>
        <span>always available</span>
      </div>

      <div className="gg-panel">
        <input
          className="gg-input"
          style={{ textAlign: 'left' }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. cs240"
          aria-label="search the course catalog"
        />
        {results.map((r) => (
          <div className="gg-row" key={r.id} style={{ gridTemplateColumns: '1fr 90px' }}>
            <div>
              <div className="label">
                {r.code} {r.section ? `· ${r.section}` : ''}
              </div>
              <div className="sub">{r.name}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <button
                type="button"
                className="gg-link"
                style={{ background: 'none', border: 0, cursor: 'pointer' }}
                onClick={() => {
                  if (!termId) return;
                  api
                    .addCourseFromCatalog(r.id, termId)
                    .then(() => router.push('/dashboard'))
                    .catch((e) => setNote(e instanceof Error ? e.message : String(e)));
                }}
              >
                add
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
