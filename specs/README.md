# GooseGrade v2 — Specification Set

This folder is the single source of truth for the GooseGrade v2 rebuild: turning a
stateless single-course grade calculator into an **account-based, multi-course academic
companion** for UWaterloo students.

These docs are written so that **two Claude Code sessions can work in parallel** — one
backend, one frontend — without colliding. The first three docs are the **contract**:
once they're agreed, each session builds against them independently.

## Read in this order

| # | Doc | Owner | Status |
|---|-----|-------|--------|
| — | `README.md` (this file) | shared | ✅ |
| 02 | [`02-data-model.md`](./02-data-model.md) — Postgres schema + RLS | **contract** | ✅ |
| 03 | [`03-domain-types.md`](./03-domain-types.md) — TS types + grade-engine semantics | **contract** | ✅ |
| 04 | [`04-api-contract.md`](./04-api-contract.md) — typed data-access layer + RPCs | **contract** | ✅ |
| 00 | [`00-overview.md`](./00-overview.md) — vision, scope, phasing | shared | ✅ |
| 01 | [`01-architecture.md`](./01-architecture.md) — system + cloud topology, parallel-session workflow | shared | ✅ |
| 05 | [`05-backend-tasks.md`](./05-backend-tasks.md) — backend session task list | backend | ✅ |
| 06 | [`06-frontend-tasks.md`](./06-frontend-tasks.md) — frontend session task list | frontend | ✅ |
| 07 | [`07-scraper-v2.md`](./07-scraper-v2.md) — productionized scraper + rules extraction (AWS/K8s) | backend | ✅ |

## Locked decisions (do not re-litigate without updating this file)

**Stack & infra**
- App stays on **Vercel (Next.js) + Supabase (Auth + Postgres + Storage + RLS)**.
- The **scraper + multi-agent QA runner** are the only containerized/orchestrated pieces —
  the deliberate **Docker + Kubernetes** learning slice. K8s runs **ephemerally (kind/minikube
  locally) with a short-lived EKS demo**, not a standing cluster (~$0 standing cost).
- **No 24/7 backend API service on K8s.** Server logic lives in Supabase RPCs / Edge Functions.

**Product philosophy**
- Optimize for **durable, multi-term, repeat use** (system of record + reliable "what do I
  need" loop). Reject gimmicks. The cut list in `00-overview.md` is binding.
- Intelligence tone is a **neutral data tool** — numbers and ranges, no coaching/judgment.

**Phase 1 = Core**
- Accounts (Supabase Auth, UW email) → **lifetime academic record**.
- **My Term dashboard**: all courses + live **credit-weighted** term & cumulative average.
- **Grade-back loop** (enter mark → instant recompute) + **term rollover**.
- Cross-course **"what do I need"** + achievable range (floor/ceiling).
- **Grade engine** (pure, tested TS module) with per-course, outline-derived, layered-override,
  visible-and-toggleable rules: weighted sum · best-N-of-M · drop-lowest · max-of/replacement ·
  pass gates · missed-work redistribution · bonus/caps · excused-vs-missed.
- Catalog is a **read-only template**; users **fork an editable copy** (fixes the legacy
  multi-tenant rename bug).
- Intake: **smart manual add + term/level auto-suggest** (Quest import is Later).
- Catalog trust: auto re-scrape + diff; stored source outlines with a **download/source link**
  per course. **Feedback button**.
- **Opt-in class distributions**: give-to-get · show-your-percentile · per-term · **minimum-sample
  privacy floor (hard rule)**.
- Design: formalized design system; **glow effects stay landing-only**.

**Correctness rules (non-negotiable)**
- Term/cumulative average is **credit-weighted**; CR/NCR and non-numeric grades are **excluded**.
- A conditional grading rule must **never turn a genuinely passing grade into a displayed fail**,
  and **one course's rules must never leak into another**. Uncertain rule? Fall back to plain
  weighted sum and keep the rule **advisory/toggleable**. Correctness is enforced by **multi-agent
  per-course QA** after the build, not by intrusive UX safeguards.

**Cut (do not build in v2):** grade-health score, study-time ROI, early-warning engine, adaptive
tone, heavy rule safeguards (show-both / verification gates), probabilistic/Monte-Carlo
forecasting, snapshot-lock.

**Later (post-v1):** LEARN/Quest grade auto-import, Google Calendar deadline sync, degree-long
planner, proactive standing nudges (Dean's list), crowd auto-healing of the catalog, dedicated
EKS backend API.

## How the parallel sessions use these docs

1. Both sessions read 02 / 03 / 04 in full.
2. **Backend session** implements the schema + RLS (02), the RPCs/Edge Functions and the
   data-access layer implementation (04), and the scraper (07). It owns `supabase/` and `lib/api/`.
3. **Frontend session** builds UI against the **typed data-access layer** (04) and shared domain
   types (03), using the documented **mock fixtures** until the backend is live. It owns `app/`,
   `components/`, and the engine consumer code.
4. The **grade engine** (03) is a shared pure module (`lib/engine/`). Assign it to **one** session
   (recommend backend) to avoid double-implementation; the other imports it.
5. Integration checkpoint: when 04's data-access functions return real data instead of mocks.
