import type React from 'react';

import './tokens.css';

/**
 * App-shell layout for data screens.
 *
 * The root layout sets Lora serif on <body> for the landing brand moment. specs/06 F0.1 makes
 * data screens sans-only, so .gg-app re-declares the family rather than inheriting it.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className="gg-app">{children}</div>;
}
