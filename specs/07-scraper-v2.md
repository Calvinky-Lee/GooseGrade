# 07 — Scraper v2 & Multi-Agent QA (the Docker/Kubernetes slice)

This is the productionized data pipeline and the **only** part of GooseGrade that uses Docker +
Kubernetes — the deliberate AWS-learning slice. Two containerized workloads:
1. **Scraper** — fetch outlines → extract a grading *scheme* (rules, not just weights) with Claude → write the catalog.
2. **QA runner** — after a build, validate every course's rules against the engine's safety contract.

Neither is user-facing; if the cluster is down, the app is unaffected.

---

## 1. What changes from v1

| v1 (today) | v2 |
|---|---|
| Local `tsx` scripts, run by hand | Containerized jobs (Docker), orchestrated as K8s Jobs |
| Hardcoded term `1261` (Winter 2026) | **Term is a parameter** (env/arg); resolve current term dynamically |
| OpenAI `gpt-4o-mini` | **Claude** via the Anthropic SDK (`@anthropic-ai/sdk`) |
| Plain-text output parsed by regex (brittle) | **Structured outputs** — Claude returns a typed `GradingScheme` JSON directly |
| Extracts flat weights only | Extracts **`GradingRule[]`** (best-N-of-M, max-of, pass gates, …) + flat weights |
| No source retention | Stores the source outline + `source_hash` for **download link + re-scrape diffing** |
| No accuracy gate | **Multi-agent QA** validates every course; low-confidence → `scheme_confidence='review'` |

---

## 2. Extraction with Claude (the accuracy core)

The scraper's job is now to emit the `GradingScheme` defined in `03-domain-types.md`:
assessments **+** a `GradingRule[]` **+** a confidence label.

**Model:** default **`claude-opus-5`** — accuracy is the moat, and Opus is best at detecting the
conditional rules (max-of/replacement, pass gates) that a weaker model misses. Cost is a one-time,
once-per-term batch (see §6). `claude-opus-5` is priced identically to the `claude-opus-4-8` this
spec originally named ($5/$25 per MTok), so this is a model-string change, not a budget change.

A cheaper **tiered cascade** (Haiku first, Opus on escalation) is a legitimate option — see §6 —
but it is gated on measuring model disagreement first, and its escalation trigger must be
deterministic rather than the model's self-reported `confidence`.

**Use structured outputs, not text parsing.** Replace v1's regex-over-plaintext with
`output_config.format` (JSON schema) so Claude returns a validated object. This is the single
biggest reliability win — no more brittle line parsing.

```ts
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic(); // ANTHROPIC_API_KEY from env

const GRADING_SCHEME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    assessments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          slug: { type: "string" },
          name: { type: "string" },
          category: { type: "string", enum: ["Assignment","Quiz","Lab","Midterm","Final Exam","Participation","Project","Other"] },
          weight: { type: "number" },
          orderIndex: { type: "integer" },
        },
        required: ["slug","name","category","weight","orderIndex"],
      },
    },
    // ⚠ FIX (2026-08-17): a bare `{ type: "object" }` will NOT validate — structured outputs
    // require `additionalProperties: false` on every object and reject unconstrained ones.
    // Emit the GradingRule union as explicit anyOf variants, each with its own `required` and
    // `additionalProperties: false`, then re-validate with Zod app-side. See RULES_SCHEMA below.
    rules: { type: "array", items: { anyOf: RULE_VARIANTS } },
    confidence: { type: "string", enum: ["unconfirmed","review","verified"] },
    weightsSumTo100: { type: "boolean" },
    notes: { type: "string" },
  },
  required: ["assessments","rules","confidence","weightsSumTo100","notes"],
};

const res = await client.messages.create({
  model: "claude-opus-5",
  max_tokens: 16000,
  // FIX (2026-08-17): must be set explicitly. On Opus 4.8 omitting `thinking` meant NO
  // thinking; on Opus 5 adaptive is the default. Naming it makes the request correct on both.
  thinking: { type: "adaptive" },
  output_config: { effort: "high", format: { type: "json_schema", schema: GRADING_SCHEME_SCHEMA } },
  messages: [{ role: "user", content: EXTRACTION_PROMPT + "\n\n" + cleanOutlineText }],
});
```

> **Verify token counts with `client.messages.count_tokens()`** against real outlines rather
> than trusting the "~30K input" estimate in §6 — the per-term budget is derived from it.

