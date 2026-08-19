'use client';

/**
 * /styleguide — specs/06 F0.3 acceptance check.
 *
 * Renders every token and component the app screens use, in both themes side by side, so a
 * contrast or dark-mode regression is visible in one place rather than discovered on a real
 * screen. Not linked from the app; it is a development surface.
 */

import '../dashboard/tokens.css';

import { Num } from '../dashboard/Num';

const SURFACES = ['ground', 'panel', 'warm-wash', 'track'] as const;
const INK = ['ink', 'muted', 'faint'] as const;
const BRAND = ['amber', 'gold', 'orange', 'warm-hover'] as const;
const STATUS = ['good', 'risk'] as const;

export default function StyleguidePage() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: '100vh' }}>
      <Panel theme="light" />
      <Panel theme="dark" />
    </div>
  );
}

function Panel({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <div className="gg-app" data-theme={theme} style={{ minHeight: '100vh' }}>
      <div className="gg-wrap" style={{ paddingBottom: 40 }}>
        <div className="gg-eyebrow">{theme} theme</div>

        <Section title="Numbers">
          <div style={{ display: 'flex', gap: 'var(--s5)', alignItems: 'flex-end' }}>
            <div className="gg-heroval"><Num value={79.9} /></div>
            <div className="gg-grade"><Num value={78.4} /></div>
            <div className="gg-grade gg-empty"><Num value={null} /></div>
          </div>
          <div className="gg-hint">
            The em dash is the not-yet-graded state (amendment A2), never 0.0%.
          </div>
        </Section>

        <Section title="Surfaces">
          <Swatches names={SURFACES} />
        </Section>

        <Section title="Ink">
          {INK.map((n) => (
            <div key={n} style={{ color: `var(--${n})`, fontWeight: 600 }}>
              --{n}: the quick brown fox jumps over the lazy dog
            </div>
          ))}
        </Section>

        <Section title="Brand">
          <Swatches names={BRAND} />
          <div className="gg-bar" style={{ marginTop: 10 }}>
            <i style={{ width: '62%' }} />
          </div>
          <div className="gg-hint">
            Progress bars carry the brand gradient. Status colour is a separate hue on purpose,
            so at-risk never blurs into the amber.
          </div>
        </Section>

        <Section title="Status">
          <Swatches names={STATUS} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <span className="gg-chip good"><span className="d" />On track</span>
            <span className="gg-chip risk"><span className="d" />At risk</span>
            <span className="gg-chip muted">Credit / no-credit</span>
          </div>
        </Section>

        <Section title="Controls">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="gg-termsel" type="button">Secondary</button>
            <span className="gg-field">
              <input defaultValue="82" aria-label="target" />
              <span className="gg-u">%</span>
            </span>
            <input className="gg-input" defaultValue="88" aria-label="mark" style={{ width: 76 }} />
            <select className="gg-select" style={{ width: 120 }} aria-label="status">
              <option>Upcoming</option>
              <option>Graded</option>
            </select>
          </div>
          <button className="gg-btn" type="button" style={{ maxWidth: 220 }}>Primary action</button>
        </Section>

        <Section title="Tags & messages">
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <span className="gg-tag">official</span>
            <span className="gg-tag you">you</span>
          </div>
          <div className="gg-warn">
            Weights sum to 97%, not 100% — 3% is unaccounted for.
          </div>
          <div className="gg-err">GooseGrade is for UWaterloo students.</div>
        </Section>

        <Section title="Card">
          <div className="gg-card" style={{ maxWidth: 340 }}>
            <div className="gg-ctop">
              <div>
                <div className="gg-code">CS 240</div>
                <div className="gg-name">Data Structures &amp; Data Management</div>
              </div>
              <div className="gg-grade"><Num value={78.4} /></div>
            </div>
            <div className="gg-bar"><i style={{ width: '62%' }} /></div>
            <div className="gg-cbottom">
              <span className="gg-chip good"><span className="d" />On track</span>
              <span className="gg-cap">62% graded · need 83% for 80</span>
            </div>
          </div>
        </Section>

        <Section title="Histogram">
          <div className="gg-hist">
            {[2, 5, 9, 11, 5, 2].map((c, i) => (
              <div key={i}>
                <i className={i === 3 ? 'mine' : undefined} style={{ height: `${(c / 11) * 100}%` }} />
                <span>{40 + i * 10}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <div className="gg-seclabel">
        <h2>{title}</h2>
      </div>
      <div className="gg-panel">{children}</div>
    </>
  );
}

function Swatches({ names }: { names: readonly string[] }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {names.map((n) => (
        <div key={n} style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
          <div
            style={{
              width: 68,
              height: 40,
              borderRadius: 8,
              background: `var(--${n})`,
              border: '1px solid var(--line-strong)',
            }}
          />
          --{n}
        </div>
      ))}
    </div>
  );
}
