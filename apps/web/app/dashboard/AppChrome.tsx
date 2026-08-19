'use client';

import Link from 'next/link';
import { useState } from 'react';

import { api } from '@goosegrade/api';

/** Topbar used by every app screen. `right` is the screen-specific control. */
export function TopBar({ right }: { right?: React.ReactNode }) {
  return (
    <header className="gg-topbar">
      <Link href="/dashboard" className="gg-brand">
        <span className="gg-goose" aria-hidden="true" />
        <b>GooseGrade</b>
      </Link>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {right}
        <Link href="/dashboard/settings" className="gg-termsel" style={{ textDecoration: 'none' }}>
          Settings
        </Link>
      </div>
    </header>
  );
}

/**
 * Global feedback button — specs/06 F5.3.
 *
 * Fixed to the corner so it is reachable from every screen, and it prefills the page URL
 * because the single most useful field in a bug report is the one users never fill in.
 */
export function FeedbackButton({
  defaultCategory = 'bug',
  contextNote,
}: {
  defaultCategory?: 'bug' | 'suggestion' | 'course_data' | 'other';
  contextNote?: string;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(defaultCategory);
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setState('sending');
    try {
      await api.submitFeedback({
        category,
        message: contextNote ? `${contextNote}\n\n${message}` : message,
        pageUrl: typeof window === 'undefined' ? undefined : window.location.href,
      });
      setState('sent');
      setMessage('');
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!open) {
    return (
      <button type="button" className="gg-fab" onClick={() => setOpen(true)}>
        Feedback
      </button>
    );
  }

  return (
    <div className="gg-fabpanel" role="dialog" aria-label="Send feedback">
      {state === 'sent' ? (
        <>
          <b>Thanks — sent.</b>
          <div className="gg-hint">We read every one.</div>
          <button
            type="button"
            className="gg-termsel"
            style={{ marginTop: 10 }}
            onClick={() => {
              setOpen(false);
              setState('idle');
            }}
          >
            Close
          </button>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <b>Send feedback</b>
            <button
              type="button"
              className="gg-link"
              style={{ background: 'none', border: 0, cursor: 'pointer' }}
              onClick={() => setOpen(false)}
            >
              close
            </button>
          </div>

          <select
            className="gg-select"
            style={{ marginTop: 10 }}
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
            aria-label="feedback category"
          >
            <option value="bug">Something is broken</option>
            <option value="course_data">Course weights are wrong</option>
            <option value="suggestion">Suggestion</option>
            <option value="other">Other</option>
          </select>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder={
              category === 'course_data'
                ? 'Which course, and what should the weights be?'
                : 'What happened?'
            }
            aria-label="feedback message"
            style={{
              width: '100%',
              marginTop: 8,
              border: '1px solid var(--line-strong)',
              borderRadius: 8,
              padding: 8,
              font: 'inherit',
              fontSize: '0.85rem',
              color: 'inherit',
              background: 'var(--panel)',
              resize: 'vertical',
            }}
          />

          {state === 'error' && <div className="gg-warn">{error}</div>}

          <button
            type="button"
            className="gg-termsel"
            style={{ marginTop: 8 }}
            onClick={submit}
            disabled={message.trim().length === 0 || state === 'sending'}
          >
            {state === 'sending' ? 'Sending…' : 'Send'}
          </button>
          <div className="gg-hint">
            You can send this without an account. We include the page you were on.
          </div>
        </>
      )}
    </div>
  );
}
