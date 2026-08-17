# GooseGrade v2 — Implementation Design

**Date:** 2026-08-17
**Status:** design, pending review
**Relationship to `specs/`:** this document does not replace the spec set. It records the
decisions made during design that `specs/` left open, proposes amendments where `specs/`
is wrong or incomplete, and defines the functional model the UI is built against.

Amendments proposed here to the frozen contract (`02`, `03`, `04`) and to `01`/`07` must
be applied to those documents before implementation begins — that is the specs' own rule.

---

## 1. Decisions made in design

| # | Decision | Supersedes |
|---|---|---|
| D1 | Weight-movement gestures **write rules**, not weights | open question in `06` F3.1/F6.1 |
| D2 | Intake is **paste-your-schedule first**, with search as an always-visible fallback | `04 §8` listed three mechanisms, ranked none |
| D3 | Containerized jobs run **kind (dev) → Cloud Run Jobs (prod) → GKE Autopilot (demo)** | `01`/`07` name AWS/EKS/S3 |
| D4 | Deterministic QA runs in **CI**, not Kubernetes; only LLM-bound QA is containerized | `07 §7` puts both in K8s |
| D5 | Model default is **`claude-opus-5`**; tiered cascade is opt-in and gated on measurement | `07 §2` names `claude-opus-4-8` |

### D1 — Gestures write rules

v1's course page has a mouse-only "drop" mode: select a source assessment, select a target
(or "distribute evenly"), and the source's weight transfers. It lives in ephemeral React
state (`dropMode`, `droppedMap`, `weightAdjustments`), reports errors via `alert()`, and is
lost on refresh. v2's `RedistributeRule` expresses the same idea declaratively.

**The gesture survives, but it now appends a rule** rather than mutating weights:

```ts
// User taps "move weight" on a missed assessment, picks a destination.
// Result appended to user_courses.grading_rules:
{
  id: "usr_redist_a3",
  type: "redistribute",
  enabled: true,
  source: "user",                      // provenance — drives "reset to official"
  description: "Assignment 3 weight → Final Exam",
  from: { slug: "assignment-3" },
  to:   { slug: "final-exam" },
}
```

Consequences, all desirable:

- It appears in the rules panel alongside official rules, labelled `you` vs `official`.
- It is individually toggleable and undoable, and survives refresh and term rollover.
- It shows up in `CourseResult.appliedRules`, so "show the math" explains it.
- It sets `rules_overridden = true`, so "reset to official" reverses it.
- The engine — not the page — computes the effect, so the calculator and the course page
  share one implementation. This is the bulk of the 1,800-line duplication removal.

Accessibility: the gesture is a menu (tap → choose destination), not a drag. That satisfies
`06` F6.1 without needing a separate keyboard path.

### D2 — Paste-first intake

Headline success criterion is "add your real term's courses in under two minutes." The
primary path is a single textarea: the student pastes their Quest class schedule.

**We do not parse Quest's layout.** Parsing another system's copy-paste format is brittle
and fails in a way that ruins a first impression. Instead:

1. Harvest every candidate course code from the pasted text: `/\b([A-Z]{2,6})\s?(\d{3}[A-Z]?)\b/g`.
2. Normalize (`CS240` → `CS 240`) and match each candidate against `catalog_courses` for
   the resolved term. **The catalog is the validator** — we never trust the parse.
3. Unrecognized tokens are dropped silently. Codes with multiple sections get an inline
   section picker. Codes absent from the catalog are offered as custom courses.
4. A **review step** lists exactly what will be added, with confidence badges, before any
   write happens.
5. "Or search for a course" is visible on the same screen, always.

Worst case degrades to search-first. There is no dead end. Term is inferred from a term
string in the pasted text if present, else from the current date.

This also makes `suggestCourses(program, level)` optional, which is fortunate — see §4.

### D3 — Cloud topology

One image, three runners. The only coupling is the shard index.

```
                    ┌─────────────────────────────────────┐
                    │  ghcr.io/…/goosegrade-jobs:<sha>    │
                    │  entrypoint: scrape | qa | diff     │
                    └──────────────┬──────────────────────┘
                                   │
   ┌───────────────────────────────┼───────────────────────────────┐
   │                               │                               │
   ▼ development                   ▼ production                    ▼ demo
   kind / minikube                 Cloud Run Jobs                  GKE Autopilot
   k8s/*.yaml                      --tasks=8 --parallelism=4       same k8s/*.yaml
   JOB_COMPLETION_INDEX            CLOUD_RUN_TASK_INDEX            JOB_COMPLETION_INDEX
   $0                              <$1 per term                    ~$0–1, then deleted
```

