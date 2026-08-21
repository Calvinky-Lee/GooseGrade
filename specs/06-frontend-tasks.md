# 06 — Frontend Session Task List

**You own:** `apps/web/`, the design system, and all UI that consumes `@goosegrade/api` (`04`)
and `@goosegrade/engine` (`03`).

**You depend on:** the frozen contract (`02/03/04`). **You do not wait on the backend** — build
against `NEXT_PUBLIC_API_MODE=mock` using the fixtures in `packages/api/src/__mocks__` (defined
in `04`). Flip to `live` per function as the backend ships it.

> The engine runs **client-side**. Import `computeCourse`, `computeTermAverage`,
> `requiredForCourse`, `requiredAcrossCourses`, `groupAssessments` from `@goosegrade/engine`.

> **Status (2026-08-19): every milestone below is implemented.** Deviations from the task text
> are annotated inline. Paths moved in the workspace restructure: `app/` and `components/` are
> now under `apps/web/`, and `lib/{engine,api,types}` are the `@goosegrade/*` packages.

## Milestone F0 — Design system (do first; everything else uses it)

> **Reference mockup:** `specs/visuals/dashboard-mockup.html` is the canonical look for data
> screens. `specs/visuals/architecture.html` shows the modern type at document scale.

- [x] **F0.1** Extract tokens into Tailwind config + CSS vars. **Two-tier type system:**
  - **Landing / marketing** — keep the branded **Lora serif + the rose/amber/orange glow** (the
    3 illuminating orbs). This is the brand moment.
  - **App / data screens** (dashboard, course, calculator) — **modern sans only, no serif, no
    monospace.** One sans family for text *and* numbers so figures read integrated, not as
    separate blocks: `font-variant-numeric: tabular-nums`, tight negative tracking on large values
    (~`-.045em`), and the `%`/unit glyph scaled ~0.4–0.5× and pulled in tight (it is part of the
    number, not a floating symbol).
- [x] **F0.2** Restrained brand warmth + glow on data screens:
  - **Brand color is present but calm** — progress bars use the amber→gold gradient (the
    signature), with smaller warm touches (the goose mark, the target field on focus, warm
    card-hover). Keep it from going hue-heavy: near-white panel washes, soft warm borders.
  - **Very slight illumination only** — a single faint, contained warm bloom (low alpha, pushed
    off-corner) on a summary panel is allowed; the full landing glow stays landing-only.
  - **Status color is separate from the brand hue** — good = green, at-risk = red (not amber, so
    it never blurs into the yellow bars).
  - **One spacing scale** reused everywhere (e.g. 6/10/16/22/34) for consistent rhythm.
  - **Declutter** — a course card is code + name, the grade, one progress bar, one status chip,
    one actionable caption; range/rules/target detail live on the course-detail page.
- [x] **F0.3** *(Implemented as a token + CSS-class system plus one shared `GradeTable`, rather
  than a named component per primitive. `/styleguide` renders every token and control in both
  themes side by side, which is the acceptance check the task asked for.)*
  Base components: `Button`, `Card`, `Input`, `Select`, `Stat`, `Histogram`
  (recharts), `Toggle`, `EmptyState`, `Toast`. Reuse the existing shadcn/ui primitives already
  in `components/ui/`. ✓ a `/styleguide` page renders them.
- [x] **F0.4** *(Implemented with `data-theme` attributes rather than `next-themes`: only the
  tokens are redefined, so no component rule is duplicated. Three states, because "system" stamps
  nothing on the root.)* Dark mode. ✓ AA contrast in both themes.
  - **AA required changing the mockup's palette.** `--faint` was 2.56:1 on white and the status
    chips 3.04:1 / 3.59:1 — all under AA, all inherited from
    `specs/visuals/dashboard-mockup.html`. Verified by `e2e/a11y.spec.ts`, not assumed.

## Milestone F1 — Auth & onboarding
- [x] **F1.1** Sign up / sign in / reset pages → `signUp`/`signIn`/`sendPasswordReset`. Inline UW
  -email error (`auth/invalid-email`).
- [x] **F1.2** Onboarding: capture program + level (`updateProfile`), create first term
  (`createTerm`), then **paste-your-schedule intake** (`matchPastedSchedule` → review step →
  `addCourseFromCatalog`/`addCustomCourse`). Search is visible on the same screen as a
  fallback. ✓ new user reaches a populated dashboard in < 2 min. (Amendment A2b; `suggestCourses`
  is deferred post-v1.)

