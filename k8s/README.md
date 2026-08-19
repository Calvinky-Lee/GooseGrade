# Running the jobs

One image, three subcommands, three places to run it. The **only** coupling between the runners is
the shard index: `JOB_COMPLETION_INDEX` (Kubernetes) and `CLOUD_RUN_TASK_INDEX` (Cloud Run) mean
the same thing, so the same image and the same partition logic run unchanged everywhere
(`jobs/src/shard.ts`).

| Where | What for | Cost |
|---|---|---|
| `kind` locally | development, and the K8s manifests themselves | $0 |
| **Cloud Run Jobs** | the real term scrape | **<$1 per term** |
| GKE Autopilot | short-lived demo, then deleted | ~$0–1 |

> Verify GCP pricing before quoting it — the zonal-cluster credit, Cloud Run per-second rates and
> trial credit all change. The decision does not hinge on the exact figures; it hinges on Cloud
> Run needing no cluster at all.

**The cost that actually matters is the model bill, not compute.** A term scrape is roughly $150
of Claude against well under a dollar of container time — about 150×. Effort belongs in the
`source_hash` skip and model tiering, not cluster tuning.

---

## Build and push

```bash
docker build -f jobs/Dockerfile -t ghcr.io/calvinky-lee/goosegrade-jobs:$(git rev-parse --short HEAD) .
docker push ghcr.io/calvinky-lee/goosegrade-jobs:$(git rev-parse --short HEAD)
```

GHCR because it is free, needs no cloud account, and pulls identically from kind, Cloud Run and
GKE.

## Local, without a cluster

```bash
docker compose run --rm jobs scrape --term "Spring 2026" --limit 5 --dry-run
```

`--dry-run` extracts and validates but writes nothing — the right way to check a prompt change
before spending on a full run.

## Local Kubernetes (kind)

```bash
kind create cluster --name goosegrade

# Secrets are created out-of-band; nothing credential-shaped is committed.
kubectl create secret generic goosegrade-secrets \
  --from-literal=supabaseServiceRoleKey="$SUPABASE_SERVICE_ROLE_KEY" \
  --from-literal=anthropicApiKey="$ANTHROPIC_API_KEY" \
  --from-literal=waterlooSessionCookie="$WATERLOO_SESSION_COOKIE"

kubectl apply -f k8s/config.yaml
kubectl apply -f k8s/scraper-job.yaml

kubectl get pods -l component=scraper -w
kubectl logs -l component=scraper --tail=50 -f

kind delete cluster --name goosegrade
```

## Production: Cloud Run Jobs

The correct production runner — parallel tasks, per-second billing, and no cluster to operate.

```bash
gcloud run jobs create goosegrade-scrape \
  --image ghcr.io/calvinky-lee/goosegrade-jobs:latest \
  --region us-central1 \
  --tasks 8 \
  --parallelism 4 \
  --max-retries 3 \
  --task-timeout 3600s \
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=supabase-service-role:latest,ANTHROPIC_API_KEY=anthropic-key:latest,WATERLOO_SESSION_COOKIE=uw-cookie:latest \
  --set-env-vars SUPABASE_URL=https://REPLACE-ME.supabase.co \
  --args scrape,--term,"Spring 2026"

gcloud run jobs execute goosegrade-scrape --region us-central1 --wait
```

`--parallelism 4` matches the K8s manifest, and for the same reason: `outline.uwaterloo.ca` is a
university server behind a session cookie.

Schedule the re-scrape during add/drop with Cloud Scheduler:

```bash
gcloud scheduler jobs create http goosegrade-rescrape-weekly \
  --schedule "0 4 * * 1" --time-zone "America/Toronto" \
  --uri "https://us-central1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/PROJECT/jobs/goosegrade-scrape:run" \
  --oauth-service-account-email JOBS_SA@PROJECT.iam.gserviceaccount.com
```

## Demo: GKE Autopilot

Same manifests as kind. Create it, run it, **delete it** — a standing cluster earns nothing here.

```bash
gcloud container clusters create-auto goosegrade-demo --region us-central1
kubectl apply -f k8s/config.yaml -f k8s/scraper-job.yaml
# ... demo ...
gcloud container clusters delete goosegrade-demo --region us-central1
```

---

## What is deliberately absent

- **A standing cluster.** Nothing user-facing depends on this, so it exists only while running.
- **Helm, operators, CRDs, autoscaling, a service mesh.** Three subcommands do not need a
  platform.
- **A workflow engine** (Airflow/Argo) for three subcommands.
- **A message broker.** Postgres is the work queue; the shard index is the partition. Adding
  SQS/Pub-Sub for a thrice-yearly job is ceremony.
- **Deployments.** Jobs only — this is batch work.
- **Terraform.** For three subcommands and an ephemeral cluster, committed YAML plus the `gcloud`
  CLI is enough. Terraform earns its place when the cluster is permanent.
- **A metrics stack.** `kubectl logs` plus the `scrape_runs` table, which is more useful because
  it can be joined against the courses a run touched.

## Two guards worth knowing about

Both live in `jobs/src/fetch.ts`:

1. **Rate limit with jitter.** Politeness, and self-preservation: a burst is how the session
   cookie gets invalidated mid-run.
2. **Cookie-expiry fail-fast.** An expired `WATERLOO_SESSION_COOKIE` aborts the shard instead of
   feeding 1,600 login pages to Opus at ~$0.19 each — a silent several-hundred-dollar run that
   extracts nothing.