Rationale: Cloud Run Jobs is the correct production runner — parallel tasks, per-second
billing, no cluster to operate. GKE Autopilot's cluster-management fee is covered by GCP's
monthly credit for one zonal cluster, where EKS charges ~$0.10/hr with no free tier. `kind`
carries all local development at zero cost, against the same manifests the demo uses.

> **Verify GCP pricing at build time.** The zonal-cluster credit, Cloud Run per-second rates,
> and the new-account trial credit are all quoted from documentation that changes. The
> decision does not hinge on the exact figures — it hinges on Cloud Run needing no cluster —
> but confirm the numbers before presenting them as a cost commitment.

Cross-cloud egress to Supabase (AWS-hosted) is immaterial: ~1,600 JSON rows plus ~160 MB
of stored outlines per term.

**Amends `01` (System-at-a-glance diagram, Cost section) and `07` (§5, §8).**

Not doing, deliberately: standing cluster · Helm/operators/CRDs/autoscaling/service mesh ·
workflow engine · message broker (Postgres is the work queue) · Deployments (Jobs only) ·
containerizing the Next.js app or Postgres · two separate images.

---

## 2. What Kubernetes earns

Not scale — 1,600 documents three times a year is not a scale problem. Three properties
that would otherwise be hand-written:

- **Indexed-Job sharding.** `completionMode: Indexed`, each pod owns shard
  `JOB_COMPLETION_INDEX` of the catalog. Deterministic partition, no work queue.
- **Per-shard retry.** Scraping 1,600 URLs behind a session cookie will have transient
  failures. `backoffLimit` retries one shard; a single process gives you "died at course
  1,412, start over."
- **Idempotent resume.** `source_hash` means re-running a dead shard skips completed work,
  which is what makes the retry actually safe.

There is a second, independent reason sharding is load-bearing: the Message Batches API
caps a batch at 256 MB, and 1,600 outlines at ~100 KB each is ~160 MB. One term with
fatter outlines breaks a single-batch design. **One batch per shard.**

### D4 — The QA tier split

`07 §7` places both QA tiers on Kubernetes. Split them by what they cost:

| Tier | What it does | Where it runs | Why |
|---|---|---|---|
| **1 — deterministic** | Engine safety contract over every catalog course: never throws · `0 ≤ currentGrade ≤ ceiling ≤ 100+bonus` · rules-off reproduces plain weighted sum · a passing average is never displayed as a fail · no cross-course slug references | **GitHub Actions**, blocking PRs | Pure synchronous engine × 1,600 courses runs in seconds. A correctness gate that needs someone to launch a cluster is not a gate. |
| **2 — adversarial LLM** | Reads the stored outline against the parsed scheme and tries to find a disagreement; generates adversarial fixtures | **Cloud Run Jobs / K8s**, sharded | Real per-unit cost and latency; benefits from sharding and retry. Runs only on `unconfirmed` or diff-changed courses. |

**Write the safety invariants once**, as a shared assertion module consumed by both Vitest
(over hand-written fixtures) and the tier-2 runner (over real courses). Two implementations
of the safety contract is how the safety contract drifts.

---

## 3. Extraction: model, cost, and tiering

Corrected pricing (`07 §6` predates current models):

| Model | $/1M in / out | ~per course | ~per term (1,600) | Batched (−50%) |
|---|---|---|---|---|
| **`claude-opus-5`** (default) | $5 / $25 | $0.19 | $300 | **$150** |
| `claude-sonnet-5` | $3 / $15 | $0.11 | $180 | $90 |
| `claude-haiku-4-5` | $1 / $5 | $0.038 | $60 | **$30** |

Assumes ~30K input tokens and ~1.5K output per outline. **Verify with
`client.messages.count_tokens()` against real outlines rather than trusting this estimate.**

`claude-opus-5` costs exactly what `07` budgeted for `claude-opus-4-8` — same tier, newer
model. It is a model-string change, not a cost change.

**The LLM bill is roughly 150× the entire compute bill.** Engineering effort belongs in
`source_hash` skipping and model tiering, not cluster tuning.

