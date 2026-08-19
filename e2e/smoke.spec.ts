import { expect, test } from '@playwright/test';

/**
 * Four flows, chosen because each one crosses a boundary the unit tests cannot:
 * screen -> lib/api -> engine -> back to screen.
 */

test('dashboard renders the credit-weighted term average', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('.gg-grid')).toBeVisible();

  // The fixtures are pinned to specs/visuals/dashboard-mockup.html, so these are the design's
  // own numbers rather than arbitrary ones.
  await expect(page.locator('.gg-heroval')).toContainText('79.9');
  await expect(page.getByText('PD 11 excluded')).toBeVisible();
});

test('grade-back loop: entering a mark moves the course grade', async ({ page }) => {
  await page.goto('/dashboard/course/course-cs240');
  await expect(page.locator('.gg-heroval')).toContainText('78.4');

  await page.getByLabel('mark for Final Exam').fill('95');
  await expect(page.locator('.gg-heroval')).toContainText('84.4');

  // Clearing the mark returns the item to upcoming rather than scoring it zero.
  await page.getByLabel('mark for Final Exam').fill('');
  await expect(page.locator('.gg-heroval')).toContainText('78.4');
});

test('excused and missed produce different grades from identical marks', async ({ page }) => {
  await page.goto('/dashboard/course/course-cs240');
  const grade = page.locator('.gg-heroval');
  const pct = async () => Number((await grade.innerText()).replace('%', ''));

  const before = await pct();

  // This is the correctness keystone: excused removes weight from the denominator, missed is a
  // real zero. If these ever agree, a student can be shown as failing when they are passing.
  await page.getByLabel('status for Assignment 3').selectOption('missed');
  const missed = await pct();

  await page.getByLabel('status for Assignment 3').selectOption('excused');
  const excused = await pct();

  // Missed must cost several points — it is a zero over the same denominator.
  expect(before - missed).toBeGreaterThan(3);

  // Excused must barely move the number, because the item leaves the denominator entirely.
  // It is NOT expected to land exactly back on `before`: Assignment 3 was graded 79, above the
  // 78.4 average, so removing it correctly nudges the average down a little. Asserting exact
  // equality here would be asserting a bug.
  expect(Math.abs(excused - before)).toBeLessThan(0.5);
  expect(excused).toBeGreaterThan(missed);
});

test('a pass gate is shown beside the average, never instead of it', async ({ page }) => {
  await page.goto('/dashboard/course/course-stat230');

  // STAT 230 carries a pass gate on the final. Both must be present simultaneously.
  await expect(page.locator('.gg-heroval')).toContainText('69.2');
  await expect(page.getByText('Pass requirement')).toBeVisible();
  await expect(page.locator('.gg-chip.risk').first()).toBeVisible();
});

test('paste intake matches courses against the catalog and rejects noise', async ({ page }) => {
  await page.goto('/dashboard/add');
  await page.getByRole('button', { name: 'use a sample paste' }).click();
  await page.getByRole('button', { name: 'Find my courses' }).click();

  await expect(page.getByText('term read from pasted text: Spring 2026')).toBeVisible();
  await expect(page.getByText('CS 240', { exact: true })).toBeVisible();
  // "STAT230" in the paste has no space; the catalog match normalises it.
  await expect(page.getByText('STAT 230', { exact: true })).toBeVisible();

  // Room and component codes match the course-code shape and must not be OFFERED as courses.
  // Scoped to the review rows, because the pasted text itself is still sitting in the textarea
  // — asserting against the whole page would just be reading the paste back.
  const offered = await page.locator('.gg-row .label').allInnerTexts();
  expect(offered).not.toContain('MC 4021');
  expect(offered).not.toContain('LEC 001');
  expect(offered).not.toContain('RCH 101');
  expect(offered).toContain('CS 240');

  // A real course absent from the catalog is offered as custom rather than dropped silently.
  await expect(page.getByText(/Not in the catalog/)).toContainText('MUSIC 140');
});

test('the move-weight gesture writes a rule the student can see and undo', async ({ page }) => {
  await page.goto('/dashboard/course/course-cs240');

  await page.getByLabel('status for Assignment 3').selectOption('missed');
  await page.getByRole('button', { name: '↳ move weight' }).click();
  await page.getByRole('button', { name: 'Final Exam', exact: true }).click();

  // The gesture must produce an inspectable rule, not an invisible weight edit (decision D1).
  await expect(page.getByText('Assignment 3 weight → Final Exam').first()).toBeVisible();
  await expect(page.locator('.gg-tag.you')).toBeVisible();
  await expect(page.getByRole('button', { name: 'undo' })).toBeVisible();
});
