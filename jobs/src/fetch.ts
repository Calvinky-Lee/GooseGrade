/**
 * Outline fetching — specs/07 §3, §5, plus the two guards from the design doc.
 */

import { createHash } from 'node:crypto';

import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

/**
 * Rate limit with jitter. `outline.uwaterloo.ca` is a university server behind a session
 * cookie: hammering it is both rude and a reliable way to get the cookie invalidated
 * mid-run, which is why parallelism is 4 rather than 32 (specs/07 §5).
 */
export async function politeDelay(baseMs = 900): Promise<void> {
  // Jitter so N pods do not fall into lockstep and arrive as a burst every baseMs.
  const jitter = Math.floor(baseMs * 0.4 * (Math.random() - 0.5) * 2);
  await new Promise((r) => setTimeout(r, Math.max(250, baseMs + jitter)));
}

export class CookieExpiredError extends Error {
  constructor() {
    super(
      'WATERLOO_SESSION_COOKIE appears expired — the fetched page looks like a login screen. ' +
        'Aborting before any of this reaches the model.',
    );
    this.name = 'CookieExpiredError';
  }
}

const LOGIN_MARKERS = [
  'sign in',
  'log in to continue',
  'authentication required',
  'adfs',
  'saml',
  'duo security',
];

/**
 * Cookie-expiry fail-fast.
 *
 * Without this, an expired cookie means 1,600 login pages get fed to Opus at ~$0.19 each — a
 * silent several-hundred-dollar run that extracts nothing. Cheap check, large saving.
 */
export function assertLooksLikeOutline(text: string, url: string): void {
  const head = text.slice(0, 4000).toLowerCase();
  const looksLikeLogin = LOGIN_MARKERS.some((m) => head.includes(m));
  const hasOutlineSignal =
    /evaluation|grading|marking scheme|assessment|course outline/i.test(text);

  if (looksLikeLogin && !hasOutlineSignal) throw new CookieExpiredError();

  if (!hasOutlineSignal) {
    throw new Error(`Fetched page has no grading section: ${url}`);
  }
}

export interface FetchedOutline {
  url: string;
  /** Cleaned text, which is what gets hashed, stored, and extracted from. */
  text: string;
  sourceHash: string;
}

/** Strip chrome so the hash tracks the SCHEME, not a nav tweak or a build id. */
export function cleanOutlineHtml(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, noscript, svg').remove();
  return $('body')
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function hashOutline(cleanText: string): string {
  return createHash('sha256').update(cleanText).digest('hex');
}

export async function fetchOutline(url: string): Promise<FetchedOutline> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'GooseGrade/2.0 (course outline indexer; contact via github.com/Calvinky-Lee)',
      Accept: 'text/html,application/xhtml+xml',
      Cookie: process.env.WATERLOO_SESSION_COOKIE ?? '',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}`);
  }

  const html = await response.text();
  const text = cleanOutlineHtml(html);
  assertLooksLikeOutline(text, url);

  return { url: response.url, text, sourceHash: hashOutline(text) };
}
