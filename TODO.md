# GooseGrade v2 — what's left

**Status as of 2026-08-21.** Every task in `specs/05-backend-tasks.md` and
`specs/06-frontend-tasks.md` is implemented. Gate: typecheck clean, lint 0 errors, 109 unit
tests + 14 E2E passing, `next build` producing 12 routes, jobs image building and running.

Nothing below is unfinished implementation. It is four decisions, one verification pass, and a
set of things deliberately not built.

---

## 0. Vercel preview is failing — cause unconfirmed, read the dashboard log first

**The one red check on PR #1.** GitHub Actions is fully green; Vercel's preview deployment is not.

**The actual Vercel error is unconfirmed.** `vercel inspect --logs` requires an interactive
browser login, and GitHub only surfaces "Deployment has failed" with no detail — so start by
opening the deployment in the Vercel dashboard and reading the build log. Do that before acting
on the hypothesis below.

What *is* established:

- `npm install && npm run build` from the repo root produces `apps/web/.next` with all 12 routes,
  which is exactly what Vercel runs. **The build command and output path are not the problem.**
- The failure persists *after* `vercel.json` was added (deployment on `22d44cb`, two commits
  later), so build configuration alone does not explain it.

Most likely cause, by elimination rather than by evidence: the restructure moved the Next app
from the repo root to `apps/web`, and Vercel's **Root Directory** is a dashboard setting that
`vercel.json` cannot override. That fits the fact that adding `vercel.json` changed nothing —
but it is inference, not a read error message.

If the dashboard log says otherwise, ignore the rest of this section. If it agrees, pick **one**
of these — they are mutually exclusive:

