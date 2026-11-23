import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { it } from 'node:test';
import express from 'express';
import axios from 'axios';
import { QueryResult, QueryResultRow } from 'pg';
import { Queryable } from '../db/client';
import { createEntriesRouter, readPublicPicks } from './entries';

const picks = Array.from({ length: 15 }, (_, index) => ({ element: index + 1, position: index + 1 }));
const playerRows = picks.map(pick => ({
  id: pick.element, display_name: `Fixture Player ${pick.element}`, team_id: 1, team_short: 'T1',
  position: 'MID', now_cost: 5, form: 0, status: 'a', expected_goals: 0, expected_assists: 0,
  minutes: 0, starts: 0, points_per_game: 0, value_season: 0, selected_by_percent: 0, next_3_ease: 0
}));

const client: Queryable = {
  async query<T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> {
    const rows = sql.includes("interval '7 days'") ? [{ id: 10, season: 'Fixture season', snapshot_id: '1' }] : playerRows;
    return { rows: rows as unknown as T[], rowCount: rows.length, oid: 0, fields: [], command: 'SELECT' };
  }
};

it('imports the latest public XI and bench without assuming a current bank or revealing an entry ID', async () => {
  const result = await lookup(1, async (_id, gameweek) => {
    assert.equal(gameweek, 10);
    return { picks: [...picks].reverse(), entry_history: { bank: 20 } };
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.data.gameweekId, 10);
  assert.equal(result.data.data.squad.startingXI[0].id, 1);
  assert.equal(result.data.data.squad.bench[0].id, 12);
  assert.equal(result.data.data.squad.bank, 0);
  assert.equal(result.data.data.squad.bankConfirmed, undefined);
  assert.equal(result.data.data.entryId, undefined);
});

it('blocks invalid IDs before calling FPL and refuses partial picks', async () => {
  const invalid = await lookup('abc', async () => assert.fail('invalid IDs must never call FPL'));
  assert.equal(invalid.status, 400);
  const partial = await lookup(1, async () => ({ picks: picks.slice(0, 14) }));
  assert.equal(partial.status, 409);
  assert.match(partial.data.error, /all 15 picks/);
  const missing = await lookup(1, async () => ({ picks: [...picks.slice(0, 14), { element: 100, position: 15 }] }));
  assert.equal(missing.status, 409);
  assert.match(missing.data.error, /missing from the current FPL player list/);
});

it('returns a recovery message when the public provider fails', async () => {
  const unavailable = await lookup(1, async () => { throw new Error('upstream test error'); });
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.data.error, /temporarily unavailable/);
});

it('distinguishes an unknown team ID from an existing team with no public picks', async () => {
  for (const [entryStatus, expected] of [[404, 404], [200, 409]]) {
    let calls = 0;
    const provider = axios.create({
      adapter: async config => ({
        status: ++calls === 1 ? 404 : entryStatus,
        statusText: '', headers: {}, data: {}, config
      })
    });
    const result = await lookup(1, (id, week) => readPublicPicks(id, week, provider));
    assert.equal(result.status, expected);
    assert.equal(calls, 2);
  }
});

it('asks FPL once for repeated imports of the same team', async () => {
  let calls = 0;
  const app = express().use(express.json()).use('/entries', createEntriesRouter(client, async () => {
    calls += 1;
    return { picks };
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/entries/import`;
    const post = (entryId: number) => fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entryId })
    });
    assert.equal((await post(7)).status, 200);
    assert.equal((await post(7)).status, 200);
    assert.equal(calls, 1);
    assert.equal((await post(8)).status, 200);
    assert.equal(calls, 2);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

async function lookup(entryId: unknown, provider: (id: number, week: number) => Promise<unknown>) {
  const app = express().use(express.json()).use('/entries', createEntriesRouter(client, provider));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/entries/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entryId })
    });
    return { status: response.status, data: await response.json() };
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
