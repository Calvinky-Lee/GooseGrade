# GooseGrade

Answers one question for a UWaterloo student, accurately and instantly: *given my course's
official grading scheme, what's my grade now, and what do I need on what's left?*

The moat is that grading weights are **pre-loaded from official `outline.uwaterloo.ca` outlines**,
scraped and parsed by Claude. A generic calculator makes you type every weight.

## Layout

```
apps/web/          Next.js app (the only thing Vercel builds)
packages/types/    the specs/03 contract — zero dependencies
packages/engine/   the grade engine — pure, synchronous, zero dependencies
packages/api/      typed data-access layer (mock + live Supabase)
jobs/              ONE container image, three subcommands: scrape · diff · qa
k8s/               indexed Job manifests + Cloud Run instructions
supabase/          migrations, RLS, RPCs
specs/             the specification set (the contract)
docs/superpowers/  design docs
```

`packages/engine` declares no dependencies on purpose: it runs in the browser for instant
recompute, in the API layer for verification, and in the CI QA gate over every catalog course.
Anything it pulls in is pulled into all three.

## Running it locally

Everything runs on in-memory mock data — **no Supabase credentials and no database needed**.

```bash
npm install
npm run dev
```

| URL | What it is |
|---|---|
| `/dashboard` | My Term — credit-weighted term average, cumulative, cross-course "what do I need" |
| `/dashboard/course/course-cs240` | The grade-back loop, rules panel, "show the math" |
| `/dashboard/add` | Paste-your-schedule intake (click *use a sample paste*) |
| `/dashboard/record` | Lifetime record and term rollover |
| `/dashboard/settings` | Profile, dark mode, distributions opt-in, export, delete |
| `/dashboard/onboarding` | Three-step first-run flow |
| `/auth` | Sign in / sign up / reset |
| `/calculator` | Signed-out scratch calculator |
| `/course/CS%20240` | Signed-out course preview with the official weights |
| `/styleguide` | Every token and component, light and dark side by side |

`apps/web/.env.local` is created for you with `NEXT_PUBLIC_API_MODE=mock`. Marks live in memory,
so a reload resets them.

### Things worth trying

- On **CS 240**, type a mark into **Final Exam** and watch the grade and the achievable range move
  as you type.
- Switch any assessment between **Excused** and **Missed**. The same item gives very different
  grades — excused removes its weight from the denominator, missed is a real zero. That
  distinction is why a passing student is never displayed as failing.
- Mark something **Missed**, then use **↳ move weight** to push its weight onto the final. It
  becomes a *rule* tagged `you`, visible in the rules panel with an undo and explained in
  *Show the math* — not an invisible weight edit.
- Untick **Best 4 of 5 quizzes count** and watch the grade change.
- On the dashboard, set **Aim for** to `90`: it reports the target unreachable and gives the
  maximum achievable instead of a required average over 100%.

## Tests

```bash
npm test          # 104 unit tests — engine, invariants, API, term codec
npm run test:e2e  # 6 Playwright smokes, mock mode, no credentials needed
npm run typecheck
```

CI runs typecheck, unit tests, build and the E2E smokes on every PR, plus a separate job that runs
the **same** invariants module over every real catalog course.

## The jobs container

One image, three subcommands. See [`k8s/README.md`](k8s/README.md) for kind, Cloud Run Jobs and
the GKE demo.

```bash
docker compose run --rm jobs scrape --term "Spring 2026" --limit 5 --dry-run
```

The deterministic QA tier runs in CI (`npm run qa:catalog`); only the model-bound adversarial tier
is containerized (`npm run qa:llm`).

## Going live

1. Create dev and prod Supabase projects.
2. Apply `supabase/migrations/` in order (`03` → `07`).
3. Create the private `outlines/` Storage bucket.
4. Set `NEXT_PUBLIC_API_MODE=live` plus `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
5. Run the scraper against a term to populate the catalog.

The migrations rename `courses` → `catalog_courses`. Every page now reads through
`@goosegrade/api`, so nothing queries the old names and applying them is safe.

**Never commit `.env*`.** The browser only ever gets the anon key; RLS does the protecting. The
service-role key exists only in `jobs/`.
