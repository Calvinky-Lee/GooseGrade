'use client';

/**
 * Lifetime academic record and term rollover — specs/06 F4.1, F4.2.
 *
 * Past-term averages are RECOMPUTED from stored assessments rather than read from a frozen
 * figure. Snapshot-lock was deliberately cut (design §4 G6), so an engine fix does change a
 * past term's average — recorded as a decision, not an accident.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { api } from '@goosegrade/api';
import { computeCumulative, computeTermAverage } from '@goosegrade/engine';
import type { Term } from '@goosegrade/types';

import { FeedbackButton, TopBar } from '../AppChrome';
import { Num } from '../Num';

export default function RecordPage() {
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [rolling, setRolling] = useState(false);
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');
  const [clone, setClone] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    // populate:true — computeCumulative needs every term's courses (amendment A1).
    api.listTerms({ populate: true }).then(setTerms).catch((e) => setError(String(e)));
  };
  useEffect(load, []);

  const cumulative = useMemo(() => computeCumulative(terms ?? []), [terms]);
  const current = terms?.find((t) => t.isCurrent) ?? null;

  const doRollover = async () => {
    if (!current || !label || !date) return;
    setError(null);
    try {
      await api.rolloverTerm(current.id, label, date, clone);
      setRolling(false);
      setLabel('');
      setDate('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="gg-wrap">
      <TopBar
        right={
          <Link href="/dashboard" className="gg-termsel" style={{ textDecoration: 'none' }}>
            ← My Term
          </Link>
        }
      />

      <section className="gg-hero">
        <div>
          <div className="gg-eyebrow">Cumulative average</div>
          <div className="gg-heroval">
            <Num value={cumulative.average} />
          </div>
          <div className="gg-heronote">
            credit-weighted over{' '}
            <b>
              <Num value={cumulative.includedCredits} decimals={1} unit={null} />
            </b>{' '}
            credits · {cumulative.perTerm.length} term
            {cumulative.perTerm.length === 1 ? '' : 's'} on record
          </div>
        </div>
      </section>

      <div className="gg-seclabel">
        <h2>Terms</h2>
        <span>newest last</span>
      </div>

      <div className="gg-panel">
        {terms == null && <div className="gg-hint" aria-busy="true">Loading…</div>}
        {terms?.length === 0 && <div className="gg-hint">No terms yet.</div>}

        {cumulative.perTerm.map((t) => {
          const term = terms?.find((x) => x.id === t.termId);
          return (
            <div className="gg-termrow" key={t.termId}>
              <div>
                <div className="label">
                  {t.termLabel}
                  {term?.isCurrent ? ' · current' : ''}
                </div>
                <div className="sub">
                  {term?.courses.length ?? 0} course{(term?.courses.length ?? 0) === 1 ? '' : 's'}
                </div>
              </div>
              <div className="gg-n" style={{ fontWeight: 660 }}>
                <Num value={t.average} />
              </div>
              <div className="gg-hint" style={{ margin: 0 }}>
                <Num value={t.credits} decimals={1} unit={null} /> cr
              </div>
              <div style={{ textAlign: 'right' }}>
                {!term?.isCurrent && (
                  <button
                    type="button"
                    className="gg-link"
                    style={{ background: 'none', border: 0, cursor: 'pointer' }}
                    onClick={() => api.setCurrentTerm(t.termId).then(load)}
                  >
                    make current
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Rollover — F4.2 */}
      <div className="gg-seclabel">
        <h2>Start a new term</h2>
        <span>archives the current one</span>
      </div>

      <div className="gg-panel">
        {!rolling ? (
          <button type="button" className="gg-termsel" onClick={() => setRolling(true)}>
            Roll over from {current?.termLabel ?? 'current term'}
          </button>
        ) : (
          <div style={{ maxWidth: 420 }}>
            <label className="gg-label" htmlFor="rollover-label">
              Term name
            </label>
            <input
              id="rollover-label"
              className="gg-textinput"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Fall 2026"
            />

            <label className="gg-label" htmlFor="rollover-date">
              First day of term
            </label>
            <input
              id="rollover-date"
              className="gg-textinput"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />

            <label className="gg-hint" style={{ display: 'block', marginTop: 12 }}>
              <input
                type="checkbox"
                checked={clone}
                onChange={(e) => setClone(e.target.checked)}
              />{' '}
              Copy this term&apos;s courses over
            </label>
            {/* Stated explicitly: a rollover that carried marks forward would corrupt the new
                term's average, so it copies the course shells only. */}
            <div className="gg-hint">Course shells only — marks are not copied.</div>

            {error && <div className="gg-err">{error}</div>}

            <button
              type="button"
              className="gg-btn"
              onClick={doRollover}
              disabled={!label || !date}
            >
              Create {label || 'term'}
            </button>
            <button
              type="button"
              className="gg-link"
              style={{ background: 'none', border: 0, cursor: 'pointer', marginTop: 10 }}
              onClick={() => setRolling(false)}
            >
              cancel
            </button>
          </div>
        )}
      </div>

      <FeedbackButton />
    </div>
  );
}
