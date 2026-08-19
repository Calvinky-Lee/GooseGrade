/**
 * The shared error vocabulary — specs/04 §7.
 *
 * Every lib/api function throws ApiError with one of these codes. The UI switches on `code`,
 * never on `message`, so copy can change without breaking behaviour.
 */

export const API_ERROR_CODES = {
  invalidEmail: 'auth/invalid-email',
  unauthorized: 'auth/unauthorized',
  alreadyAdded: 'course/already-added',
  belowThreshold: 'distribution/below-threshold',
  notOptedIn: 'distribution/not-opted-in',
  notFound: 'validation/not-found',
  invalidInput: 'validation/invalid-input',
  unknown: 'server/unknown',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode | string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Map a Postgres/Supabase error onto the shared vocabulary.
 *
 * The RPCs in 06_rpcs_triggers.sql raise the code strings directly (`course/already-added`),
 * so a matching message is passed through rather than flattened to server/unknown.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);

  const known = Object.values(API_ERROR_CODES).find((code) => message.includes(code));
  if (known) return new ApiError(known, message);

  // Postgres unique violation — the database-level guard behind course/already-added.
  if (message.includes('23505') || /duplicate key/i.test(message)) {
    return new ApiError(API_ERROR_CODES.alreadyAdded, 'That course is already in this term.');
  }

  if (/row-level security|permission denied/i.test(message)) {
    return new ApiError(API_ERROR_CODES.unauthorized, 'You are not signed in.');
  }

  return new ApiError(API_ERROR_CODES.unknown, message);
}