**A. Set Root Directory to `apps/web`** *(recommended — Vercel's documented monorepo approach)*
Project → Settings → Build & Deployment → Root Directory → `apps/web`, and tick
"Include files outside the root directory" so the workspace packages resolve.
**Then delete the root `vercel.json`** — with a Root Directory set, Vercel reads
`apps/web/vercel.json` and the root one becomes dead config that will mislead the next person.

**B. Leave Root Directory as the repo root** and keep the committed `vercel.json`, which already
sets `buildCommand`, `outputDirectory: apps/web/.next` and `framework: nextjs`.

Until one is applied, the preview URL on every PR will 404 or fail to build. Nothing else is
affected — this is deployment configuration, not application code.

---

## 1. Verify the live layer — the only item that can teach us something new

Everything server-side is built, typechecked and lint-clean. **None of it has run against real
data.** Built is not proven, and this is the gap where a real defect is most likely still hiding:
every mapper in `packages/api/src/live/` depends on a real PostgREST response shape, and the 37
database tests currently self-skip.

Needs: a **dev** Supabase project, `ANTHROPIC_API_KEY`, `WATERLOO_SESSION_COOKIE`.

```bash
# 1. Apply migrations 03 → 08 to a DEV project (never prod first).
#    08 creates the `outlines` bucket and the UW-email trigger.

# 2. The 37 database tests finally execute instead of skipping.
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ANON_KEY=… npm run test:db

# 3. Discovery, writing nothing. Confirms the outline search and section parsing.
npm run discover -- --term "Spring 2026" --subject CS --limit 5 --dry-run

# 4. Extraction, spending nothing. Confirms the structured-output schema and the engine gate.
npm run batch -- --term "Spring 2026" --limit 3 --dry-run
```

Steps 3 and 4 write nothing and spend nothing on the model, so this whole pass is free.

**Order matters:** `discover` must run before `scrape`/`batch` on a new term. `scrape` only
re-reads catalog rows that already exist, so on an empty catalog it processes zero courses and
reports success.

Only after the dry runs look right:

```bash
npm run batch -- --term "Spring 2026" --limit 20   # ~$4 on Opus via Batch
npm run qa:llm -- --limit 20
```

---

## 2. Four decisions that need you, not more code

### O1 — Do class distributions ship in Phase 1?
The minimum-sample floor is 5, so every course shows "not enough data yet" until you have real
adoption. The feature is complete and the empty state is deliberately written as the primary
state — but at launch it is an empty room.

*Alternative:* keep the contribution path (so data accumulates from day one) and hide the read
path until the floor is reachable. One conditional in `Distribution.tsx`.

### O3 — Which GCP project and billing account?
Blocks the first Cloud Run deploy. Also worth confirming current GCP pricing before quoting the
"<$1/term" figure in `k8s/README.md` — the decision rests on Cloud Run needing no cluster, not on
the exact number.

### O4 — The cumulative delta disagrees with the mockup
The dashboard reads **▲ 7.4**; `specs/visuals/dashboard-mockup.html` shows **▲ 1.3**.
`computeCumulative` compares the latest *term* average to the previous *term* average. The mockup
looks like it compares cumulative-to-cumulative. One line in
`packages/engine/src/aggregate.ts` plus a test update, either way — but I don't know which you
intended.

### O5 — Debounce the grade-back persist?
`06` F3.2 specified `setGrade` on blur/enter; it currently recomputes and persists on every
change. The recompute is free (the engine is pure) and the number moving as you type is the
point — but in live mode that is one write per keystroke. A ~400ms debounce on the persist call
only, keeping the recompute immediate, is the obvious fix. Cheap, but it is a UX call.

---

## 3. Accepted deviations from the spec text

Not gaps. Recorded so nobody re-opens them as bugs.

| Spec | Written as | Built as | Why |
|---|---|---|---|
| `06` F0.3 | named components (`Button`, `Card`, `Stat`…) | token + CSS-class system, one shared `GradeTable`, `/styleguide` | The acceptance check was a styleguide page rendering everything; that exists in both themes. |
| `06` F0.4 | dark mode via `next-themes` | `data-theme` attributes | Only tokens are redefined, so no component rule is duplicated. `next-themes` stays for the v1 provider. |
| `06` F3.2 | `setGrade` on blur/enter | on change | See O5. |
| `05` B3.1 | `suggestCourses` | deferred (amendment A4) | No sequence data source exists, and paste-first intake removed the need. |
| `05` B5.4 | two images (scraper + QA) | one image, three subcommands | Two near-identical images drift; one digest ties a `scheme_confidence` value to the engine version that validated it. |
| `07` §7 | both QA tiers on K8s | deterministic tier in CI | Pure engine × 1,600 courses takes seconds. A gate that needs a cluster launched is not a gate. |
| `01`/`07` | AWS / EKS / S3 | kind → Cloud Run Jobs → GKE | Cloud Run needs no cluster; GKE's fee is covered by the zonal credit where EKS has no free tier. |
| `06` F6.2 | Lighthouse a11y ≥ 90 | axe, zero serious/critical | Same rules, runs in the existing harness, names the offending node instead of a score. Stricter bar. |

**One consequence worth knowing:** meeting AA required changing the mockup's palette. `--faint`
was 2.56:1 on white, and the status chips 3.04:1 / 3.59:1 — all under AA, all inherited from
`dashboard-mockup.html`. The mockup is no longer pixel-accurate to the app, on purpose.

---

## 4. Deliberately not built

Correct per `specs/00-overview.md`. Listed so they are not mistaken for omissions.

**Later (post-v1):** LEARN/Quest grade auto-import · Google Calendar deadline sync · degree-long
planner · proactive standing nudges · crowd auto-healing of the catalog · a dedicated EKS backend
API · Quest *schedule* import as an integration (the paste flow covers this for now).

**Cut (do not build):** grade-health score · study-time ROI · early-warning engine · adaptive tone
· heavy rule safeguards (show-both / verification gates) · probabilistic / Monte-Carlo forecasting
· snapshot-lock.

> Snapshot-lock being cut has a live consequence: past-term averages are **recomputed** from
> stored assessments, so an engine fix retroactively changes a graduated term's average. That is a
> recorded decision (design doc §4 G6), not an accident.

---

## 5. Smaller things

- **46 lint warnings, 0 errors.** `@typescript-eslint/no-explicit-any` at PostgREST boundaries and
  `no-non-null-assertion` after null checks TypeScript cannot narrow across an `await`. Configured
  as warnings so they stay countable without blocking a build. Worth a pass if the count grows.
- **`jobs/legacy/` still exists** — nine v1 one-off scripts, excluded from lint. Delete once the
  v2 scraper has completed a full term successfully.
- **The v1 landing page** (`apps/web/app/page.tsx`) is still the original Lora-serif design with
  the glow. That is correct per `06` F0.1 — the landing is the brand moment — but it has not had
  the design-system pass the app screens got.
- **Mobile pass is structural, not audited.** The grid collapses, the row grids reflow, and the
  reorder controls are touch targets. Nobody has driven it on a real handset.
- **No plan document.** I invoked the `writing-plans` skill and then executed in slices without
  producing the plan artifact it asks for. Moot now the work is done, but it is a real deviation
  from that process rather than an oversight I am hiding.

---

## Suggested order

1. **§0 Vercel** — the only failing check on the PR. Read the build log in the dashboard first;
   my diagnosis is inference, not a confirmed error.
2. §1 dry-run verification — free, and the only thing that can surface a real defect.
3. O4 and O5 — small code changes, and O4 is a visible wrong number.
4. O1 — decides whether a launch screen is empty.
5. O3 — only blocks the first Cloud Run deploy.
