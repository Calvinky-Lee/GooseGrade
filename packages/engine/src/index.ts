/**
 * The grade engine — public surface (specs/03 §4).
 *
 * Pure, synchronous, zero dependencies. Imported by the UI (client-side, for instant
 * recompute), by lib/api (for server-side verification), and by the QA runner.
 *
 * Nothing in lib/engine may import React, Supabase, or fetch. The Vitest config pins the
 * `node` environment specifically so that a violation shows up as a test failure.
 */

export { computeCourse } from './computeCourse';
export { computeTermAverage, computeCumulative } from './aggregate';
export { requiredForCourse, requiredAcrossCourses } from './required';
export { groupAssessments } from './groupAssessments';

// The safety contract, shared by Vitest and the deterministic QA tier (design decision D4).
export {
  checkInvariants,
  isClean,
  plainWeightedSum,
  type InvariantKey,
  type Violation,
} from './invariants';

// Fixture builders — used by engine tests and by the QA runner's generated fixtures.
export {
  graded,
  makeAssessment,
  makeCourse,
  makeTerm,
  resetIds,
  rule,
  upcoming,
  withStatus,
} from './testing';