**Prompt** (port v1's careful prompt, extended): expand ranges into individual items; compute
shared/split weights to ≥4 decimals; **detect conditional rules** and emit them as `GradingRule`
objects (e.g. "best 10 of 12 quizzes" → a `bestNofM` rule) rather than baking them silently into
weights; set `confidence: 'review'` and explain in `notes` when unsure or weights ≠ 100. Adaptive
thinking is on by default for Opus 4.8 — good for the rule-detection reasoning.

> **Safety tie-in (from `03`):** the engine treats unknown/uncertain rules conservatively. The
> scraper should *prefer* emitting a plain weighted scheme + a `notes` flag over guessing a
> complex rule it isn't sure about. A missed special rule (falls back to weighted sum) is safe; a
> wrong one is not.

---

## 3. Term generalization

Remove the hardcoded `1261`. Resolve the target term from a parameter:
- `TARGET_TERM` env/arg (e.g. `1261`), or
- a small helper that derives the current/upcoming UW term code from a passed-in date
  (scripts can't call `Date.now()` in some sandboxes — pass the date in).
Decode term IDs as v1 already does (`decodeTerm`). Store `term`, `term_date` per `02`.

---

## 4. Source retention & re-scrape diffing

- After fetching an outline, store the cleaned source to Supabase Storage bucket `outlines/`
  (path → `catalog_courses.outline_storage_path`) so the app can offer a **download/source link**.
- Compute `source_hash` over the cleaned outline text. On re-scrape, if the hash is unchanged,
  skip re-extraction (save cost). If changed, re-extract and **record a diff** (old vs new scheme)
  so the app can notify affected users ("CS 240 final went 45% → 50%").
- Re-scrape is itself a scheduled K8s Job (per term, or weekly during add/drop).

---

## 5. Docker + Kubernetes

- **ONE Docker image, three subcommands** (amendment 2026-08-17): `scrape` · `diff` · `qa`
  (Node + tsx), published to **GHCR**. Two near-identical images drift; one image with a CLI
  entrypoint does not, and it means a `scheme_confidence` value is traceable to a single image
  digest that pins the engine version which validated it. `docker-compose.yml` for local
  parity (note `supabase start` already requires Docker locally). Secrets via env, never baked in.

- **Where it runs (amendment):** `kind` for development ($0) · **Cloud Run Jobs** for the real
  term scrape (`--tasks=8 --parallelism=4`, <$1/term, no cluster to operate) · **GKE Autopilot**
  for a short demo, then deleted. `CLOUD_RUN_TASK_INDEX` maps 1:1 onto `JOB_COMPLETION_INDEX`,
  so the same image and shard logic run under all three. Document `kind`, `gcloud run jobs`,
  and `gcloud container clusters` paths in `k8s/README.md`.

- **Two guards to build on day one:**
  - **Rate limit with jitter; `parallelism: 4`, not 32.** `outline.uwaterloo.ca` is a
    university server behind a session cookie. Hammering it is both rude and a reliable way to
    get the cookie invalidated mid-run.
  - **Cookie-expiry fail-fast.** An expired `WATERLOO_SESSION_COOKIE` must abort the shard, not
    quietly feed 1,600 login pages to Opus at $0.19 each. Assert the fetched page looks like an
    outline before it reaches the model.
- **K8s manifests in `k8s/`:** model both as **Jobs** (batch, run-to-completion), not Deployments.
  - `scraper-job.yaml`: parallelizable — shard the ~1,600 courses across N pods via the
    K8s **indexed Job** pattern (`completions: N`, `parallelism: P`); each pod scrapes its shard.
    This is the genuine horizontal-scaling story for the résumé.
  - `qa-job.yaml`: many short-lived workers, each validating a batch of courses, torn down on
    completion.
- **Where it runs:** develop on **local K8s (kind/minikube, ~$0)**; do a short-lived **EKS**
  deployment for the résumé/demo, then `eksctl delete cluster`. Do **not** keep a standing EKS
  cluster (~$73/mo control plane). Document both `kind` and `eksctl` paths in `k8s/README.md`.
- **Secrets:** `ANTHROPIC_API_KEY`, `WATERLOO_SESSION_COOKIE`, `SUPABASE_SERVICE_ROLE_KEY` via
  K8s Secrets locally / GitHub Actions secrets in CI. Never commit.

---

## 6. Cost (one-time per term; respect the student budget)

Each outline ≈ up to 100K chars ≈ ~30K input tokens; output ≈ ~1–2K tokens. Rough per-term totals
for ~1,600 courses:

| Model | $/1M in / out | ~ per course | ~ per term (1,600) | with Batch API (−50%) |
|---|---|---|---|---|
| **`claude-opus-5`** (default) | $5 / $25 | ~$0.19 | ~$300 | **~$150** |
| `claude-sonnet-5` | $3 / $15 | ~$0.11 | ~$180 | ~$90 |
| `claude-haiku-4-5` | $1 / $5 | ~$0.038 | ~$60 | ~$30 |

**One batch per shard, not one batch per term.** The Message Batches API caps a batch at
256 MB; 1,600 outlines at ~100 KB each is ~160 MB — under the cap, but one term with fatter
outlines breaks a single-batch design. This is a second, independent reason the indexed-Job
sharding in §5 is load-bearing rather than decorative. Results arrive in any order — key by
`custom_id`, never by position.

**Tiered cascade (optional, gated on measurement).** Haiku over all 1,600 (~$30 batched) plus
Opus 5 re-extraction on escalated courses (~$38) lands near $68/term. Adopt it only after
running both models over the **same 100-course sample** (~$4) and confirming the rule-detection
disagreement rate is negligible.

**Escalation must be deterministic — never the model's self-reported `confidence`.** A cheap
model that confidently mis-parses "best 10 of 12" is exactly the failure the correctness rule
in `README.md` forbids. Escalate to Opus 5 when any of:
- extracted weights ≠ 100 ± 0.01
- the raw outline matches `/best|higher of|replace|must (pass|achieve)|at least \d+% on the final/i`
- any `GradingRule` was emitted at all
- QA flagged the course

Prompt caching is a **marginal** win here, not a lever: the shared prompt is ~3K tokens against
a ~30K-token outline. Enable it; do not budget around it.

**Use the Message Batches API** for the term scrape: 50% cheaper, async (completes within hours —
fine for a once-a-term job), key each request by `custom_id = "<code>|<section>"`. The `source_hash`
skip (re-scrape only changed outlines) keeps recurring cost far below the first run. Recommendation:
Opus 4.8 + Batch for the authoritative scrape; consider Sonnet for cheap re-scrapes with Opus
re-verifying low-confidence courses.

---

## 7. Multi-agent QA runner (correctness gate — your "test every course" requirement)

**Amendment (2026-08-17) — the two QA tiers run in different places.** This section originally
put both on Kubernetes. Split them by what they actually cost:

| Tier | Work | Runs in | Why |
|---|---|---|---|
| **1 — deterministic** | The safety-contract assertions below, over every catalog course | **GitHub Actions**, blocking PRs | Pure synchronous engine × 1,600 courses = seconds. A gate that needs a cluster launched is not a gate. |
| **2 — adversarial LLM** | Reads the stored outline against the parsed scheme hunting for disagreement; generates adversarial fixtures | **Cloud Run Jobs / K8s**, sharded | Real per-unit cost and latency; wants sharding + retry. Only `unconfirmed` or diff-changed courses. |

**Write the invariants once**, in a module shared by Vitest (hand-written fixtures) and the
tier-2 runner (real courses). Two implementations of the safety contract is how the safety
contract drifts.

Both tiers write to `qa_findings` (`02 §C2`) so a `scheme_confidence='review'` flag carries a
queryable *reason* instead of being an unexplained flag.

After the app + engine are built, QA validates **every catalog course** so a buggy rule never
ships.

For each course, the runner:
1. Loads the course's `GradingScheme` and synthesizes grade fixtures (all-upcoming, all-graded,
   mixed, boundary values, excused vs missed).
2. Runs the **pure engine** (`lib/engine`) over each fixture and asserts the **safety contract**
   from `03 §5`:
   - engine never throws;
   - `0 ≤ currentGrade ≤ ceiling ≤ 100 + bonus`;
   - **disabling all special rules reproduces the plain weighted sum** (no silent divergence);
   - **a passing weighted average is never reported as a fail** unless an explicit, resolved
     `passGate` says so — and even then the numeric average is shown alongside;
   - no rule references slugs from another course.
3. On any violation → set `scheme_confidence='review'` and emit a report; the course falls back to
   plain weighted sum in the UI until fixed.

The "multiple agents test every edge case for each course" goal maps directly onto this: the work
list is the full catalog, sharded across many short-lived containers, each running the deterministic
engine assertions (and, where useful, an LLM agent to generate adversarial fixtures or eyeball the
parsed scheme against the stored outline). Anything flagged is triaged via the catalog trust flow
in `02`/`06`.

---

## 8. Backend task hooks (also in `05` B5)

- [ ] Dockerize scraper + qa-runner; `docker-compose.yml`; `k8s/` Jobs + `k8s/README.md`.
- [ ] Swap OpenAI → Anthropic SDK; structured-output schema; port + extend the extraction prompt.
- [ ] Parameterize term; add `source_hash` + Storage upload + diff.
- [ ] Batch API path for the full-term scrape.
- [ ] QA runner implementing §7; wire into the catalog trust flow.
