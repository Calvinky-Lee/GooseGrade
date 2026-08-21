import * as React from 'react'

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/**
 * Subscribes to the viewport width.
 *
 * Rewritten onto useSyncExternalStore: the previous version called setState synchronously inside
 * an effect to seed the initial value, which double-renders on every mount and is exactly the
 * cascading-render pattern the React lint rules flag. useSyncExternalStore reads the current
 * value during render and subscribes for changes, so there is no seeding write at all.
 */
function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

const getSnapshot = () => window.matchMedia(QUERY).matches

// On the server there is no viewport. Desktop-first is the safe default: it avoids rendering a
// mobile layout that then snaps to desktop on hydration.
const getServerSnapshot = () => false

export function useIsMobile(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
