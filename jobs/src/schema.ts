/**
 * The structured-output contract for Claude extraction — specs/07 §2.
 *
 * FIX for the bug in specs/07: the original schema declared
 *   rules: { type: "array", items: { type: "object" } }
 * Structured outputs require `additionalProperties: false` on every object and reject an
 * unconstrained one, so that schema would have been rejected outright. Each GradingRule variant
 * is therefore spelled out as an `anyOf` branch with its own `required` list.
 *
 * Zod then re-validates application-side. The JSON schema constrains the SHAPE; Zod is what
 * proves the rules are semantically usable before anything is written to the catalog — a wrong
 * rule is far more dangerous than a missing one.
 */

import { z } from 'zod';

export const CATEGORIES = [
  'Assignment',
  'Quiz',
  'Lab',
  'Midterm',
  'Final Exam',
  'Participation',
  'Project',
  'Other',
] as const;

// ---------------------------------------------------------------------------
// JSON Schema for output_config.format
// ---------------------------------------------------------------------------

const groupSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: CATEGORIES },
    slugs: { type: 'array', items: { type: 'string' } },
  },
  required: [],
} as const;

const targetSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    slug: { type: 'string' },
    category: { type: 'string', enum: CATEGORIES },
  },
  required: [],
} as const;

/** Shared by every branch. `description` is what the student reads in the rules panel. */
const ruleBase = {
  description: { type: 'string' },
} as const;

const RULE_VARIANTS = [
  {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['bestNofM'] },
      ...ruleBase,
      group: groupSchema,
      take: { type: 'integer' },
    },
    required: ['type', 'description', 'group', 'take'],
  },
  {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['dropLowest'] },
      ...ruleBase,
      group: groupSchema,
      drop: { type: 'integer' },
    },
    required: ['type', 'description', 'group', 'drop'],
  },
  {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['maxOf'] },
      ...ruleBase,
      variants: {
        type: 'array',
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { slug: { type: 'string' }, weight: { type: 'number' } },
            required: ['slug', 'weight'],
          },
        },
      },
    },
    required: ['type', 'description', 'variants'],
  },
  {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['passGate'] },
      ...ruleBase,
      target: targetSchema,
      min: { type: 'number' },
      coursePassMark: { type: 'number' },
    },
    required: ['type', 'description', 'target', 'min', 'coursePassMark'],
  },
  {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['redistribute'] },
      ...ruleBase,
      from: targetSchema,
      to: targetSchema,
    },
    required: ['type', 'description', 'from', 'to'],
  },
  {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['bonus'] },
      ...ruleBase,
      slug: { type: 'string' },
    },
    required: ['type', 'description', 'slug'],
  },
  {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['cap'] },
      ...ruleBase,
      capAt: { type: 'number' },
    },
    required: ['type', 'description', 'capAt'],
  },
] as const;

export const GRADING_SCHEME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slug: { type: 'string' },
          name: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES },
          weight: { type: 'number' },
          orderIndex: { type: 'integer' },
        },
        required: ['slug', 'name', 'category', 'weight', 'orderIndex'],
      },
    },
    rules: { type: 'array', items: { anyOf: RULE_VARIANTS } },
    confidence: { type: 'string', enum: ['unconfirmed', 'review', 'verified'] },
    weightsSumTo100: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['assessments', 'rules', 'confidence', 'weightsSumTo100', 'notes'],
} as const;

// ---------------------------------------------------------------------------
// Zod — the semantic gate
// ---------------------------------------------------------------------------

const zGroup = z.object({
  category: z.enum(CATEGORIES).optional(),
  slugs: z.array(z.string()).optional(),
});

const zTarget = z.object({
  slug: z.string().optional(),
  category: z.enum(CATEGORIES).optional(),
});

const zRule = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bestNofM'), description: z.string(), group: zGroup, take: z.number().int().positive() }),
  z.object({ type: z.literal('dropLowest'), description: z.string(), group: zGroup, drop: z.number().int().positive() }),
  z.object({
    type: z.literal('maxOf'),
    description: z.string(),
    variants: z.array(z.array(z.object({ slug: z.string(), weight: z.number().min(0) }))).min(1),
  }),
  z.object({
    type: z.literal('passGate'),
    description: z.string(),
    target: zTarget,
    min: z.number().min(0).max(100),
    coursePassMark: z.number().min(0).max(100),
  }),
  z.object({ type: z.literal('redistribute'), description: z.string(), from: zTarget, to: zTarget }),
  z.object({ type: z.literal('bonus'), description: z.string(), slug: z.string() }),
  z.object({ type: z.literal('cap'), description: z.string(), capAt: z.number().min(0) }),
]);

export const zScheme = z.object({
  assessments: z
    .array(
      z.object({
        slug: z.string().min(1),
        name: z.string().min(1),
        category: z.enum(CATEGORIES),
        weight: z.number().min(0).max(100),
        orderIndex: z.number().int(),
      }),
    )
    .min(1),
  rules: z.array(zRule),
  confidence: z.enum(['unconfirmed', 'review', 'verified']),
  weightsSumTo100: z.boolean(),
  notes: z.string(),
});

export type ExtractedScheme = z.infer<typeof zScheme>;
export type ExtractedRule = z.infer<typeof zRule>;
