# 01 — Architecture & Cloud Topology

## System at a glance

```
                         ┌─────────────────────────────────────────────┐
   Browser (student)     │                   VERCEL                      │
   ┌───────────────┐     │   Next.js 16 (App Router, React 19)           │
   │ React UI      │────▶│   ├─ Server Components / Route Handlers       │
   │ lib/engine ◀──┼─────┤   └─ lib/api (typed data-access layer)        │
   └───────┬───────┘     └───────────────────────┬───────────────────────┘
           │  (engine runs client-side, pure)    │
           ▼                                      ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │                              SUPABASE                                  │
   │   Auth (UW email)  ·  Postgres + RLS  ·  Storage (outlines/)          │
   │   RPCs / Edge Functions: fork_catalog_course, get_distribution,       │
   │                          rollover_term, delete_account                │
   └───────────────────────────────▲───────────────────────────────────────┘
                                    │ writes catalog (service role)
   ┌────────────────────────────────┴──────────────────────────────────────┐
   │                        AWS (the learning slice)                         │
   │   Scraper jobs (Docker)  →  outline.uwaterloo.ca  →  Claude extraction  │
   │   Multi-agent QA runner (Docker) on Kubernetes (kind locally / short    │
   │   EKS demo)  →  validates every course's rules  →  flags low-confidence │
   │   Source outlines stored to Supabase Storage / S3                       │
   └─────────────────────────────────────────────────────────────────────────┘
```

## Why this shape (the cloud teaching)

- **You are already in the cloud.** Vercel + Supabase *are* cloud infrastructure (Supabase runs
  on AWS). The goal isn't "move to AWS" — it's to manage the right amount yourself.
- **Managed for the app** (Vercel + Supabase): auth, per-user data, and RLS come essentially free
  and would be huge effort to rebuild on raw AWS.
- **Raw AWS only where it earns its place**: the scraper + QA are genuine **batch/parallel**
  workloads — the textbook case for Docker + Kubernetes, and the résumé payoff. Nothing
  user-facing depends on the cluster, so an outage there never takes the app down.

## Components & ownership

| Component | Tech | Owner session | Notes |
|---|---|---|---|
| UI / pages | Next.js, React, Tailwind | frontend | codes against `lib/api` + `lib/engine` |
| Data-access layer | `lib/api` | backend | Supabase queries/RPCs behind typed fns (`04`) |
| Grade engine | `lib/engine` (pure TS) | backend (shared) | imported by UI + QA runner |
| DB schema + RLS + RPCs | Supabase / SQL migrations | backend | `02` |
| Scraper + QA | Node + Docker + K8s | backend | `07` |
| Design system | Tailwind tokens + components | frontend | `06` |

## Security

- **Keys:** browser uses the Supabase **anon key** only; RLS does the protecting. The
  **service-role key** is used *only* server-side (scraper, Edge Functions, admin) and never
  shipped to the client.
- **RLS everywhere** on user tables (`auth.uid() = user_id`); `shared_grades` has **no client
  SELECT** (RPC-only, min-sample). See `02 §D`.
- **Secrets:** `OPENAI_API_KEY`→ replaced by `ANTHROPIC_API_KEY`, `WATERLOO_SESSION_COOKIE`,
  `SUPABASE_SERVICE_ROLE_KEY` live in env (Vercel project env + GitHub Actions secrets + local
  `.env.local`, already gitignored). **Never** commit `.env*`.
- **UW-email gating** at signup (validation + Auth hook).
- **Privacy:** `delete_account()` + `exportMyData()` satisfy data-deletion/portability.

## Environments & CI/CD

- **Local** → **Vercel Preview** (every PR) → **Vercel Production** (main).
- **Supabase:** a dev project + a prod project; SQL changes flow through
  `supabase/migrations/` (never hand-edited in the dashboard).
- **GitHub Actions** (`.github/workflows/`): on PR → typecheck, lint, **engine unit tests**,
  build. On main → deploy hooks. A separate manual/scheduled workflow runs the scraper + QA
  container.
- **Docker:** one image for the scraper, one for the QA runner; `docker-compose` for local
  parity; K8s manifests in `k8s/` (Jobs, not Deployments — batch workloads).

## Testing strategy (layered)

1. **Engine unit tests** (Vitest/Jest) — every rule type + the safety invariants (`03 §5`). Gate CI.
2. **API integration** — `lib/api` against a seeded Supabase test project.
3. **Per-course QA runner** (`07`) — generates fixtures for **every catalog course**, asserts the
   safety contract, flags violations to `scheme_confidence='review'`. This is the multi-agent,
   containerized step.
4. **E2E smoke** (Playwright, a few flows) — sign in, add course, enter grade, see average.

## Performance & accessibility

- `getCurrentTerm()` returns courses+assessments in one payload → dashboard computes locally, no
  N+1. Indexes per `02`.
- Engine is pure and synchronous → instant recompute (the < 5s grade-back loop).
- **Mobile-first** grade entry; the legacy mouse-only drag-drop gets a keyboard/touch-accessible
  alternative. Target WCAG AA on color contrast (watch the creamy palette) and keyboard nav.

## Cost (real numbers to respect)

- Vercel Hobby + Supabase Free tiers cover early usage (~$0).
- Claude extraction: one-time per course per term; batch ~1,600 courses (see `07` for model +
  per-run estimate).
- **K8s:** run on **kind/minikube locally (~$0)**; a **short-lived EKS** cluster only for the
  résumé demo, then `eksctl delete cluster` (EKS control plane is ~$0.10/hr standing).

## The parallel-session integration plan

1. **Kick-off:** both sessions read `README`, `02`, `03`, `04`. The **contract is frozen**;
   changes to it require updating those docs first.
2. **Branching:** `feat/backend-*` and `feat/frontend-*` branches off `main`. Small PRs.
3. **Decoupling:** frontend runs `NEXT_PUBLIC_API_MODE=mock` against `lib/api/__mocks__` fixtures
   (defined in `04`) — it never waits on the backend.
4. **Engine ownership:** backend writes `lib/engine`; frontend imports it. If frontend needs it
   before it lands, it uses a stub matching the `03` signatures.
5. **Integration checkpoint:** flip `API_MODE=live` once backend ships each `lib/api` function;
   reconcile any contract drift by amending `04` (not by ad-hoc divergence).
6. **Definition of done per slice:** contract function implemented + engine tests green + screen
   renders on live data.