### D5 — Tiered cascade, gated on measurement

A Haiku-first pass with Opus escalation lands near $68/term instead of $150, with better
accuracy on hard rules than a single Sonnet pass. But it is **not** adopted on the strength
of that arithmetic:

1. Run Haiku 4.5 and Opus 5 over the **same 100-course sample** (~$4) and measure the
   disagreement rate on rules and weights.
2. Adopt the cascade only if disagreement on rule detection is negligible.

**Escalation must be deterministic, never the model's self-reported confidence.** A cheap
model that confidently mis-parses "best 10 of 12" is precisely the failure the correctness
rule forbids. Escalate to Opus 5 when any of:

- extracted weights ≠ 100 ± 0.01
- the raw outline matches `/best|higher of|replace|must (pass|achieve)|at least \d+% on the final/i`
- any `GradingRule` was emitted at all
- tier-2 QA flagged the course

Prompt caching is a marginal win here, not a lever: the shared prompt is ~3 K tokens
against a ~30 K-token outline. Enable it; do not budget around it.

### Bugs in `07` to fix

1. **The structured-output schema will not validate.** `rules: { type: "array", items: { type: "object" } }`
   is an unconstrained object; structured outputs require `additionalProperties: false` on
   every object. Emit the `GradingRule` union as explicit `anyOf` variants, each with
   `required` and `additionalProperties: false`, then re-validate with Zod (already a
   dependency) application-side.
2. **"Adaptive thinking is on by default for Opus 4.8" is false.** On Opus 4.8 you must pass
   `thinking: { type: "adaptive" }` explicitly. On Opus 5 it is the default. Set it
   explicitly either way.
3. **Batch size** — see §2. One batch per shard.

### Scraper guards to build on day one

- **Rate limit with jitter, `parallelism: 4`, not 32.** `outline.uwaterloo.ca` is a
  university server behind a session cookie. Hammering it is both rude and a reliable way
  to get the cookie invalidated.
- **Cookie-expiry fail-fast.** An expired `WATERLOO_SESSION_COOKIE` must abort the run, not
  quietly feed 1,600 login pages to Opus at $0.19 each.

---

## 4. Gaps in the frozen contract

Each needs an amendment to `02`/`03`/`04` before the sessions build against it.

| # | Gap | Proposed resolution |
|---|---|---|
| G1 | **`computeCumulative` does not exist.** The dashboard mockup shows "Cumulative 77.4% ▲1.3 vs last term"; `03 §4` defines only `computeTermAverage(courses)`. | Add `computeCumulative(terms: Term[])` returning `{ average, includedCredits, deltaVsPreviousTerm }`. Specify whether `listTerms()` populates `courses` for every term — the function is unusable otherwise. |
| G2 | **`currentGrade` returns `0` when nothing is graded** (`03 §3`). In week one every card reads **0.0%** — a tool whose founding rule is "never display a passing student as failing" opens by showing everyone a zero. | Return `currentGrade: number \| null`; `null` renders as `—`. Term average excludes null-grade courses and reports them in `excludedCourseIds`. |
| G3 | **`DisplayItem` is never defined**, though `groupAssessments` returns `DisplayItem[]`. | Define it in `03 §1`: a discriminated union of a single assessment and a group (`{ isGroup: true, name, children, weight }`), ported from the legacy `GroupedAssessment`. |
| G4 | **`suggestCourses(program, level)` has no data source** — `02` defines no sequence table. | Given D2, mark it Later and drop it from Phase 1, or add a `program_sequences` table. Do not ship a function with no backing data. |
| G5 | **`contributeGrades` keys on `catalog_assessment_id`**, so a student who renamed or added items silently contributes nothing. | Key contributions on `(catalog_course_id, slug)` instead, so forked-and-renamed assessments still map. State explicitly what happens for `is_custom` items (excluded). |
| G6 | **Past-term averages recompute live.** With snapshot-lock cut, an engine fix retroactively changes a graduated term's average. | Accept, but record it as a decision rather than an accident: the record is derived, not frozen. Revisit only if a user-visible discrepancy is reported. |
| G7 | **No table for scheme diffs.** `07 §4` says "record a diff"; `02` defines nowhere to put it. | Add `scheme_diffs (id, catalog_course_id, detected_at, old_scheme jsonb, new_scheme jsonb, summary text)`. Backs the "CS 240 final went 45% → 50%" notification. |
| G8 | **No home for QA findings.** Flagging `scheme_confidence='review'` with no reason attached is an unactionable flag. | Add `qa_findings (id, catalog_course_id, run_id, severity, invariant, detail jsonb, created_at)`. |

