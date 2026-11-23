import path from 'node:path';
import { createDbPool, withTransaction } from './client';
import { readDatabaseConfig } from './config';
import { buildFplLoadPlan } from './fplLoadPlan';
import { loadFplLoadPlan, readNormalizedFplDataset } from './fplLoader';
import { buildPredictionLoadPlanFromFiles, loadPredictionArtifacts, loadPredictionLoadPlan } from './predictionLoader';

type CliOptions = {
  modelName: string;
  predictionFilePath: string;
  modelArtifactPath: string | null;
  evaluationFilePath: string | null;
  fplDir: string | null;
};

async function main(): Promise<void> {
  const config = readDatabaseConfig();
  const options = parseArgs(process.argv.slice(2), config);
  const pool = createDbPool(config);

  try {
    const result = options.fplDir
      ? await publishSnapshot(pool, options.fplDir, options)
      : await loadPredictionArtifacts(pool, options);

    console.log(
      `Prediction database load complete: ${result.predictionCount} rows for gameweek ${result.targetGameweekId}`
    );
    console.log(`Prediction run: ${result.predictionRunId}`);
    console.log(`Run key: ${result.runKey}`);
    if (result.evaluationId) {
      console.log(`Model evaluation: ${result.evaluationId}`);
    } else {
      console.log('Model evaluation: not loaded');
    }
  } finally {
    await pool.end();
  }
}

async function publishSnapshot(pool: ReturnType<typeof createDbPool>, inputDir: string, options: CliOptions) {
  const [dataset, predictions] = await Promise.all([
    readNormalizedFplDataset(inputDir),
    buildPredictionLoadPlanFromFiles(options)
  ]);
  const fpl = buildFplLoadPlan(dataset);
  if (predictions.predictionRun.sourceSnapshotHash !== fpl.ingestionRun.snapshotHash) {
    throw new Error('The player snapshot and projections were generated from different inputs.');
  }
  const publishedAt = Date.now();
  const nextGameweek = fpl.gameweeks
    .filter(gameweek => !gameweek.finished && Date.parse(gameweek.deadlineTime) > publishedAt)
    .sort((left, right) => Date.parse(left.deadlineTime) - Date.parse(right.deadlineTime))[0];
  if (nextGameweek?.id !== predictions.predictionRun.targetGameweekId) {
    throw new Error('The projections are not for the next open FPL deadline. Capture a new snapshot.');
  }
  const expected = new Set<string>();
  for (const fixture of fpl.fixtures) {
    if (fixture.eventId !== nextGameweek.id || fixture.started || fixture.finished) continue;
    for (const player of fpl.players) {
      if (player.teamId === fixture.teamHId || player.teamId === fixture.teamAId) {
        expected.add(`${player.id}:${fixture.id}`);
      }
    }
  }
  if (!predictions.playerPredictions.every(row => expected.delete(`${row.playerId}:${row.fixtureId}`)) || expected.size) {
    throw new Error('Projection rows do not cover every player fixture in the current gameweek.');
  }

  return withTransaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('scoutiq-publish'))");
    const newer = await client.query(
      'SELECT 1 FROM ingestion_runs WHERE generated_at > $1 LIMIT 1',
      [fpl.ingestionRun.generatedAt]
    );
    if (newer.rows.length) throw new Error('A newer FPL snapshot is already loaded.');
    await loadFplLoadPlan(client, fpl);
    return loadPredictionLoadPlan(client, predictions);
  });
}

function parseArgs(
  args: string[],
  config: ReturnType<typeof readDatabaseConfig>
): CliOptions {
  return {
    modelName: readFlag(args, '--model-name') ?? 'expected_points',
    predictionFilePath: resolvePath(
      config.workspaceRoot,
      readFlag(args, '--predictions') ?? config.defaultPredictionOutputPath
    ),
    modelArtifactPath: resolveOptionalPath(
      config.workspaceRoot,
      readFlag(args, '--model') ?? config.defaultExpectedPointsModelPath
    ),
    evaluationFilePath: resolveOptionalPath(
      config.workspaceRoot,
      readFlag(args, '--evaluation') ?? config.defaultExpectedPointsEvaluationPath
    ),
    fplDir: resolveOptionalPath(config.workspaceRoot, readFlag(args, '--fpl') ?? null)
  };
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Expected a value after ${flag}`);
  }
  return value;
}

function resolvePath(workspaceRoot: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
}

function resolveOptionalPath(workspaceRoot: string, value: string | null): string | null {
  return value === null ? null : resolvePath(workspaceRoot, value);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
