'use client';

/**
 * Applies the user's theme choice to the app shell — specs/06 F0.4.
 *
 * Three states, matching the CSS: an explicit 'dark' or 'light' stamps data-theme so it wins
 * over the OS; absent means follow prefers-color-scheme. The value is read from the profile so
 * it follows the account rather than the device.
 */

import { useEffect, useState } from 'react';

import { api } from '@goosegrade/api';

export function ThemeShell({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getProfile()
      .then((p) => !cancelled && setTheme(p.settings.theme))
      // Signed out, or no profile yet: fall through to the system preference rather than
      // forcing a theme on someone.
      .catch(() => !cancelled && setTheme(null));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="gg-app" {...(theme ? { 'data-theme': theme } : {})}>
      {children}
    </div>
  );
}
