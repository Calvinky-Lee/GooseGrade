import type React from 'react';

import '../dashboard/tokens.css';

/** Auth screens are data screens, not the landing brand moment — same sans shell. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="gg-app">{children}</div>;
}
