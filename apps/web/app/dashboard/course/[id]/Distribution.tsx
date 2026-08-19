'use client';

/**
 * Class distribution panel — specs/06 F5.2.
 *
 * The empty state is the important one. With a minimum-sample floor of 5, "not enough data yet"
 * is what almost every course shows until adoption, so it is written as a real state rather
 * than an afterthought.
 */

import { useEffect, useState } from 'react';

import { api, API_ERROR_CODES, ApiError, type DistributionResult } from '@goosegrade/api';

import { Num } from '../../Num';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: DistributionResult }
  | { kind: 'not_opted_in' }
  | { kind: 'error'; message: string };

export function Distribution({
  catalogCourseId,
  slug,
  term,
  label,
}: {
  catalogCourseId: string | null;
  slug: string | null;
  term: string;
  label: string;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [optingIn, setOptingIn] = useState(false);

  useEffect(() => {
    if (!catalogCourseId) {
      setState({ kind: 'error', message: 'Custom courses have no class distribution.' });
      return;
    }

    let cancelled = false;
    const call = slug
      ? api.getAssessmentDistribution(catalogCourseId, slug, term)
      : api.getCourseDistribution(catalogCourseId, term);

    call
      .then((data) => !cancelled && setState({ kind: 'ready', data }))
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === API_ERROR_CODES.notOptedIn) {
          setState({ kind: 'not_opted_in' });
        } else {
          setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [catalogCourseId, slug, term]);

  const optIn = async () => {
    setOptingIn(true);
    try {
      const profile = await api.getProfile();
      await api.updateProfile({
        settings: { ...profile.settings, contributeDistributions: true },
      });
      setState({ kind: 'loading' });
      if (catalogCourseId) {
        const data = slug
          ? await api.getAssessmentDistribution(catalogCourseId, slug, term)
          : await api.getCourseDistribution(catalogCourseId, term);
        setState({ kind: 'ready', data });
      }
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setOptingIn(false);
    }
  };

  return (
    <>
      <div className="gg-seclabel">
        <h2>Class distribution</h2>
        <span>{label}</span>
      </div>

      <div className="gg-panel">
        {state.kind === 'loading' && <div className="gg-hint" aria-busy="true">Loading…</div>}

        {state.kind === 'error' && <div className="gg-hint">{state.message}</div>}

        {state.kind === 'not_opted_in' && (
          <>
            <b>Contribute to see distributions</b>
            <div className="gg-hint">
              Distributions are give-to-get: sharing your own marks anonymously is what unlocks
              seeing everyone else&apos;s. You can turn it off again at any time.
            </div>
            <button
              type="button"
              className="gg-termsel"
              style={{ marginTop: 10 }}
              onClick={optIn}
              disabled={optingIn}
            >
              {optingIn ? 'Turning on…' : 'Contribute my marks'}
            </button>
          </>
        )}

        {state.kind === 'ready' && !state.data.available && (
          <>
            <b>Not enough data yet</b>
            <div className="gg-hint">
              A distribution only appears once enough people in this course have contributed that
              no individual mark could be picked out of it. Nothing is shown before then — not a
              partial chart, not a count.
            </div>
          </>
        )}

        {state.kind === 'ready' && state.data.available && (
          <>
            <div style={{ display: 'flex', gap: 'var(--s5)' }}>
              <div className="gg-mini">
                <div className="gg-eyebrow">Mean</div>
                <div className="v"><Num value={state.data.mean} /></div>
              </div>
              <div className="gg-mini">
                <div className="gg-eyebrow">Median</div>
                <div className="v"><Num value={state.data.median} /></div>
              </div>
              <div className="gg-mini">
                <div className="gg-eyebrow">You</div>
                <div className="v">
                  {state.data.myPercentile == null ? (
                    <span className="gg-n">—</span>
                  ) : (
                    <>
                      <Num value={state.data.myPercentile} decimals={0} unit={null} />
                      <span className="gg-u" style={{ fontSize: '0.55em' }}>
                        {ordinal(state.data.myPercentile)}
                      </span>
                    </>
                  )}
                </div>
                <div className="s">percentile</div>
              </div>
              <div className="gg-mini">
                <div className="gg-eyebrow">Sample</div>
                <div className="v">
                  <Num value={state.data.count} decimals={0} unit={null} />
                </div>
                <div className="s">contributors</div>
              </div>
            </div>

            <Histogram data={state.data} />
          </>
        )}
      </div>
    </>
  );
}

/**
 * Plain divs rather than a charting library. The shape is a fixed set of 10-point buckets, so
 * recharts would add a client bundle and an axis system for something a flexbox row does — and
 * it keeps the bars on the same brand gradient as the progress bars elsewhere.
 */
function Histogram({ data }: { data: DistributionResult }) {
  const max = Math.max(...data.buckets.map((b) => b.count), 1);
  const myBucket =
    data.myPercentile == null
      ? null
      : data.buckets.find((b) => data.mean >= b.rangeLow && data.mean < b.rangeHigh) ?? null;

  return (
    <div className="gg-hist" role="img" aria-label="grade distribution histogram">
      {data.buckets.map((b) => (
        <div key={b.rangeLow}>
          <i
            className={myBucket === b ? 'mine' : undefined}
            style={{ height: `${(b.count / max) * 100}%` }}
            title={`${b.rangeLow}–${b.rangeHigh}: ${b.count}`}
          />
          <span>{b.rangeLow}</span>
        </div>
      ))}
    </div>
  );
}

function ordinal(n: number): string {
  const v = Math.round(n) % 100;
  if (v >= 11 && v <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][Math.min(v % 10, 4)] ?? 'th';
}
