import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { it } from 'node:test';
import { createApp } from '../index';

it('keeps successful POSTs rate limited and health independent', async () => {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const positions = ['GK', 'GK', ...Array(5).fill('DEF'), ...Array(5).fill('MID'), 'FWD', 'FWD', 'FWD'];
    const slots = positions.map((position, index) => ({
      position, teamId: Math.floor(index / 3) + 1, playerId: index + 1,
      playerName: `Fixture Player ${index + 1}`, price: 5, predictedPoints: 2
    }));
    const plan = () => fetch(`${base}/api/optimizer/transfers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSquad: { slots }, availablePlayers: [], freeTransfers: 1 })
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await plan();
      assert.equal(response.status, 200);
      assert.equal((await response.json()).success, true);
    }
    const limited = await plan();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it('rejects invalid JSON and oversized bodies with public error envelopes', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/analyze`;
    const post = (body: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const malformed = await post('{');
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, 'Invalid JSON.');
    const large = await post(JSON.stringify({ long: 'a'.repeat(525_000) }));
    assert.equal(large.status, 413);
    assert.equal((await large.json()).error, 'Request is too large.');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it('ignores a forged client address when no proxy is trusted', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/entries/import`;
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${attempt}` },
        body: JSON.stringify({ entryId: 'not-a-number' })
      });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400));
    assert.equal(statuses[10], 429);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it('sends security headers and allows only the configured browser origin', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`;
    const allowed = process.env.FRONTEND_URL || 'http://localhost:3000';
    const response = await fetch(url, { headers: { Origin: 'https://attacker.example' } });
    assert.equal(response.headers.get('access-control-allow-origin'), allowed);
    assert.equal(response.headers.get('access-control-allow-credentials'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    const missing = await fetch(url.replace('/health', '/does-not-exist'));
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { success: false, error: 'Endpoint not found' });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
