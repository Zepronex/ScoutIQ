import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    snapshot: { type: 'string' },
    history: { type: 'string' },
    'fetch-history': { type: 'boolean' }
  }
});
if (values.history && values['fetch-history']) throw new Error('Use --history or --fetch-history.');
if (values.snapshot && values['fetch-history']) throw new Error('Use a matching local history file with a replayed snapshot.');

const workspace = fileURLToPath(new URL('..', import.meta.url));
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('Start this script with pnpm run refresh:fpl.');
const python = process.env.SCOUTIQ_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: workspace, stdio: 'inherit' });
  if (result.error) throw new Error(`Could not start ${path.basename(command)}: ${result.error.code}`);
  if (result.status !== 0) throw new Error(`${args[0]} failed with status ${result.status ?? result.signal}.`);
}

const work = await mkdtemp(path.join(tmpdir(), 'scoutiq-refresh-'));
try {
  const snapshot = values.snapshot ? path.resolve(values.snapshot) : path.join(work, 'fpl');
  const history = values.history ? path.resolve(values.history) : path.join(work, 'history.json');
  const features = path.join(work, 'features.jsonl');
  const training = path.join(work, 'training.jsonl');
  const model = path.join(work, 'model.json');
  const evaluation = path.join(work, 'evaluation.json');
  const predictions = path.join(work, 'predictions.jsonl');

  if (!values.snapshot) run(process.execPath, [pnpm, 'run', 'ingest:fpl', '--out', snapshot]);
  if (values['fetch-history']) {
    run(process.execPath, [pnpm, 'run', 'ingest:fpl:history', '--input', snapshot, '--out', history, '--concurrency', '4']);
  }
  if (values.history) {
    const manifest = JSON.parse(await readFile(path.join(snapshot, 'manifest.json'), 'utf8'));
    const captured = JSON.parse(await readFile(history, 'utf8'));
    if (!manifest.season || captured.inputSeason !== manifest.season) {
      throw new Error('Player history must match the season of the snapshot.');
    }
  }
  run(python, ['-m', 'pipelines.expected_points.features', '--input', snapshot, '--history', history,
    '--features-output', features, '--training-output', training]);
  const trainingWeeks = new Set((await readFile(training, 'utf8')).split('\n').filter(Boolean)
    .map(line => JSON.parse(line).upcoming_gameweek_id));
  if (trainingWeeks.size >= 2) {
    run(python, ['-m', 'pipelines.expected_points.train', '--input', training, '--output', model]);
  }
  if (trainingWeeks.size >= 3) {
    run(python, ['-m', 'pipelines.expected_points.backtest', '--input', training, '--output', evaluation,
      '--predictions-output', path.join(work, 'backtest.jsonl')]);
  }
  if (!(await readFile(features, 'utf8')).trim()) {
    throw new Error('No future gameweek features are available. The published data was preserved.');
  }
  run(python, ['-m', 'pipelines.expected_points.predict', '--features', features, '--model', model, '--output', predictions]);
  run(process.execPath, [pnpm, 'run', 'db:load:predictions', '--fpl', snapshot,
    '--predictions', predictions, '--model', model, '--evaluation', evaluation]);
} finally {
  await rm(work, { recursive: true, force: true });
}
