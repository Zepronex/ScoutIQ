import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const base = process.env.SCOUTIQ_WEB_URL || 'http://localhost:3001';
const fixture = process.env.SCOUTIQ_BROWSER_FIXTURE === '1';
const channel = process.env.SCOUTIQ_BROWSER_CHANNEL;
const statusHeading = /Gameweek \d+/;
let browser;
let planning;
let draft;

before(async () => {
  const response = await fetch(new URL('/api/predictions/planning', base));
  assert.equal(response.status, 200, 'Start the built app with a future fixture or current FPL projections');
  planning = (await response.json()).data;
  assert.ok(planning.gameweek?.runId && planning.players.length);
  if (fixture) assert.equal(planning.source, 'sample');
  const generated = await fetch(new URL('/api/optimizer/squad', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ predictionRunId: planning.gameweek.runId })
  });
  assert.equal(generated.status, 200);
  draft = (await generated.json()).data;
  const slots = draft.squad.slots;
  assert.equal(slots.length, 15);
  assert.ok(Math.round(slots.reduce((sum, slot) => sum + slot.price, 0) * 10) <= 1000);
  for (const [position, count] of [['GK', 2], ['DEF', 5], ['MID', 5], ['FWD', 3]]) {
    assert.equal(slots.filter(slot => slot.position === position).length, count);
  }
  for (const club of new Set(slots.map(slot => slot.teamId))) {
    assert.ok(slots.filter(slot => slot.teamId === club).length <= 3);
  }
  browser = await chromium.launch(channel ? { channel } : {});
});

after(async () => browser?.close());

async function withPage(width, visit) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Stockholm' });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await visit(page);
    assert.deepEqual(errors, [], 'No uncaught browser errors');
  } finally {
    await context.close();
  }
}

async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No page-wide horizontal overflow');
}

for (const width of [1440, 360]) {
  test(`builds and reloads a gameweek plan at ${width}px`, async () => withPage(width, async page => {
    await page.goto(base);
    await page.getByText(statusHeading).first().waitFor();
    if (fixture) await page.getByText(/Sample data for practice/).waitFor();
    if (width === 1440) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Skip to content');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'content');
    }
    if (width === 1440) {
      await page.getByRole('link', { name: 'Open squad builder' }).press('Enter');
      const generate = page.getByRole('button', { name: 'Generate a draft' });
      await generate.waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('button')]
        .some(button => button.textContent.includes('Generate a draft') && !button.disabled));
      await generate.press('Enter');
    } else {
      await page.getByRole('link', { name: 'Open squad builder' }).click();
      const search = page.getByRole('searchbox', { name: 'Search squad players' });
      for (const player of draft.squad.slots) {
        await search.fill(player.playerName);
        await page.getByRole('button', { name: `Add ${player.playerName}`, exact: true }).click();
      }
      const [startingKeeper, benchKeeper] = draft.squad.slots.filter(slot => slot.position === 'GK');
      await page.getByLabel(`Start ${benchKeeper.playerName} instead of`, { exact: true }).selectOption(String(startingKeeper.playerId));
      await page.getByLabel(`Start ${startingKeeper.playerName} instead of`, { exact: true }).waitFor();
    }
    await page.getByRole('heading', { name: 'Your squad 15/15' }).waitFor();
    await noOverflow(page);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.getByRole('heading', { name: 'Your squad 15/15' }).waitFor();
    const lineupResponse = page.waitForResponse(r => r.url().endsWith('/api/optimizer/starting-xi'));
    const review = page.getByRole('link', { name: 'Review gameweek plan' }).first();
    if (width === 1440) await review.press('Enter');
    else await review.click();
    await page.getByRole('heading', { name: 'Recommended starting XI' }).waitFor();
    const response = await lineupResponse;
    assert.equal(response.status(), 200);
    const { startingXi } = (await response.json()).data;
    const predicted = startingXi.starters.reduce((total, slot) => total + slot.predictedPoints, 0);
    const expected = Math.round((predicted + startingXi.captaincy.captain.predictedPoints) * 100) / 100;
    assert.equal(startingXi.totalPredictedPoints, expected);
    assert.equal(new Set([...startingXi.starters, ...startingXi.bench].map(slot => slot.playerId)).size, 15);
    assert.notEqual(startingXi.captaincy.captain.playerId, startingXi.captaincy.viceCaptain.playerId);
    assert.ok(startingXi.starters.some(slot => slot.playerId === startingXi.captaincy.captain.playerId));
    assert.ok(startingXi.starters.some(slot => slot.playerId === startingXi.captaincy.viceCaptain.playerId));
    assert.ok(await page.getByText(`Keep squad · ${new Intl.NumberFormat('en-GB', {minimumFractionDigits: 1, maximumFractionDigits: 2}).format(expected)} projected pts`).isVisible());

    await page.getByLabel('Free transfers').selectOption('0');
    await page.getByRole('button', { name: 'Compare transfers', exact: true }).click();
    await page.getByText('Keep your squad this gameweek').waitFor();
    await page.getByLabel('Free transfers').selectOption('2');
    const transferResponse = page.waitForResponse(r => r.url().endsWith('/api/optimizer/transfers'));
    await page.getByRole('button', { name: 'Compare transfers', exact: true }).click();
    assert.equal((await transferResponse).status(), 200);
    await page.getByText(/Recommended transfer options|Keep your squad this gameweek/).waitFor();
    if (width === 1440) {
      await page.route('**/api/agent/explain-recommendation', route => route.fulfill({ status: 503, json: { success: false, error: 'Simulated outage' } }), { times: 1 });
      await page.getByRole('button', { name: 'Explain this plan' }).click();
      await page.getByText('Explanation unavailable').waitFor();
      assert.ok(await page.getByRole('heading', { name: 'Recommended starting XI' }).isVisible());
      await page.getByRole('button', { name: 'Retry explanation' }).click();
      await page.getByRole('heading', { name: 'Recommendation explanation' }).waitFor();
    }
    await noOverflow(page);
  }));
}

