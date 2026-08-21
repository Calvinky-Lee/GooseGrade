'use client';

/**
 * Onboarding — specs/06 F1.2, amended for paste-first intake (D2).
 *
 * The whole point is the < 2 minute success criterion, so this is three steps and the middle one
 * is a paste box. Program and level are asked AFTER the courses are in, because they are not
 * needed to add courses any more (suggestCourses was deferred, amendment A4) and asking first
 * puts a form between the student and the thing they came to do.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@goosegrade/api';
import type { ScheduleMatch } from '@goosegrade/api';

import { termForDate } from '@goosegrade/api';

import { TopBar } from '../AppChrome';

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestedTerm = termForDate(new Date());
  const [label, setLabel] = useState(suggestedTerm);
  const [date, setDate] = useState(defaultTermDate(suggestedTerm));
  const [termId, setTermId] = useState<string | null>(null);

  const [pasted, setPasted] = useState('');
  const [match, setMatch] = useState<ScheduleMatch | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [added, setAdded] = useState(0);

  const [program, setProgram] = useState('');
  const [level, setLevel] = useState('');

  const createTerm = async () => {
    setBusy(true);
    setError(null);
    try {
      const term = await api.createTerm(label, date);
      setTermId(term.id);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const findCourses = async () => {
    setBusy(true);
    try {
      const result = await api.matchPastedSchedule(pasted, label);
      setMatch(result);
      setChosen(
        Object.fromEntries(result.matched.map((m) => [m.code, m.sections[0]?.id ?? ''])),
      );
    } finally {
      setBusy(false);
    }
  };

  const addCourses = async () => {
    if (!termId || !match) return;
    setBusy(true);
    let count = 0;
    for (const m of match.matched) {
      const id = chosen[m.code];
      if (!id) continue;
      try {
        await api.addCourseFromCatalog(id, termId);
        count += 1;
      } catch {
        // already-added is fine here; keep going rather than aborting the whole intake
      }
    }
    setAdded(count);
    setBusy(false);
    setStep(3);
  };

  const finish = async () => {
    setBusy(true);
    try {
      if (program || level) {
        await api.updateProfile({
          program: program || null,
          currentLevel: level || null,
        });
      }
      router.push('/dashboard');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gg-wrap">
      <TopBar />

      <div className="gg-eyebrow">Step {step} of 3</div>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 680, letterSpacing: '-0.03em', margin: '6px 0 4px' }}>
        {step === 1 ? 'Which term is this?' : step === 2 ? 'Add your courses' : 'Almost done'}
      </h1>

      {step === 1 && (
        <div className="gg-panel" style={{ maxWidth: 420, marginTop: 16 }}>
          <label className="gg-label" htmlFor="ob-label">Term name</label>
          <input
            id="ob-label"
            className="gg-textinput"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />

          <label className="gg-label" htmlFor="ob-date">First day of term</label>
          <input
            id="ob-date"
            className="gg-textinput"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <div className="gg-hint">Used only for ordering your terms.</div>

          {error && <div className="gg-err">{error}</div>}
          <button className="gg-btn" onClick={createTerm} disabled={busy || !label || !date}>
            {busy ? 'Creating…' : 'Continue'}
          </button>
        </div>
      )}

      {step === 2 && (
        <>
          <p className="gg-hint">
            Paste your class schedule from Quest. We look for anything shaped like a course code
            and check it against the catalog, so a messy paste is fine.
          </p>

          <div className="gg-panel">
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={7}
              placeholder="Paste here…"
              aria-label="pasted class schedule"
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
            <button
              type="button"
              className="gg-termsel"
              style={{ marginTop: 10 }}
              onClick={findCourses}
              disabled={busy || pasted.trim().length === 0}
            >
              {busy ? 'Looking…' : 'Find my courses'}
            </button>

            {match && (
              <div style={{ marginTop: 14 }}>
                {match.matched.map((m) => (
                  <div className="gg-row" key={m.code} style={{ gridTemplateColumns: '1fr 1fr' }}>
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
                          {m.sections.map((sec) => (
                            <option key={sec.id} value={sec.id}>
                              Section {sec.section ?? '—'}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="gg-hint" style={{ margin: 0 }}>
                          Section {m.sections[0]?.section ?? '—'}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {match.unmatched.length > 0 && (
                  <div className="gg-warn">
                    Not in the catalog: <b>{match.unmatched.join(', ')}</b>. You can add these as
                    custom courses later.
                  </div>
                )}

                <button
                  className="gg-btn"
                  onClick={addCourses}
                  disabled={busy || match.matched.length === 0}
                >
                  Add {match.matched.length} course{match.matched.length === 1 ? '' : 's'}
                </button>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="gg-link"
                style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
                onClick={() => setStep(3)}
              >
                skip — I&apos;ll add them myself
              </button>
            </div>
          </div>
        </>
      )}

      {step === 3 && (
        <div className="gg-panel" style={{ maxWidth: 420, marginTop: 16 }}>
          {added > 0 && (
            <div className="gg-hint" style={{ marginTop: 0 }}>
              Added {added} course{added === 1 ? '' : 's'} to {label}.
            </div>
          )}

          <label className="gg-label" htmlFor="ob-program">Program (optional)</label>
          <input
            id="ob-program"
            className="gg-textinput"
            value={program}
            onChange={(e) => setProgram(e.target.value)}
            placeholder="Computer Science"
          />

          <label className="gg-label" htmlFor="ob-level">Level (optional)</label>
          <input
            id="ob-level"
            className="gg-textinput"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            placeholder="2B"
          />

          <button className="gg-btn" onClick={finish} disabled={busy}>
            {busy ? 'Saving…' : 'Go to my term'}
          </button>
        </div>
      )}
    </div>
  );
}

/** First day of the UW term, so the date field starts on something sensible. */
function defaultTermDate(termLabel: string): string {
  const [season, year] = termLabel.split(' ');
  const month = season === 'Winter' ? '01' : season === 'Spring' ? '05' : '09';
  return `${year}-${month}-01`;
}
