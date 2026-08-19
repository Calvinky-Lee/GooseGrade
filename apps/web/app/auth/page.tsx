'use client';

/**
 * Sign in / sign up / reset — specs/06 F1.1.
 *
 * One screen with three modes rather than three routes: the fields are nearly identical and a
 * student who lands on the wrong one should not have to navigate.
 *
 * UW-email gating produces an inline error (auth/invalid-email). It is enforced again server
 * side — this is for the message, not the control.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api, API_ERROR_CODES, ApiError } from '@goosegrade/api';

type Mode = 'signin' | 'signup' | 'reset';

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') {
        await api.signIn(email, password);
        router.push('/dashboard');
      } else if (mode === 'signup') {
        await api.signUp(email, password);
        router.push('/dashboard/onboarding');
      } else {
        await api.sendPasswordReset(email);
        setSent(true);
      }
    } catch (err) {
      // Switch on the code, never the message — specs/04 §7.
      if (err instanceof ApiError && err.code === API_ERROR_CODES.invalidEmail) {
        setError('GooseGrade is for UWaterloo students — use your @uwaterloo.ca address.');
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gg-wrap">
      <header className="gg-topbar">
        <Link href="/" className="gg-brand">
          <span className="gg-goose" aria-hidden="true" />
          <b>GooseGrade</b>
        </Link>
      </header>

      <div className="gg-form">
        <div className="gg-eyebrow">
          {mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Create an account' : 'Reset password'}
        </div>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 680, letterSpacing: '-0.03em', margin: '6px 0 0' }}>
          {mode === 'signup' ? 'Track your whole degree' : 'Sign in to GooseGrade'}
        </h1>
        <p className="gg-hint">
          {mode === 'signup'
            ? 'Your marks, weights and term average, kept across every term.'
            : 'Your terms and marks are waiting.'}
        </p>

        {sent ? (
          <div className="gg-panel" style={{ marginTop: 16 }}>
            <b>Check your email</b>
            <div className="gg-hint">We sent a reset link to {email}.</div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label className="gg-label" htmlFor="auth-email">UWaterloo email</label>
            <input
              id="auth-email"
              className="gg-textinput"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@uwaterloo.ca"
              required
            />

            {mode !== 'reset' && (
              <>
                <label className="gg-label" htmlFor="auth-password">Password</label>
                <input
                  id="auth-password"
                  className="gg-textinput"
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </>
            )}

            {error && <div className="gg-err">{error}</div>}

            <button className="gg-btn" type="submit" disabled={busy}>
              {busy
                ? 'Working…'
                : mode === 'signin'
                  ? 'Sign in'
                  : mode === 'signup'
                    ? 'Create account'
                    : 'Send reset link'}
            </button>
          </form>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {mode !== 'signin' && (
            <button type="button" className="gg-link" style={linkBtn} onClick={() => { setMode('signin'); setSent(false); setError(null); }}>
              sign in instead
            </button>
          )}
          {mode !== 'signup' && (
            <button type="button" className="gg-link" style={linkBtn} onClick={() => { setMode('signup'); setSent(false); setError(null); }}>
              create an account
            </button>
          )}
          {mode !== 'reset' && (
            <button type="button" className="gg-link" style={linkBtn} onClick={() => { setMode('reset'); setError(null); }}>
              forgot password
            </button>
          )}
        </div>

        <p className="gg-hint" style={{ marginTop: 24 }}>
          You can use the <Link href="/calculator" className="gg-link">calculator</Link> without
          an account.
        </p>
      </div>
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 0,
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
};
