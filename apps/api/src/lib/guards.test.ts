import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDailyBudget, createTtlCache, readLimit } from './guards';

describe('request guards', () => {
  it('shares one load between concurrent and repeated callers until it expires', async () => {
    let clock = 0;
    let loads = 0;
    const cache = createTtlCache<number>(1000, 10, () => clock);
    const load = async () => ++loads;

    assert.deepEqual(await Promise.all([cache.get('a', load), cache.get('a', load)]), [1, 1]);
    clock = 999;
    assert.equal(await cache.get('a', load), 1);
    clock = 1000;
    assert.equal(await cache.get('a', load), 2);
    assert.equal(await cache.get('b', load), 3);
  });

  it('does not keep a failed load and bounds the number of keys', async () => {
    const cache = createTtlCache<string>(1000, 2);
    await assert.rejects(cache.get('a', async () => { throw new Error('down'); }));
    assert.equal(await cache.get('a', async () => 'ok'), 'ok');

    let loads = 0;
    const load = async () => `value ${++loads}`;
    await cache.get('b', load);
    await cache.get('c', load);
    assert.equal(await cache.get('a', load), 'value 3');
  });

  it('stops at the daily limit and resets on the next UTC day', () => {
    let clock = Date.parse('2026-11-23T23:59:00Z');
    const budget = createDailyBudget(2, () => clock);

    assert.deepEqual([budget.tryConsume(), budget.tryConsume(), budget.tryConsume()], [true, true, false]);
    assert.equal(budget.remaining(), 0);
    clock = Date.parse('2026-11-24T00:00:00Z');
    assert.equal(budget.remaining(), 2);
    assert.equal(budget.tryConsume(), true);
    assert.equal(createDailyBudget(0).tryConsume(), false);
  });

  it('reads limits from the environment and rejects malformed values', () => {
    assert.equal(readLimit(undefined, 5, 'X'), 5);
    assert.equal(readLimit('', 5, 'X'), 5);
    assert.equal(readLimit('0', 5, 'X'), 0);
    assert.throws(() => readLimit('-1', 5, 'X'), /X must be/);
    assert.throws(() => readLimit('many', 5, 'X'), /X must be/);
  });
});
