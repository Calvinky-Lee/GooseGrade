import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Accessibility — specs/06 F6.2 ("Lighthouse a11y ≥ 90") and F0.4 ("AA contrast in both themes").
 *
 * axe rather than Lighthouse: the rules that matter here (contrast, labels, roles, landmarks) are
 * the same, axe runs in the existing Playwright harness with no extra service, and it reports the
 * specific node at fault instead of a score. A score cannot be acted on; a node can.
 *
 * The assertion is zero serious/critical violations, which is a stricter bar than 90.
 */

const SCREENS = [
  ['/dashboard', '.gg-grid'],
  ['/dashboard/course/course-cs240', '.gg-heroval'],
  ['/dashboard/add', '.gg-panel'],
  ['/dashboard/record', '.gg-hero'],
  ['/dashboard/settings', '.gg-panel'],
  ['/auth', '.gg-form'],
  ['/calculator', '.gg-heroval'],
] as const;

for (const [route, ready] of SCREENS) {
  test(`a11y: ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForSelector(ready);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );

    // Print the offending node, not just a count — a failure should say what to fix.
    if (blocking.length > 0) {
      console.error(
        blocking
          .map(
            (v) =>
              `${v.id} (${v.impact}): ${v.help}\n    ` +
              v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n    '),
          )
          .join('\n'),
      );
    }

    expect(blocking.map((v) => v.id)).toEqual([]);
  });
}

/**
 * Dark mode gets its own pass. Contrast is the failure mode most likely to differ between
 * themes, and F0.4's acceptance criterion is AA in BOTH — so testing only the default would
 * leave half the requirement unverified.
 */
test('a11y: dark mode contrast', async ({ page }) => {
  await page.goto('/styleguide');
  await page.waitForSelector('.gg-app[data-theme="dark"]');

  const results = await new AxeBuilder({ page })
    .include('.gg-app[data-theme="dark"]')
    .withTags(['wcag2aa', 'wcag21aa'])
    .analyze();

  const contrast = results.violations.filter((v) => v.id === 'color-contrast');

  if (contrast.length > 0) {
    console.error(
      contrast
        .flatMap((v) => v.nodes.map((n) => `${n.target.join(' ')} — ${n.failureSummary}`))
        .slice(0, 8)
        .join('\n'),
    );
  }

  expect(contrast).toEqual([]);
});
