import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMES, normGame, acceptsResults, isKnownGame, aggregateOverall, rankGame, applyResult } from '../supabase/functions/tu/ranking.js';

test('Nur 1001- und Skat-Ergebnisse werden angenommen', () => {
  assert.equal(acceptsResults('1001'), true);
  assert.equal(acceptsResults('skat'), true); assert.equal(acceptsResults('SKAT'), true);
  assert.equal(acceptsResults(undefined), true, 'ohne Angabe = 1001 (ältere Clients)');
  assert.equal(normGame(undefined), '1001');
  for (const g of ['romme', 'bridge', 'BRIDGE']) { assert.equal(isKnownGame(g), true); assert.equal(acceptsResults(g), false, g); }
  for (const g of ['poker', '', ' 1002', 42, null]) if (g !== '' && g !== null) assert.equal(acceptsResults(g), false, String(g));
  assert.deepEqual(Object.keys(GAMES), ['1001', 'romme', 'skat', 'bridge']);
});

const rows = [
  { profile_id: 'a', display_name: 'Anna', game: '1001', wins: 3, losses: 2, matches_played: 5, best_total: 1180, last_played_at: '2026-11-10T10:00:00Z' },
  { profile_id: 'a', display_name: 'Anna', game: 'skat', wins: 2, losses: 0, matches_played: 2, best_total: 0, last_played_at: '2026-11-11T10:00:00Z' },
  { profile_id: 'b', display_name: 'Ben', game: '1001', wins: 5, losses: 1, matches_played: 6, best_total: 1050, last_played_at: '2026-11-09T10:00:00Z' },
  { profile_id: 'c', display_name: 'Cem', game: '1001', wins: 5, losses: 4, matches_played: 9, best_total: 1240, last_played_at: '2026-11-12T10:00:00Z' },
  { profile_id: 'd', display_name: 'Dora', game: '1001', wins: 0, losses: 0, matches_played: 0, best_total: 0, last_played_at: null },
  { profile_id: 'e', display_name: 'Eli', game: 'poker', wins: 99, losses: 0, matches_played: 99, best_total: 0, last_played_at: null },
];

test('Gesamtrangliste: Summe der Siege über alle Spiele, dann weniger Niederlagen', () => {
  const o = aggregateOverall(rows);
  assert.deepEqual(o.map((r) => r.display_name), ['Ben', 'Anna', 'Cem']);
  assert.equal(o[1].wins, 5); assert.equal(o[1].losses, 2); assert.equal(o[1].matches_played, 7);
  assert.equal(o[1].last_played_at, '2026-11-11T10:00:00Z');
  assert.deepEqual(Object.keys(o[1].games).sort(), ['1001', 'skat']);
  assert.deepEqual(o.map((r) => r.rank), [1, 2, 3]);
  assert.ok(!o.some((r) => r.display_name === 'Dora'), 'ohne Partie nicht gelistet');
  assert.ok(!o.some((r) => r.display_name === 'Eli'), 'unbekanntes Spiel zählt nicht');
});

test('Gesamtrangliste: bei gleichen Siegen und Niederlagen zählt die jüngste Partie', () => {
  const o = aggregateOverall([
    { profile_id: 'x', display_name: 'Xaver', game: '1001', wins: 2, losses: 1, matches_played: 3, last_played_at: '2026-11-01T00:00:00Z' },
    { profile_id: 'y', display_name: 'Yara', game: '1001', wins: 2, losses: 1, matches_played: 3, last_played_at: '2026-11-05T00:00:00Z' },
  ]);
  assert.deepEqual(o.map((r) => r.display_name), ['Yara', 'Xaver']);
});

test('Rangliste je Spiel: Siege, dann beste Punktzahl', () => {
  const g = rankGame(rows, '1001');
  assert.deepEqual(g.map((r) => r.display_name), ['Cem', 'Ben', 'Anna']);
  assert.equal(g[0].best_total, 1240);
  assert.deepEqual(rankGame(rows, 'skat').map((r) => r.display_name), ['Anna']);
  assert.deepEqual(rankGame(rows, 'bridge'), []);
});

test('Zähler je Spiel nach einer Partie', () => {
  const s1 = applyResult(null, { won: true, deals: 7, total: 1010, at: 't1' });
  assert.deepEqual(s1, { matches_played: 1, wins: 1, losses: 0, deals_played: 7, best_total: 1010, last_played_at: 't1' });
  const s2 = applyResult(s1, { won: false, deals: 9, total: 880, at: 't2' });
  assert.deepEqual(s2, { matches_played: 2, wins: 1, losses: 1, deals_played: 16, best_total: 1010, last_played_at: 't2' });
});