test('filters and sorts the complete player pool and keeps the view through history navigation', async () => withPage(360, async page => {
  await page.goto(new URL('/top-players', base).href);
  const goalkeepers = planning.players.filter(player => player.position === 'GK');
  await page.getByRole('button', { name: 'Goalkeepers', exact: true }).click();
  await page.getByLabel('Sort by').selectOption('price-asc');
  await page.waitForURL(url => url.searchParams.get('pos') === 'GK' && url.searchParams.get('sort') === 'price-asc');
  const expected = [...goalkeepers].sort((a, b) => a.price - b.price || a.playerName.localeCompare(b.playerName) || a.playerId - b.playerId);
  assert.equal(await page.locator('tbody a').first().innerText(), expected[0].playerName);
  assert.ok(await page.getByText(new RegExp(`of ${goalkeepers.length} players`)).isVisible());
  if (expected.length > 20) {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText(/Page 2 of/).waitFor();
    await page.locator('tbody a').first().click();
    await page.getByRole('heading', { name: expected[20].playerName }).waitFor();
    assert.ok(!(await page.getByText('Urgent', { exact: true }).count()));
    await page.goBack();
    await page.getByText(/Page 2 of/).waitFor();
  }
  await page.getByLabel('Club', { exact: true }).selectOption(expected[0].teamShortName);
  assert.equal(await page.locator('tbody a').first().innerText(), expected[0].playerName);
  await page.getByRole('searchbox', { name: 'Search players' }).fill('no such player in this dataset');
  await page.getByText('No players match these filters.').waitFor();
  await page.reload();
  await page.getByText('No players match these filters.').waitFor();
  await noOverflow(page);
}));

