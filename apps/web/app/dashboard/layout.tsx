import type React from 'react';

import './tokens.css';
import { ThemeShell } from './ThemeShell';

/**
 * App-shell layout for data screens.
 *
 * The root layout sets Lora serif on <body> for the landing brand moment. specs/06 F0.1 makes
 * data screens sans-only, so .gg-app (applied by ThemeShell) re-declares the family rather than
 * inheriting it.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <ThemeShell>{children}</ThemeShell>;
}
