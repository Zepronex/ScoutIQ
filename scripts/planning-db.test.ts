import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDbPool } from '../apps/api/src/db/client';
import { readPlanningPredictions, readPlanningWindow } from '../apps/api/src/db/predictionQueries';

test('selects the open deadline and rejects stale or incomplete prediction rows in PostgreSQL', {
  skip: process.env.SCOUTIQ_BROWSER_FIXTURE !== '1'
}, async () => {
  const pool = createDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const window = await readPlanningWindow(client);
    assert.equal(window?.gameweek.season, 'Fixture season', 'Use the disposable synthetic fixture database');
    assert.equal(window?.gameweek.id, 11);
    assert.ok(window?.gameweek.runId);

    const complete = await readPlanningPredictions(client, window);
    assert.deepEqual(complete.filter(row => row.playerId === 102).map(row => row.fixtureId).sort(), [11, 15]);
    await client.query('DELETE FROM player_predictions WHERE prediction_run_id = $1 AND player_id = $2 AND fixture_id = $3',
      [window.gameweek.runId, 102, 15]);
    const partial = await readPlanningPredictions(client, window);
    assert.equal(partial.filter(row => row.playerId === 102).length, 0);
    assert.equal(partial.filter(row => row.playerId === 103).length, 2);

    await client.query('UPDATE gameweeks SET deadline_time = now() + interval \'1 second\' WHERE id = $1', [11]);
    assert.equal((await readPlanningWindow(client))?.gameweek.id, 11);
    await client.query('UPDATE gameweeks SET deadline_time = now() WHERE id = $1', [11]);
    const atDeadline = await readPlanningWindow(client);
    assert.equal(atDeadline?.gameweek.id, 12);
    assert.equal(atDeadline?.gameweek.runId, null);
    await client.query('UPDATE gameweeks SET deadline_time = now() - interval \'1 second\' WHERE id = $1', [11]);
    assert.equal((await readPlanningWindow(client))?.gameweek.id, 12);
    await client.query('UPDATE gameweeks SET deadline_time = now() WHERE id = $1', [12]);
    assert.equal(await readPlanningWindow(client), null);

    await client.query('UPDATE gameweeks SET deadline_time = now() + interval \'1 day\' WHERE id = $1', [11]);
    await client.query('UPDATE prediction_runs SET source_run_id = NULL WHERE id = $1', [window.gameweek.runId]);
    const differentSnapshot = await readPlanningWindow(client);
    assert.equal(differentSnapshot?.gameweek.id, 11);
    assert.equal(differentSnapshot?.gameweek.runId, null);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
