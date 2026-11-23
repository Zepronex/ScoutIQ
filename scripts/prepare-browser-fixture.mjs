import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = process.argv[2];
if (!output) throw new Error('Pass a directory for the synthetic browser fixture.');

const day = 24 * 60 * 60 * 1000;
const now = Date.now();
const iso = days => new Date(now + day * days).toISOString();
const teams = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1, code: 100 + i, name: `Fixture Club ${i + 1}`, shortName: `T${i + 1}`,
  strength: null, strengthOverallHome: null, strengthOverallAway: null
}));
const events = [[10, -7], [11, 2], [12, 9]].map(([id, days]) => ({
  id, name: `Gameweek ${id}`, deadlineTime: iso(days), averageEntryScore: null, highestScore: null,
  finished: days < 0, dataChecked: days < 0, isCurrent: id === 10, isNext: id === 11
}));
const fixtures = [
  [10, 10, 1, 2, -6], [11, 11, 1, 2, 2.1], [12, 11, 3, 4, 2.1], [13, 11, 5, 6, 2.2],
  [14, 11, 7, 8, 2.2], [15, 11, 1, 9, 4], [16, 12, 10, 9, 9.1], [17, null, 10, 4, null]
].map(([id, eventId, teamHId, teamAId, days]) => ({
  id, code: id + 200, eventId, teamHId, teamAId, kickoffTime: days === null ? null : iso(days),
  teamHScore: days < 0 ? 1 : null, teamAScore: days < 0 ? 0 : null,
  teamHDifficulty: 3, teamADifficulty: 3, started: days < 0, finished: days < 0
}));
const positions = ['GK', 'DEF', 'MID', 'FWD'];
const players = teams.flatMap(team => positions.flatMap((position, index) =>
  Array.from({ length: 3 }, (_, i) => {
    const id = team.id * 100 + index * 10 + i + 1;
    const name = `${position} ${String(team.id).padStart(2, '0')}-${i + 1}`;
    const unavailable = id === 101;
    const points = (team.id + index + i) % 7 + 1;
    return {
      id, code: id + 1000, firstName: 'Fixture', secondName: name, webName: name, displayName: `Fixture ${name}`,
      teamId: team.id, position, nowCost: 4 + i / 2 + index / 2,
      status: unavailable ? 'i' : 'a', chanceOfPlayingNextRound: unavailable ? 0 : null,
      chanceOfPlayingThisRound: null, form: points, selectedByPercent: points, pointsPerGame: points,
      valueSeason: points, totalPoints: points, minutes: 90, starts: 1, expectedGoals: 0,
      expectedAssists: 0, expectedGoalInvolvements: 0, expectedGoalsConceded: 0
    };
  })
));

const manifest = {
  schemaVersion: 1, season: 'Fixture season', generatedAt: iso(-0.01), currentEventId: 10,
  sources: [],
  recordCounts: { players: players.length, teams: teams.length, events: events.length, fixtures: fixtures.length }
};

await mkdir(output, { recursive: true });
await Promise.all(Object.entries({ manifest, players, teams, events, fixtures }).map(([name, data]) =>
  writeFile(path.join(output, `${name}.json`), JSON.stringify(data, null, 2))
));