test('handles search races, unknown players and a catalog rate limit without losing navigation', async () => withPage(360, async page => {
  const [first, second] = planning.players.filter(player => player.fixtureCount);
  const body = player => ({ success: true, data: [{ id: player.playerId, name: player.playerName,
    teamShort: player.teamShortName, pos: player.position, price: player.price }] });
  await page.route('**/api/players/search?*', async route => {
    const name = new URL(route.request().url()).searchParams.get('name');
    if (name === 'older') await delay(700);
    await route.fulfill({ json: body(name === 'older' ? first : second) }).catch(() => {});
  });
  await page.goto(base);
  const search = page.getByRole('searchbox', { name: 'Find a player' });
  const older = page.waitForRequest(r => r.url().includes('name=older'));
  await search.fill('older');
  await older;
  await search.fill('newer');
  await page.getByRole('link', { name: new RegExp(second.playerName.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&')) }).waitFor();
  await delay(750);
  assert.equal(await page.getByRole('list', { name: 'Player search results' }).locator('a').first().getAttribute('href'), `/player/${second.playerId}`);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: second.playerName, exact: true }).waitFor();
  await page.goto(new URL('/player/999999999', base).href);
  await page.getByRole('heading', { name: 'Player not found' }).waitFor();
  await page.goto(new URL('/missing-route', base).href);
  await page.getByRole('heading', { name: 'Page not found' }).waitFor();
  await page.route('**/api/players', route => route.fulfill({
    status: 429, headers: { 'Retry-After': '60' }, json: { success: false, error: 'Rate limited' }
  }), { times: 1 });
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Squad' }).click();
  await page.getByText(/Request limit reached/).waitFor();
  await page.getByRole('button', { name: 'Retry player list' }).click();
  await page.getByRole('button', { name: /^Add / }).first().waitFor();
}));

test('imports a preview, recovers from invalid and partial picks, and requires owned finances', async () => withPage(1440, async page => {
  if (fixture) await page.route('**/api/predictions/planning', route =>
    route.fulfill({ json: { success: true, data: { ...planning, source: 'fpl' } } }));
  const toSlot = slot => ({ id: slot.playerId, name: slot.playerName, pos: slot.position, price: slot.price,
    teamId: slot.teamId, teamShort: slot.teamShortName });
  const squad = { mode: 'existing', bank: 0, startingXI: draft.startingXi.starters.map(toSlot), bench: draft.startingXi.bench.map(toSlot) };
  let requests = 0;
  await page.route('**/api/entries/import', async route => {
    requests++;
    const { entryId } = route.request().postDataJSON();
    if (entryId === 2) return route.fulfill({ status: 404, json: { error: 'Team ID was not found' } });
    if (entryId === 3) return route.fulfill({ status: 409, json: { error: 'FPL did not return all 15 picks' } });
    await delay(300);
    return route.fulfill({ json: { success: true, data: { squad, gameweekId: 10, season: 'Fixture season' } } });
  });
  await page.goto(new URL('/squad', base).href);
  await page.getByText('Import public FPL picks', { exact: true }).click();
  const input = page.getByLabel('FPL team ID');
  const submit = page.getByRole('button', { name: 'Look up picks' });
  await input.fill('nope');
  await submit.click();
  await page.getByText(/Enter the numeric team ID/).waitFor();
  assert.equal(requests, 0);
  await input.fill('2');
  await submit.click();
  await page.getByText('Team ID was not found').waitFor();
  await input.fill('3');
  await submit.click();
  await page.getByText('FPL did not return all 15 picks').waitFor();
  await input.fill('1');
  await submit.click();
  assert.ok(await page.getByRole('button', { name: 'Looking up picks…' }).isDisabled());
  await page.getByRole('button', { name: 'Use these picks' }).click();
  assert.equal(requests, 3);
  await page.getByRole('heading', { name: 'Your squad 15/15' }).waitFor();
  assert.equal(await page.getByLabel('Bank (£m)').inputValue(), '');
  await page.getByRole('link', { name: 'Review gameweek plan' }).first().click();
  await page.getByText(/Enter a current bank balance/).waitFor();
  await page.getByLabel('Free transfers').selectOption('1');
  assert.ok(await page.getByRole('button', { name: 'Compare transfers', exact: true }).isDisabled());
  await page.getByRole('link', { name: 'Edit squad', exact: true }).first().click();
  await page.getByLabel('Bank (£m)').fill('0.7');
  for (const player of [...squad.startingXI, ...squad.bench]) {
    await page.getByLabel(`Selling price for ${player.name} (£m)`, { exact: true }).fill((player.price - 0.1).toFixed(1));
  }
  await page.getByText('Import public FPL picks', { exact: true }).click();
  await input.fill('1');
  await submit.click();
  await page.getByRole('button', { name: 'Replace saved squad' }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  assert.equal(await page.getByLabel('Bank (£m)').inputValue(), '0.7');
  await page.getByRole('link', { name: 'Review gameweek plan' }).first().click();
  await page.getByLabel('Free transfers').selectOption('0');
  await page.getByLabel('Maximum hit').selectOption('1');
  const response = page.waitForResponse(r => r.url().endsWith('/api/optimizer/transfers'));
  await page.getByRole('button', { name: 'Compare transfers', exact: true }).click();
  assert.equal((await response).status(), 200);
}));

test('drops an older ranking while gameweek data refreshes', async () => withPage(360, async page => {
  await page.goto(new URL('/top-players', base).href);
  await page.locator('tbody a').first().waitFor();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/predictions/planning', async route => {
    await held;
    return route.fulfill({ json: { success: true, data: { ...planning, players: [],
      gameweek: { ...planning.gameweek, id: planning.gameweek.id + 1, runId: null } } } });
  });
  await page.getByRole('button', { name: 'Refresh gameweek data' }).click();
  assert.equal(await page.locator('tbody a').count(), 0);
  release();
  await page.getByText('Waiting for gameweek projections').waitFor();
  assert.equal(await page.locator('tbody a').count(), 0);
  await noOverflow(page);
}));

test('matches double fixtures, zero availability and blank teams in the database fixture', { skip: !fixture }, async () => {
  const player = planning.players.find(row => row.playerId === 102);
  assert.equal(player.fixtureCount, 2);
  const response = await fetch(new URL('/api/predictions/latest', base));
  const { predictions } = (await response.json()).data;
  const rows = predictions.filter(row => row.playerId === player.playerId);
  assert.deepEqual(rows.map(row => row.fixtureId).sort(), [11, 15]);
  assert.equal(player.predictedPoints, Math.round(rows.reduce((sum, row) => sum + row.predictedPoints, 0) * 100) / 100);
  assert.equal(planning.players.find(row => row.playerId === 101).predictedPoints, 0);
  const blank = planning.players.find(row => row.playerId === 1001);
  assert.equal(blank.fixtureCount, 0);
  assert.equal(blank.predictedPoints, 0);
  await withPage(360, async page => {
    await page.goto(new URL('/player/1001', base).href);
    await page.getByText('No fixture', { exact: true }).waitFor();
    await page.getByText('0.0 pts').waitFor();
    await page.route('**/api/predictions/planning', route => route.fulfill({
      json: { success: true, data: { ...planning, players: planning.players.filter(row => row.playerId !== 102), missingPlayerCount: 1 } }
    }));
    await page.goto(new URL('/player/102', base).href);
    await page.getByText('Projection unavailable', { exact: true }).waitFor();
    await page.getByText('1 player lacks full projections', { exact: true }).waitFor();
  });
});
