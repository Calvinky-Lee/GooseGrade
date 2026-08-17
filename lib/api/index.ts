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
import type { GooseGradeApi } from './types';

export type ApiMode = 'mock' | 'live';

export function getApiMode(): ApiMode {
  return process.env.NEXT_PUBLIC_API_MODE === 'live' ? 'live' : 'mock';
}

/**
 * The live implementation is added function-by-function as the backend session ships it
 * (specs/01 §"parallel-session integration plan", step 5). Until then `live` mode throws a
 * clear error naming the missing function rather than returning undefined and failing three
 * layers up in a component.
 */
const liveApi: GooseGradeApi = new Proxy({} as GooseGradeApi, {
  get(_target, prop) {
    return () => {
      throw new Error(
        `lib/api.${String(prop)}() has no live implementation yet. ` +
          `Set NEXT_PUBLIC_API_MODE=mock, or implement it in lib/api/live/.`,
      );
    };
  },
});

export const api: GooseGradeApi = getApiMode() === 'live' ? liveApi : mockApi;

export { ApiError, API_ERROR_CODES, toApiError, type ApiErrorCode } from './errors';
export { harvestCourseCodes, inferTerm, normalizeCode, termForDate } from './parseSchedule';
export { resetMockState } from './__mocks__';
export type * from './types';
