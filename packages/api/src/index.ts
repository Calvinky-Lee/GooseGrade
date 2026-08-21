/**
 * The data-access layer — the ONLY module UI code may import for data.
 *
 *   app/ components/  --imports-->  lib/api  --implemented by-->  Supabase
 *
 * Never import `@supabase/supabase-js` from a component. That rule is what makes
 * `NEXT_PUBLIC_API_MODE=mock` a one-line switch, and it is also the structural guard against
 * the v1 bug where UI code wrote directly to the shared catalog.
 */

import { mockApi } from './__mocks__';
import { liveApi } from './live';
import type { GooseGradeApi } from './types';

export type ApiMode = 'mock' | 'live';

export function getApiMode(): ApiMode {
  return process.env.NEXT_PUBLIC_API_MODE === 'live' ? 'live' : 'mock';
}

export const api: GooseGradeApi = getApiMode() === 'live' ? liveApi : mockApi;

/** Both implementations, for tests that need to exercise one specifically. */
export { mockApi, liveApi };

export { ApiError, API_ERROR_CODES, toApiError, type ApiErrorCode } from './errors';
export { harvestCourseCodes, inferTerm, normalizeCode, termForDate } from './parseSchedule';
export { resetMockState } from './__mocks__';
export type * from './types';
