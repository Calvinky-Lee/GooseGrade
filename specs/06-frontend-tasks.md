# 06 — Frontend Session Task List

**You own:** `app/`, `components/`, the design system, and all UI that consumes `lib/api` (`04`)
and `lib/engine` (`03`).
**You depend on:** the frozen contract (`02/03/04`). **You do not wait on the backend** — build
against `NEXT_PUBLIC_API_MODE=mock` using the fixtures in `lib/api/__mocks__` (defined in `04`).
Flip to `live` per function as the backend ships it.

> The engine runs **client-side**. Import `computeCourse`, `computeTermAverage`,
> `requiredForCourse`, `requiredAcrossCourses`, `groupAssessments` from `lib/engine`. If the
> engine isn't ready, stub to the `03` signatures.

## Milestone F0 — Design system (do first; everything else uses it)

> **Reference mockup:** `specs/visuals/dashboard-mockup.html` is the canonical look for data
> screens. `specs/visuals/architecture.html` shows the modern type at document scale.

- [ ] **F0.1** Extract tokens into Tailwind config + CSS vars. **Two-tier type system:**
  - **Landing / marketing** — keep the branded **Lora serif + the rose/amber/orange glow** (the
    3 illuminating orbs). This is the brand moment.
  - **App / data screens** (dashboard, course, calculator) — **modern sans only, no serif, no
    monospace.** One sans family for text *and* numbers so figures read integrated, not as
    separate blocks: `font-variant-numeric: tabular-nums`, tight negative tracking on large values
    (~`-.045em`), and the `%`/unit glyph scaled ~0.4–0.5× and pulled in tight (it is part of the
    number, not a floating symbol).
- [ ] **F0.2** Restrained brand warmth + glow on data screens:
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
- [ ] **F0.3** Base components: `Button`, `Card`, `Input`, `Select`, `Stat`, `Histogram`
  (recharts), `Toggle`, `EmptyState`, `Toast`. Reuse the existing shadcn/ui primitives already
  in `components/ui/`. ✓ a `/styleguide` page renders them.
- [ ] **F0.4** Dark mode via `next-themes` (already installed). ✓ AA contrast in both themes.

## Milestone F1 — Auth & onboarding
- [ ] **F1.1** Sign up / sign in / reset pages → `signUp`/`signIn`/`sendPasswordReset`. Inline UW
  -email error (`auth/invalid-email`).
- [ ] **F1.2** Onboarding: capture program + level (`updateProfile`), create first term
  (`createTerm`), then suggest courses (`suggestCourses`). ✓ new user reaches an empty dashboard.

## Milestone F2 — My Term dashboard (the centerpiece)
- [ ] **F2.1** `getCurrentTerm()` → render all courses as cards; per card show `computeCourse`
  current grade + achievable range + pass-gate status.
- [ ] **F2.2** Header stat: **credit-weighted term average** + projected, via `computeTermAverage`.
  Show which courses are excluded (CR/NCR).
- [ ] **F2.3** Cross-course **"what do I need"**: input a target term average → `requiredAcrossCourses`
  → per-course required averages + feasibility (neutral wording, no coaching).
- [ ] **F2.4** Add-course flow: search (`searchCatalog`) / suggest (`suggestCourses`) →
  `addCourseFromCatalog`; custom via `addCustomCourse`. Handle `course/already-added`. ✓ adding a
  course updates the dashboard + term average live.

## Milestone F3 — Course detail & the grade-back loop
- [ ] **F3.1** Rebuild the course page on the new model. Port grouping/drag/drop/transfer/remove
  from the legacy page **but using the shared engine + `lib/api`** (no duplicated calc logic, no
  writes to the shared catalog).
- [ ] **F3.2** Grade-back loop: `setGrade` on blur/enter → recompute via engine instantly (< 5s
  feel). Status control: graded / upcoming / **excused** / **missed**.
- [ ] **F3.3** Rules UI: list applied rules with descriptions; **toggle any rule on/off** (updates
  `gradingRules`, sets `rules_overridden`); "Reset to official" → `resetCourseToCatalog`.
- [ ] **F3.4** "Show the math": expand to the weight-by-weight derivation from
  `CourseResult.appliedRules` + warnings.
- [ ] **F3.5** Source outline: download/source link via `getOutlineSource`. ✓ target calculator
  + required-grade panel work end to end.

## Milestone F4 — Term lifecycle & record
- [ ] **F4.1** Past terms list (`listTerms`); lifetime academic record view.
- [ ] **F4.2** Term rollover UI (`rolloverTerm`, `setCurrentTerm`). ✓ a user can archive a term
  and start the next in seconds.

## Milestone F5 — Trust & community
- [ ] **F5.1** Settings: profile, theme, **opt-in to distributions** (`updateProfile.settings`),
  `exportMyData`, `deleteAccount` (with confirm).
- [ ] **F5.2** Distributions panel on course/assessment: `getCourse/AssessmentDistribution` →
  histogram + your percentile; empty state for `distribution/below-threshold` and
  `not-opted-in` (prompt give-to-get → `contributeGrades`).
- [ ] **F5.3** Global **Feedback button** → `submitFeedback` (category + message + page URL).

## Milestone F6 — Polish
- [ ] **F6.1** Mobile-first pass; touch/keyboard-accessible reordering (replace mouse-only DnD).
- [ ] **F6.2** Loading/skeleton/empty/error states everywhere (neutral copy). ✓ Lighthouse a11y ≥ 90.

## Guardrails
- Never call the Supabase client from a component — only `lib/api`.
- Never write user edits to catalog tables (the legacy rename bug).
- Keep glow off calculation/data screens. Match the canonical aesthetic everywhere else.
- Any contract gap ⇒ update `04` (don't diverge silently).