## Milestone F2 — My Term dashboard (the centerpiece)
- [x] **F2.1** `getCurrentTerm()` → render all courses as cards; per card show `computeCourse`
  current grade + achievable range + pass-gate status.
- [x] **F2.2** Header stat: **credit-weighted term average** + projected, via `computeTermAverage`.
  Show which courses are excluded (CR/NCR).
- [x] **F2.3** Cross-course **"what do I need"**: input a target term average → `requiredAcrossCourses`
  → per-course required averages + feasibility (neutral wording, no coaching).
- [x] **F2.4** Add-course flow: paste (`matchPastedSchedule`) / search (`searchCatalog`) →
  `addCourseFromCatalog`; custom via `addCustomCourse`. Handle `course/already-added`. ✓ adding a
  course updates the dashboard + term average live.

## Milestone F3 — Course detail & the grade-back loop
- [x] **F3.1** Rebuild the course page on the new model. Port grouping/remove from the legacy
  page **but using the shared engine + `@goosegrade/api`** (no duplicated calc logic, no writes
  to the shared catalog).
  - **Amendment A-D1: the weight-transfer gesture writes a rule, not a weight.** The legacy
    mouse-only "drop mode" (`dropMode`/`droppedMap`/`weightAdjustments`) is replaced by a
    **menu** on each assessment — "move weight" → pick a destination — which appends a
    `RedistributeRule` with `source: 'user'` to `gradingRules` and sets `rules_overridden`.
    It therefore appears in the rules panel (F3.3), in `appliedRules` / "show the math"
    (F3.4), is individually toggleable, survives refresh and rollover, and is reversed by
    "reset to official". A menu also satisfies F6.1's keyboard/touch requirement without a
    separate DnD path — **do not port the drag-and-drop.**
- [x] **F3.2** *(Recomputes on CHANGE rather than blur/enter — the engine is pure so it is free,
  and the number moving as you type is the whole point. Worth debouncing the persist call in live
  mode.)* Grade-back loop: `setGrade` → recompute via engine instantly (< 5s
  feel). Status control: graded / upcoming / **excused** / **missed**.
- [x] **F3.3** Rules UI: list applied rules with descriptions; **toggle any rule on/off** (updates
  `gradingRules`, sets `rules_overridden`); "Reset to official" → `resetCourseToCatalog`.
- [x] **F3.4** "Show the math": expand to the weight-by-weight derivation from
  `CourseResult.appliedRules` + warnings.
- [x] **F3.5** Source outline: download/source link via `getOutlineSource`. ✓ target calculator
  + required-grade panel work end to end.

## Milestone F4 — Term lifecycle & record
- [x] **F4.1** Past terms list (`listTerms`); lifetime academic record view.
- [x] **F4.2** Term rollover UI (`rolloverTerm`, `setCurrentTerm`). ✓ a user can archive a term
  and start the next in seconds.

## Milestone F5 — Trust & community
- [x] **F5.1** Settings: profile, theme, **opt-in to distributions** (`updateProfile.settings`),
  `exportMyData`, `deleteAccount` (with confirm).
- [x] **F5.2** Distributions panel on course **and** assessment, via a scope picker:
  `getCourse/AssessmentDistribution` →
  histogram + your percentile; empty state for `distribution/below-threshold` and
  `not-opted-in` (prompt give-to-get → `contributeGrades`).
- [x] **F5.3** Global **Feedback button** → `submitFeedback` (category + message + page URL).

## Milestone F6 — Polish
- [x] **F6.1** Mobile-first pass; touch/keyboard-accessible reordering (replace mouse-only DnD).
  - Arrow buttons, not a drag surface: keyboard- and touch-reachable by construction rather than
    needing a parallel accessible path. `orderIndex` is rewritten across the whole visible list so
    gaps from soft-removed items cannot collide two rows on one index.
- [x] **F6.2** Loading/skeleton/empty/error states everywhere (neutral copy).
  - **Measured with axe, not Lighthouse** (`e2e/a11y.spec.ts`): same rules, runs in the existing
    Playwright harness, and names the offending node instead of a score. The bar asserted is zero
    serious/critical violations across seven screens plus dark mode — stricter than "≥ 90".
    Seven of eight screens failed on the first run; see F0.4 for what had to change.

## Guardrails
- Never call the Supabase client from a component — only `@goosegrade/api`. (Enforced by lint
  for the engine packages; still a convention for `apps/web`.)
- Never write user edits to catalog tables (the legacy rename bug).
- Keep glow off calculation/data screens. Match the canonical aesthetic everywhere else.
- Any contract gap ⇒ update `04` (don't diverge silently).