---

## 5. Functional model

### The spine

`getCurrentTerm()` returns the term with courses and assessments fully populated. The pure
client-side engine derives every number on screen. `setGrade` is the only write on the
critical path.

**No grade is ever stored.** `currentGrade`, term average, and cumulative are recomputed on
read. There is no cache to invalidate, no server calculate endpoint, and no way for a
displayed number to be stale. That single property is what makes the sub-5-second
grade-back loop free rather than engineered.

### Screens

**Anonymous** — Landing (the brand moment: Lora serif, three illuminating orbs; glow lives
*only* here) · Calculator (full engine, ephemeral scratch, "save this to your term" converts
the scratch course into a real forked course on signup — the growth loop).

**Authed** — Onboarding (paste → match → review) · **My Term** (canonical, per
`specs/visuals/dashboard-mockup.html`) · **Course detail** (the centrepiece) · Add course ·
My record · Settings · global Feedback.

### The four loops

| Loop | Cadence | Interaction |
|---|---|---|
| **Grade-back** | weekly | mark returns → type it → term average moves, < 5 s |
| **Target** | a few times per term | "aim for 82" → what each course needs |
| **Trust** | on doubt | confidence badge → source outline → correction → re-scrape diff |
| **Term** | 3×/year | rollover → record grows |

### Assessment state machine

The correctness keystone. The control states its consequence in place, because the
distinction is exactly what prevents wrongly failing a student:

```
upcoming ──┬─→ graded    grade entered; contributes to numerator and denominator
           ├─→ excused   weight LEAVES the denominator (not a zero)
           └─→ missed    real zero; a redistribute rule may move its weight
```

### Where the safety contract is visible

- **Pass gates never replace a number.** The numeric average and the gate status sit side
  by side, always. `passGateStatus` is a separate field precisely so the UI cannot collapse
  them.
- **Low confidence is stated, not hidden.** A `review`-confidence course shows a badge and
  "using plain weighted sum"; special rules are present but advisory.
- **`CourseResult.warnings` renders as a quiet inline note**, never a modal — the tone is a
  neutral data tool, not a nag.

---

## 6. Build sequencing

`00 §"Phasing"` is broadly right. Two corrections:

1. **The engine must precede rule extraction.** `00` puts the scraper at phase 7, which is
   correct, but `05` B5.2 (emit `GradingRule[]`) must not begin until `lib/engine` defines
   what a rule *means*. Extracting against unpinned semantics means re-scraping. Order:
   engine → extraction schema → scrape.
2. **The safety invariants are one module**, shared by Vitest and the tier-2 QA runner
   (§2, D4).

Otherwise: foundation (schema/RLS/auth/`lib/api`) → engine → single course persisted →
dashboard → term lifecycle → trust & community → scraper v2 → polish.

---

## 7. Tooling to add

**Required:** `@anthropic-ai/sdk` (replacing `openai`) · Supabase CLI · **Vitest** (not
currently a dependency; the engine tests gate CI) · Docker + `kind` + `kubectl` · GitHub
Actions (no workflows exist yet) · **GHCR** for the registry — free, no cloud account, and
pulls identically from kind, Cloud Run, and GKE · Playwright for the four E2E smokes · Zod
for validating extraction output against the rule union.

**Deferred:** Sentry (Vercel Analytics suffices pre-users) · Terraform (committed YAML plus
`gcloud` is right for three subcommands and an ephemeral cluster) · dashboards.

**Rejected:** Redis (the engine is client-side — nothing to cache) · message broker ·
Datadog/Grafana. Observability is `kubectl logs` plus a `scrape_runs` summary row, which is
more useful because it is queryable.

---

## 8. Open questions

- **O1** — Does the class-distribution feature ship in Phase 1 as specced, given it depends
  on a user base that does not exist yet? The min-sample floor of 5 means it shows "not
  enough data" for every course until adoption. Consider building the contribution path in
  Phase 1 and the read path later.
- **O2** — G4: drop `suggestCourses` from Phase 1, or add a sequence table?
- **O3** — Which GCP project and billing account? Needed before the first Cloud Run deploy.
