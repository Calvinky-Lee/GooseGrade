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

**Model:** default **`claude-opus-4-8`** — accuracy is the moat, and Opus is best at detecting the
conditional rules (max-of/replacement, pass gates) that a weaker model misses. Cost is a one-time,
once-per-term batch (see §6); cheaper tiers (`claude-sonnet-4-6`, `claude-haiku-4-5`) are a valid
cost tradeoff the user can choose, ideally with Opus spot-checking a sample.

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
    rules: { type: "array", items: { type: "object" } }, // GradingRule[] from 03; validated app-side
    confidence: { type: "string", enum: ["unconfirmed","review","verified"] },
    weightsSumTo100: { type: "boolean" },
    notes: { type: "string" },
  },
  required: ["assessments","rules","confidence","weightsSumTo100","notes"],
};

const res = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 16000,
  output_config: { format: { type: "json_schema", schema: GRADING_SCHEME_SCHEMA } },
  messages: [{ role: "user", content: EXTRACTION_PROMPT + "\n\n" + cleanOutlineText }],
});
```

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

- **Two Docker images:** `scraper` and `qa-runner` (Node + tsx). `docker-compose.yml` for local
  parity. Keep images thin; secrets via env, never baked in.
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
| `claude-opus-4-8` (default) | $5 / $25 | ~$0.19 | ~$300 | **~$150** |
| `claude-sonnet-4-6` | $3 / $15 | ~$0.10 | ~$160 | ~$80 |
| `claude-haiku-4-5` | $1 / $5 | ~$0.03 | ~$50 | ~$25 |

**Use the Message Batches API** for the term scrape: 50% cheaper, async (completes within hours —
fine for a once-a-term job), key each request by `custom_id = "<code>|<section>"`. The `source_hash`
skip (re-scrape only changed outlines) keeps recurring cost far below the first run. Recommendation:
Opus 4.8 + Batch for the authoritative scrape; consider Sonnet for cheap re-scrapes with Opus
re-verifying low-confidence courses.

---

## 7. Multi-agent QA runner (correctness gate — your "test every course" requirement)

After the app + engine are built, the QA runner validates **every catalog course** so a buggy rule
never ships. It runs as parallel K8s Jobs (the containerized multi-agent swarm).

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
