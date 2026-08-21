/**
 * Work sharding — specs/07 §5, design decision D3.
 *
 * The ONLY coupling between the three runners. `JOB_COMPLETION_INDEX` (Kubernetes indexed Job)
 * and `CLOUD_RUN_TASK_INDEX` (Cloud Run Jobs) mean the same thing, so the same image and the
 * same partition logic run under kind, Cloud Run, and GKE unchanged.
 */

export interface Shard {
  index: number;
  count: number;
  source: 'kubernetes' | 'cloud-run' | 'env' | 'single';
}

export function resolveShard(): Shard {
  const k8sIndex = process.env.JOB_COMPLETION_INDEX;
  const k8sCount = process.env.JOB_COMPLETIONS;
  if (k8sIndex != null) {
    return { index: Number(k8sIndex), count: Number(k8sCount ?? 1), source: 'kubernetes' };
  }

  const runIndex = process.env.CLOUD_RUN_TASK_INDEX;
  const runCount = process.env.CLOUD_RUN_TASK_COUNT;
  if (runIndex != null) {
    return { index: Number(runIndex), count: Number(runCount ?? 1), source: 'cloud-run' };
  }

  if (process.env.SHARD_INDEX != null) {
    return {
      index: Number(process.env.SHARD_INDEX),
      count: Number(process.env.SHARD_COUNT ?? 1),
      source: 'env',
    };
  }

  return { index: 0, count: 1, source: 'single' };
}

/**
 * Deterministic partition. A pod must get the same slice on a retry, so this is a stable
 * modulo over the caller's ordering rather than anything time- or randomness-dependent —
 * which is what makes `backoffLimit` safe to rely on.
 */
export function partition<T>(items: T[], shard: Shard): T[] {
  if (shard.count <= 1) return items;
  return items.filter((_, i) => i % shard.count === shard.index);
}
