'use client';

/**
 * Settings & privacy — specs/06 F5.1.
 *
 * Two things here are obligations rather than features: exportMyData and deleteAccount are what
 * satisfy the data-portability and deletion requirements in specs/01 §Security, so neither is
 * buried and neither is fake.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api, type Profile } from '@goosegrade/api';

import { FeedbackButton, TopBar } from '../AppChrome';

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.getProfile().then(setProfile).catch((e) => setError(String(e)));
  }, []);

  const patch = async (update: Parameters<typeof api.updateProfile>[0]) => {
    setError(null);
    try {
      setProfile(await api.updateProfile(update));
      setSaved('Saved.');
      setTimeout(() => setSaved(null), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const exportData = async () => {
    const blob = await api.exportMyData();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'goosegrade-export.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!profile) {
    return (
      <div className="gg-wrap">
        <TopBar />
        <div className="gg-panel" aria-busy="true">
          {error ?? 'Loading…'}
        </div>
      </div>
    );
  }

  return (
    <div className="gg-wrap">
      <TopBar
        right={
          <Link href="/dashboard" className="gg-termsel" style={{ textDecoration: 'none' }}>
            ← My Term
          </Link>
        }
      />

      <div className="gg-seclabel" style={{ marginTop: 0 }}>
        <h2>Profile</h2>
        <span>{profile.email}</span>
      </div>

      <div className="gg-panel" style={{ maxWidth: 460 }}>
        <label className="gg-label" htmlFor="s-name">Display name</label>
        <input
          id="s-name"
          className="gg-textinput"
          defaultValue={profile.displayName ?? ''}
          onBlur={(e) => patch({ displayName: e.target.value || null })}
        />

        <label className="gg-label" htmlFor="s-program">Program</label>
        <input
          id="s-program"
          className="gg-textinput"
          defaultValue={profile.program ?? ''}
          onBlur={(e) => patch({ program: e.target.value || null })}
          placeholder="Computer Science"
        />

        <label className="gg-label" htmlFor="s-level">Level</label>
        <input
          id="s-level"
          className="gg-textinput"
          defaultValue={profile.currentLevel ?? ''}
          onBlur={(e) => patch({ currentLevel: e.target.value || null })}
          placeholder="2B"
        />

        {saved && <div className="gg-hint">{saved}</div>}
        {error && <div className="gg-err">{error}</div>}
      </div>

      <div className="gg-seclabel">
        <h2>Appearance</h2>
        <span>applies immediately</span>
      </div>

      <div className="gg-panel">
        <label className="gg-hint" style={{ display: 'block', margin: 0 }}>
          <input
            type="checkbox"
            checked={profile.settings.theme === 'dark'}
            onChange={(e) =>
              patch({
                settings: { ...profile.settings, theme: e.target.checked ? 'dark' : 'light' },
              })
            }
          />{' '}
          Dark mode
        </label>
      </div>

      {/* Give-to-get — F5.1 / specs/00. Opt-in, and off by default. */}
      <div className="gg-seclabel">
        <h2>Class distributions</h2>
        <span>opt-in</span>
      </div>

      <div className="gg-panel">
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={profile.settings.contributeDistributions}
            onChange={(e) =>
              patch({
                settings: { ...profile.settings, contributeDistributions: e.target.checked },
              })
            }
            style={{ marginTop: 3 }}
          />
          <span>
            Contribute my marks anonymously
            <div className="gg-hint">
              Give-to-get: contributing is what unlocks seeing other people&apos;s distributions.
              Your marks are stored without anything identifying you, and a distribution is only
              ever shown once enough people have contributed that no individual mark can be
              picked out.
            </div>
          </span>
        </label>
      </div>

      <div className="gg-seclabel">
        <h2>Your data</h2>
        <span>portability and deletion</span>
      </div>

      <div className="gg-panel">
        <button type="button" className="gg-termsel" onClick={exportData}>
          Download everything as JSON
        </button>
        <div className="gg-hint">Profile, terms, courses, assessments and marks.</div>

        <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          {!deleting ? (
            <button
              type="button"
              className="gg-link"
              style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--risk)' }}
              onClick={() => setDeleting(true)}
            >
              Delete my account
            </button>
          ) : (
            <div style={{ maxWidth: 420 }}>
              <b>This deletes everything, permanently.</b>
              <div className="gg-hint">
                Every term, course and mark, plus any distribution contributions. It cannot be
                undone and we keep no copy. Type <b>DELETE</b> to confirm.
              </div>
              <input
                className="gg-textinput"
                style={{ marginTop: 8 }}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                aria-label="type DELETE to confirm"
              />
              <button
                type="button"
                className="gg-btn"
                style={{ background: 'var(--risk)', color: '#fff' }}
                disabled={confirmText !== 'DELETE'}
                onClick={() =>
                  api
                    .deleteAccount()
                    .then(() => {
                      window.location.href = '/';
                    })
                    .catch((e) => setError(String(e)))
                }
              >
                Permanently delete my account
              </button>
              <button
                type="button"
                className="gg-link"
                style={{ background: 'none', border: 0, cursor: 'pointer', marginTop: 10 }}
                onClick={() => {
                  setDeleting(false);
                  setConfirmText('');
                }}
              >
                cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <FeedbackButton />
    </div>
  );
}
