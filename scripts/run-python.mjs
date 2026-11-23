// Runs a Python command with whichever interpreter this machine has.
// macOS and most Linux images ship `python3`; Windows ships `python`.
// Set SCOUTIQ_PYTHON to choose one explicitly, for example a virtualenv.
import { spawnSync } from 'node:child_process';

const candidates = process.env.SCOUTIQ_PYTHON
  ? [process.env.SCOUTIQ_PYTHON]
  : process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];

for (const python of candidates) {
  const result = spawnSync(python, process.argv.slice(2), { stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') continue;
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
console.error(`No Python interpreter found (tried ${candidates.join(', ')}). Install Python 3.12+ or set SCOUTIQ_PYTHON.`);
process.exit(1);
