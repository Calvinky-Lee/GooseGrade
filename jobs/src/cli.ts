/**
 * The jobs entrypoint — ONE image, three subcommands (design decision D3).
 *
 *   scrape   fetch outlines -> Claude extraction -> catalog
 *   diff     re-scrape changed outlines -> scheme_diffs
 *   qa       adversarial LLM cross-check -> qa_findings
 *
 * Two near-identical images drift; one image with a CLI entrypoint does not, and it means a
 * scheme_confidence value is traceable to a single image digest.
 *
 * Deterministic tier-1 QA is deliberately NOT here — it runs in CI (see qa-catalog.ts), because
 * a correctness gate that requires launching a cluster is not a gate.
 */

import { runBatch } from './batch';
import { runDiscover } from './discover';
import { runLlmQa } from './qa-llm';
import { runScrape } from './scrape';
import { normalizeTermArg, termForDate } from './term';

interface Args {
  command: string;
  term?: string;
  limit?: number;
  force: boolean;
  all: boolean;
  dryRun: boolean;
  cheapModel?: string;
  model?: string;
  subject?: string;
  submitOnly: boolean;
  resume?: string;
}

function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  const args: Args = {
    command: command ?? '',
    force: false,
    all: false,
    dryRun: false,
    submitOnly: false,
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const next = () => rest[++i];

    switch (arg) {
      case '--term':
        args.term = normalizeTermArg(next());
        break;
      case '--limit':
        args.limit = Number(next());
        break;
      case '--cheap-model':
        args.cheapModel = next();
        break;
      case '--model':
        args.model = next();
        break;
      case '--subject':
        args.subject = next();
        break;
      case '--resume':
        args.resume = next();
        break;
      case '--submit-only':
        args.submitOnly = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--all':
        args.all = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      default:
        if (arg?.startsWith('--')) throw new Error(`Unknown flag ${arg}`);
    }
  }

  return args;
}

const USAGE = `goosegrade jobs

  discover --term <"Winter 2026"|1261> [--subject CS] [--limit N] [--dry-run]
      Enumerate the courses UW offers this term and record one catalog row per section,
      with its outline URL and no scheme yet. Run this FIRST for a new term — scrape only
      re-reads rows that already exist.
      Idempotent: safe to re-run, and it never touches a scheme scrape has extracted.

  batch --term <term> [--model <id>] [--limit N] [--force] [--submit-only]
        [--resume <batch_id>] [--dry-run]
      The same extraction as scrape, through the Message Batches API: 50% cheaper, and the
      model bill is ~150x the compute bill, so this is the cost lever that matters. Completes
      within hours, which suits a job that runs three times a year.
      --submit-only exits after submitting; --resume ingests a batch submitted earlier, so a
      dead pod never orphans work we have already paid for.

  scrape --term <"Winter 2026"|1261> [--limit N] [--force] [--cheap-model <id>] [--dry-run]
      Fetch outlines, extract schemes with Claude, write the catalog.
      Skips courses whose source_hash is unchanged unless --force.
      --cheap-model runs a first pass on a cheaper model and escalates deterministically.

  diff --term <term> [--limit N] [--dry-run]
      Re-scrape and record scheme_diffs for anything whose outline changed.

  qa [--term <term>] [--all] [--limit N] [--dry-run]
      Adversarial LLM cross-check of parsed schemes against stored outlines.
      Defaults to unconfirmed/review courses only; --all re-audits everything.

Sharding is automatic from JOB_COMPLETION_INDEX (Kubernetes) or CLOUD_RUN_TASK_INDEX
(Cloud Run), or SHARD_INDEX/SHARD_COUNT locally.

Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY,
WATERLOO_SESSION_COOKIE.
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'discover': {
      if (!args.term) {
        throw new Error(
          `--term is required. For the current term that would be "${termForDate(new Date())}".`,
        );
      }
      await runDiscover({
        term: args.term,
        subject: args.subject,
        limit: args.limit,
        dryRun: args.dryRun,
      });
      break;
    }

    case 'batch': {
      // --resume needs no term: the batch already exists and carries its own work.
      if (!args.term && !args.resume) {
        throw new Error(
          `--term is required (or --resume <batch_id>). For the current term that would be ` +
            `"${termForDate(new Date())}".`,
        );
      }
      await runBatch({
        term: args.term ?? '',
        model: args.model,
        limit: args.limit,
        force: args.force,
        submitOnly: args.submitOnly,
        resume: args.resume,
        dryRun: args.dryRun,
      });
      break;
    }

    case 'scrape':
    case 'diff': {
      // The term is required rather than defaulted, so a run can never silently target the
      // wrong term — but the error names the term it would most likely have been.
      if (!args.term) {
        throw new Error(
          `--term is required. For the current term that would be ` +
            `"${termForDate(new Date())}".`,
        );
      }
      await runScrape(
        {
          term: args.term,
          force: args.command === 'diff' ? false : args.force,
          limit: args.limit,
          cheapModel: args.cheapModel,
          dryRun: args.dryRun,
        },
        args.command === 'diff' ? 'rescrape' : 'scrape',
      );
      break;
    }

    case 'qa':
      await runLlmQa({ term: args.term, all: args.all, limit: args.limit, dryRun: args.dryRun });
      break;

    case 'help':
    case '--help':
    case '':
      console.log(USAGE);
      break;

    default:
      console.error(`Unknown command "${args.command}".\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
