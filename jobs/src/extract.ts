/**
 * Claude extraction — specs/07 §2.
 *
 * Structured outputs, not regex over plaintext. That swap is the single biggest reliability win
 * in the v2 scraper: v1 parsed "Name – Weight percent" lines with a regex, which broke on any
 * phrasing the prompt did not anticipate.
 */

import Anthropic from '@anthropic-ai/sdk';

import { GRADING_SCHEME_SCHEMA, zScheme, type ExtractedScheme } from './schema';

/** Default per specs/07: accuracy is the moat. Overridable for the cheap-tier cascade. */
export const DEFAULT_MODEL = 'claude-opus-5';

export const EXTRACTION_PROMPT = `You extract grading schemes from University of Waterloo course outlines.

Return the assessments AND any conditional grading rules, as structured output.

ASSESSMENTS
1. Extract every individual assessment item. Look for tables, lists, or prose under headings
   like "Evaluation", "Grading", "Marking Scheme", "Assessment".
2. Expand ranges. "Quizzes 1-5" becomes five items: Quiz 1 … Quiz 5.
3. Shared weights: if a category has a total (e.g. "Weekly work 35%") covering multiple items,
   divide by the TOTAL number of items in that category and keep at least 4 decimal places.
   Never assign the category total to each item — that produces impossible totals.
4. Weights must sum to 100. If they do not, look harder for a final exam or participation
   component before giving up.
5. slug: lowercase, hyphenated, stable, unique within the course — "assignment-1", "final-exam".
   The slug is a durable key, so base it on the item's identity, not its position.
6. orderIndex: the order the items appear in the outline, starting at 1.

RULES — this is the part that matters most
Detect conditional grading and emit it as a rule object rather than baking it into weights:
  - "best 10 of 12 quizzes"                  -> bestNofM  { group, take }
  - "your lowest 2 assignments are dropped"  -> dropLowest { group, drop }
  - "the final counts 40%, or 60% if higher" -> maxOf     { variants }
  - "must score 50% on the final to pass"    -> passGate  { target, min, coursePassMark }
  - "a missed midterm's weight moves to the final" -> redistribute { from, to }
  - bonus marks on top                       -> bonus     { slug }
  - an explicit maximum grade                -> cap       { capAt }

Every rule needs a "description" field, written for a student to read, in plain language.

WHEN UNSURE — this is binding
Prefer emitting NO rule over a rule you are not confident about. A missed rule falls back to a
plain weighted sum, which is safe. A wrong rule silently changes someone's grade, which is not.
Set confidence to "review" and explain in notes whenever:
  - weights do not sum to 100
  - the scheme's wording is ambiguous
  - you inferred a rule rather than reading it explicitly
  - the outline describes something the rule types above cannot express
Use "verified" only when the scheme is stated unambiguously and the weights sum to 100.

Outline follows.`;

export interface ExtractionResult {
  scheme: ExtractedScheme;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/** Outlines can be very long; cap the slice we send so one pathological page cannot blow up cost. */
const MAX_OUTLINE_CHARS = 100_000;

export async function extractScheme(
  outlineText: string,
  opts: { model?: string; client?: Anthropic } = {},
): Promise<ExtractionResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const client = opts.client ?? new Anthropic();

  const message = await client.messages.create({
    model,
    max_tokens: 16_000,
    // Explicit rather than relying on a per-model default: on Opus 4.8 omitting this meant no
    // thinking at all, while on Opus 5 adaptive is the default. Naming it makes the request
    // behave the same whichever model the cascade selects.
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: GRADING_SCHEME_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `${EXTRACTION_PROMPT}\n\n----------------\n${outlineText.slice(
          0,
          MAX_OUTLINE_CHARS,
        )}\n----------------`,
      },
    ],
  });

  // Structured output guarantees the first text block is valid JSON matching the schema, but
  // content is still a union — a thinking block precedes it, so filter by type rather than
  // indexing content[0].
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  if (!text) {
    throw new Error(`Extraction returned no text block (stop_reason: ${message.stop_reason}).`);
  }

  // Zod re-validates application-side: the JSON schema constrains shape, Zod proves the rules
  // are semantically usable. specs/07 calls for exactly this belt-and-braces.
  const parsed = zScheme.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`Extraction failed Zod validation: ${parsed.error.message}`);
  }

  return {
    scheme: parsed.data,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    model,
  };
}

/**
 * Deterministic escalation for the tiered cascade — specs/07 §6 as amended.
 *
 * NEVER keyed on the model's self-reported confidence. A cheap model that confidently
 * mis-parses "best 10 of 12" is precisely the failure the correctness rule forbids, so the
 * trigger is observable facts about the outline and the extraction.
 */
const CONDITIONAL_LANGUAGE =
  /\bbest\b|higher of|\breplace[sd]?\b|must (?:pass|achieve|obtain|score)|at least \d+\s*%|\bdrop(?:ped|s)? (?:the )?lowest\b|\bbonus\b/i;

export function needsEscalation(
  outlineText: string,
  scheme: ExtractedScheme,
): { escalate: boolean; reasons: string[] } {
  const reasons: string[] = [];

  const total = scheme.assessments.reduce((sum, a) => sum + a.weight, 0);
  if (Math.abs(total - 100) > 0.01) {
    reasons.push(`weights sum to ${total.toFixed(4)}`);
  }
  if (CONDITIONAL_LANGUAGE.test(outlineText)) {
    reasons.push('outline contains conditional-rule language');
  }
  if (scheme.rules.length > 0) {
    reasons.push('a rule was emitted');
  }

  return { escalate: reasons.length > 0, reasons };
}
