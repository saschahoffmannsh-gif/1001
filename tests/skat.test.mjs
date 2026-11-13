import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../supabase/functions/tu/skat.js';
import * as AI from '../src/game/skatai.js';

const rnd = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const shuffle = (a, r) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const herz = { type: 'suit', suit: 'H' }, grand = { type: 'grand' }, nul = { type: 'null' };

test('Skat: Blatt 32 Steine, 120 Augen, Geben 10/10/10 + Skat 2', () => {
  assert.equal(S.DECK.length, 32); assert.equal(S.eyesOf(S.DECK), 120);
  const s = S.newDeal({ n: 3, dealer: 2, deck: S.DECK });
  assert.deepEqual(s.order, [0, 1, 2]);
  assert.deepEqual(s.hands.map((h) => h.length), [10, 10, 10]);
  assert.equal(s.skat.length, 2);
  // 3 – Skat – 4 – 3: Vorhand bekommt die ersten drei Steine
  assert.deepEqual(s.hands[0].slice(0, 3), S.DECK.slice(0, 3));
  assert.deepEqual(s.skat, S.DECK.slice(9, 11));
});

test('Skat: Buben-Reihenfolge und Trumpf im Farbspiel', () => {
  const order = ['CJ', 'SJ', 'HJ', 'DJ', 'HA', 'H10', 'HK', 'HQ', 'H9', 'H8', 'H7'];
  for (let i = 0; i + 1 < order.length; i++) assert.ok(S.power(order[i], herz) > S.power(order[i + 1], herz), order[i]);
  assert.ok(S.isTrump('DJ', herz) && S.isTrump('H7', herz) && !S.isTrump('SA', herz));
  // Herz-Sieben sticht Pik-Ass
  assert.equal(S.trickWinner([{ p: 0, card: 'SA' }, { p: 1, card: 'H7' }, { p: 2, card: 'S10' }], herz), 1);
  // Karo-Bube sticht Herz-Ass
  assert.equal(S.trickWinner([{ p: 0, card: 'HA' }, { p: 1, card: 'DJ' }, { p: 2, card: 'H10' }], herz), 1);
  // Farbe: Zehn über König
  assert.equal(S.trickWinner([{ p: 0, card: 'CK' }, { p: 1, card: 'C10' }, { p: 2, card: 'CQ' }], herz), 1);
});

test('Skat: Grand – nur die vier Buben sind Trumpf', () => {
  assert.ok(S.isTrump('DJ', grand) && !S.isTrump('HA', grand));
  assert.equal(S.trickWinner([{ p: 0, card: 'HA' }, { p: 1, card: 'C7' }, { p: 2, card: 'H10' }], grand), 0);
  assert.equal(S.trickWinner([{ p: 0, card: 'HA' }, { p: 1, card: 'DJ' }, { p: 2, card: 'SJ' }], grand), 2);
});

test('Skat: Null – kein Trumpf, A K D B 10 9 8 7', () => {
  const order = ['HA', 'HK', 'HQ', 'HJ', 'H10', 'H9', 'H8', 'H7'];
  for (let i = 0; i + 1 < order.length; i++) assert.ok(S.power(order[i], nul) > S.power(order[i + 1], nul));
  assert.ok(!S.isTrump('CJ', nul));
  assert.equal(S.trickWinner([{ p: 0, card: 'H10' }, { p: 1, card: 'HJ' }, { p: 2, card: 'CJ' }], nul), 1);
});

test('Skat: Bedienen – Buben gehören zum Trumpf, nicht zu ihrer Farbe', () => {
  const hand = ['SJ', 'S7', 'HA', 'D9'];
  assert.deepEqual(S.legalCards(hand, [{ p: 0, card: 'SA' }], herz), ['S7']);
  assert.deepEqual(S.legalCards(hand, [{ p: 0, card: 'H7' }], herz).sort(), ['HA', 'SJ']);
  assert.deepEqual(S.legalCards(hand, [{ p: 0, card: 'CJ' }], grand), ['SJ']);
  assert.deepEqual(S.legalCards(hand, [{ p: 0, card: 'S8' }], nul).sort(), ['S7', 'SJ']);
  assert.deepEqual(S.legalCards(hand, [{ p: 0, card: 'C8' }], herz).sort(), hand.slice().sort());
});

test('Skat: Reizwerte und Reizfolge (Mittelhand sagt, Vorhand hört, dann Hinterhand)', () => {
  assert.deepEqual(S.BIDS.slice(0, 12), [18, 20, 22, 23, 24, 27, 30, 33, 35, 36, 40, 44]);
  assert.equal(S.BIDS.at(-1), 264);
  let s = S.newDeal({ n: 3, dealer: 2, deck: S.DECK });           // VH 0, MH 1, HH 2
  assert.deepEqual(S.bidTurn(s), { p: 1, role: 'say', value: 18 });
  s = S.applyBid(s, 1, 'say'); assert.deepEqual(S.bidTurn(s), { p: 0, role: 'answer', value: 18 });
  s = S.applyBid(s, 0, 'yes'); assert.equal(S.bidTurn(s).value, 20);
  s = S.applyBid(s, 1, 'say'); s = S.applyBid(s, 0, 'pass');      // VH weg bei 20
  assert.deepEqual(S.bidTurn(s), { p: 2, role: 'say', value: 22 });
  s = S.applyBid(s, 2, 'pass');
  assert.equal(s.phase, 'skat'); assert.equal(s.declarer, 1); assert.equal(s.bid, 20);
  assert.throws(() => S.applyBid(s, 2, 'say'));
  // Hinterhand übernimmt
  let t = S.newDeal({ n: 3, dealer: 2, deck: S.DECK });
  t = S.applyBid(t, 1, 'pass'); t = S.applyBid(t, 2, 'say'); t = S.applyBid(t, 0, 'pass');
  assert.equal(t.declarer, 2); assert.equal(t.bid, 18);
  // Alle passen -> Vorhand darf 18 sagen; passt sie auch: Ramsch
  let u = S.newDeal({ n: 3, dealer: 2, deck: S.DECK });
  u = S.applyBid(u, 1, 'pass'); u = S.applyBid(u, 2, 'pass');
  assert.deepEqual(S.bidTurn(u), { p: 0, role: 'say', value: 18 });
  const u1 = S.applyBid(u, 0, 'say'); assert.equal(u1.declarer, 0); assert.equal(u1.bid, 18);
  const u2 = S.applyBid(u, 0, 'pass'); assert.equal(u2.game.type, 'ramsch'); assert.equal(u2.phase, 'play'); assert.equal(u2.turn, 0);
});

test('Skat: Spielwerte – Spitzen mit/ohne, Hand, Schneider, Schwarz, Ouvert, Null', () => {
  const kreuz = { type: 'suit', suit: 'C' };
  assert.deepEqual(S.matadors(['CJ', 'SJ', 'DJ', 'CA'], kreuz), { with: true, n: 2 });
  assert.deepEqual(S.matadors(['HJ', 'DJ', 'CA'], kreuz), { with: false, n: 2 });
  assert.deepEqual(S.matadors(['CJ', 'SJ', 'HJ', 'DJ', 'CA', 'C10', 'C7'], kreuz), { with: true, n: 6 });
  assert.equal(S.baseValue(kreuz, ['CJ', 'SJ', 'C7']), 36);                     // mit 2, Spiel 3 × 12
  assert.equal(S.baseValue({ ...herz, hand: true }, ['DJ', 'H7']), 10 * 5);    // ohne 3, Spiel 4, Hand 5 × 10
  assert.equal(S.baseValue({ type: 'grand', hand: true, schneider: true }, ['CJ']), 24 * 5); // mit 1, Spiel, Hand, Schneider, angesagt
  const g = S.normalizeGame({ type: 'suit', suit: 'S', hand: true, ouvert: true });
  assert.ok(g.schwarz && g.schneider && g.hand);
  assert.throws(() => S.normalizeGame({ type: 'suit', suit: 'S', hand: false, schneider: true }));
  assert.deepEqual([S.nullValue({}), S.nullValue({ hand: true }), S.nullValue({ ouvert: true }), S.nullValue({ ouvert: true, hand: true })], [23, 35, 46, 59]);
});

// Kleine Hilfe: fertige Runde direkt abrechnen
function scored({ n = 3, declarer = 0, game, bid = 18, declHand, skat = ['D7', 'D8'], dEyes, dTricks, kontra = 0 }) {
  const order = n === 3 ? [0, 1, 2] : [1, 2, 3];
  const taken = Array.from({ length: n }, () => []);
  // Augen künstlich verteilen: Alleinspieler bekommt Steine bis dEyes
  const pool = S.DECK.filter((c) => !skat.includes(c)).sort((a, b) => S.eyes(b) - S.eyes(a));
  let e = 0; for (const c of pool) { if (e + S.eyes(c) <= dEyes) { taken[declarer].push(c); e += S.eyes(c); } }
  const rest = pool.filter((c) => !taken[declarer].includes(c));
  const def = order.find((p) => p !== declarer); taken[def].push(...rest);
  const tricks = []; for (let i = 0; i < 10; i++) tricks.push({ winner: i < dTricks ? declarer : def, cards: [] });
  return S.score({ n, order, declarer, game: S.normalizeGame(game), bid, kontra, skat, taken, tricks, initial: { hands: Object.assign([], { [declarer]: declHand }), skat } });
}

test('Skat: Abrechnung gewonnen / verloren / Kontra / überreizt (Turnierpunkte)', () => {
  const kreuz = { type: 'suit', suit: 'C' };
  // Kreuz mit 2, gewonnen mit 70 Augen: 36 -> +86
  const a = scored({ game: kreuz, declHand: ['CJ', 'SJ', 'C7'], dEyes: 70, dTricks: 6 });
  assert.equal(a.won, true); assert.equal(a.value, 36); assert.deepEqual(a.tp, [86, 0, 0]); assert.deepEqual(a.win, [true, false, false]);
  // verloren mit 60 Augen: −(2×36+50) = −122, Gegenspieler je +40, Sieg für beide Gegenspieler
  const b = scored({ game: kreuz, declHand: ['CJ', 'SJ', 'C7'], dEyes: 60, dTricks: 5 });
  assert.equal(b.won, false); assert.deepEqual(b.tp, [-122, 40, 40]); assert.deepEqual(b.loss, [true, false, false]); assert.deepEqual(b.win, [false, true, true]);
  // verloren mit Kontra: Spielwert doppelt -> −(2×72+50) = −194
  const c = scored({ game: kreuz, declHand: ['CJ', 'SJ', 'C7'], dEyes: 55, dTricks: 5, kontra: 1 });
  assert.equal(c.factor, 2); assert.equal(c.tp[0], -194);
  // gewonnen mit Re: 36×4+50
  const r = scored({ game: kreuz, declHand: ['CJ', 'SJ', 'C7'], dEyes: 80, dTricks: 7, kontra: 2 });
  assert.equal(r.tp[0], 36 * 4 + 50);
  // Schneider gewonnen: mit 2, Spiel, Schneider = 4 × 12 = 48
  const d = scored({ game: kreuz, declHand: ['CJ', 'SJ', 'C7'], dEyes: 95, dTricks: 8 });
  assert.equal(d.schneider, true); assert.equal(d.value, 48);
  // Schwarz: alle Stiche, alle Augen
  const e = scored({ game: kreuz, declHand: ['CJ', 'SJ', 'C7'], dEyes: 117, dTricks: 10 });
  assert.equal(e.schwarz, true); assert.equal(e.value, 12 * 5);
  // Selbst Schneider (≤30) beim Verlieren zählt mit
  const f = scored({ game: kreuz, declHand: ['CJ', 'SJ', 'C7'], dEyes: 30, dTricks: 3 });
  assert.equal(f.value, 48); assert.equal(f.tp[0], -(2 * 48 + 50));
  // überreizt: Reiz 40, Kreuz mit 1 = 24 -> verloren, Wert nächstes Vielfaches von 12 ≥ 40 = 48
  const g = scored({ game: kreuz, bid: 40, declHand: ['CJ', 'HJ', 'C7'], dEyes: 80, dTricks: 7 });
  assert.equal(g.overbid, true); assert.equal(g.won, false); assert.equal(g.value, 48);
  // 4er-Tisch: verloren -> alle drei anderen +30, aussetzender Geber ohne Sieg/Niederlage
  const h = scored({ n: 4, declarer: 1, game: kreuz, declHand: ['CJ', 'SJ', 'C7'], dEyes: 50, dTricks: 4 });
  assert.deepEqual(h.tp, [30, -122, 30, 30]); assert.deepEqual(h.win, [false, false, true, true]); assert.deepEqual(h.loss, [false, true, false, false]);
});

test('Skat: Null endet mit dem ersten Stich des Alleinspielers (verloren)', () => {
  // Alleinspieler (Vorhand 0) hat nur hohe Herz-Steine und spielt Null: erster Stich geht an ihn
  const hands = [
    ['HA', 'HK', 'HQ', 'HJ', 'H10', 'CA', 'CK', 'CQ', 'CJ', 'C10'],
    ['H9', 'H8', 'C9', 'C8', 'SA', 'SK', 'SQ', 'SJ', 'S10', 'S9'],
    ['H7', 'C7', 'S8', 'S7', 'DA', 'DK', 'DQ', 'DJ', 'D10', 'D9'],
  ];
  let s = S.fromHands({ n: 3, dealer: 2, hands, skat: ['D8', 'D7'] });
  s = S.applyBid(s, 1, 'pass'); s = S.applyBid(s, 2, 'pass'); s = S.applyBid(s, 0, 'say');
  s = S.chooseSkat(s, 0, false); s = S.announce(s, 0, { type: 'null' });
  assert.throws(() => S.announce(s, 0, { type: 'null' }));
  s = S.applyKontra(s, 1, false); s = S.applyKontra(s, 2, false);
  assert.equal(s.phase, 'play'); assert.equal(s.turn, 0);
  for (const [p, c] of [[0, 'HA'], [1, 'H9'], [2, 'H7']]) s = S.playCard(s, p, c).state;
  assert.equal(s.phase, 'done');
  assert.equal(s.result.won, false); assert.equal(s.result.value, 35);          // Null Hand
  assert.deepEqual(s.result.tp, [-(2 * 35 + 50), 40, 40]);
});

test('Skat: Ramsch – meiste Augen verliert, Jungfrau verdoppelt, Durchmarsch +120', () => {
  const mk = (takenBy, pts) => {
    const order = [0, 1, 2], taken = [[], [], []];
    const pool = S.DECK.slice().sort((a, b) => S.eyes(b) - S.eyes(a));
    for (const p of [0, 1]) { let e = 0; for (const c of pool) if (!taken.flat().includes(c) && e + S.eyes(c) <= pts[p]) { taken[p].push(c); e += S.eyes(c); } }
    taken[2] = pool.filter((c) => !taken.flat().includes(c) && !['D7', 'D8'].includes(c));
    return S.score({ n: 3, order, game: { type: 'ramsch' }, taken, skat: ['D7', 'D8'], tricks: takenBy.map((w) => ({ winner: w })), kontra: 0, initial: {} });
  };
  const a = mk([0, 1, 2, 0, 1, 2, 0, 1, 2, 2], [30, 40]);    // 2 hat 50
  assert.deepEqual(a.losers, [2]); assert.equal(a.tp[2], -50); assert.equal(a.jungfrau, 0); assert.deepEqual(a.win, [false, false, false]);
  const b = mk([1, 2, 1, 2, 1, 2, 1, 2, 1, 2], [0, 70]);     // 0 Jungfrau, 1 hat 70
  assert.equal(b.jungfrau, 1); assert.deepEqual(b.losers, [1]); assert.equal(b.tp[1], -140);
  const c = mk(new Array(10).fill(0), [120, 0]);
  assert.equal(c.durchmarsch, 0); assert.deepEqual(c.tp, [120, 0, 0]);
});

test('Skat: komplette Runde zu dritt mit Computern, Nachspielen ergibt dasselbe', () => {
  const r = rnd(7);
  for (let i = 0; i < 40; i++) {
    let s = S.newDeal({ n: 3, dealer: i % 3, deck: shuffle(S.DECK, r) });
    s = AI.autoDeal(s);
    assert.equal(s.phase, 'done');
    const played = s.tricks.flatMap((t) => t.cards.map((x) => x.card));
    if (s.game.type !== 'null') { assert.equal(played.length, 30); assert.equal(new Set(played).size, 30); }
    if (s.game.type !== 'ramsch' && s.game.type !== 'null') {
      const d = s.declarer; const def = S.eyesOf(s.order.filter((p) => p !== d).flatMap((p) => s.taken[p]));
      assert.equal(s.result.points + def, 120);
    }
    assert.deepEqual(S.replayDeal(3, S.dealRecord(s)), s.result);
  }
});

test('Skat: zu viert setzt der Geber aus und bekommt weder Steine noch Sieg/Niederlage', () => {
  const r = rnd(11);
  for (let dealer = 0; dealer < 4; dealer++) {
    let s = S.newDeal({ n: 4, dealer, deck: shuffle(S.DECK, r) });
    assert.equal(s.sitting, dealer); assert.equal(s.hands[dealer].length, 0); assert.ok(!s.order.includes(dealer));
    assert.deepEqual(s.order, [1, 2, 3].map((k) => (dealer + k) % 4));
    s = AI.autoDeal(s);
    assert.ok(!s.tricks.some((t) => t.cards.some((x) => x.p === dealer)));
    assert.equal(s.result.win[dealer], false); assert.equal(s.result.loss[dealer], false);
    if (s.result.type !== 'ramsch' && !s.result.won) assert.equal(s.result.tp[dealer], 30);
  }
});

test('Skat: Serie über 12 Spiele wird vom Server-Prüfer nachgerechnet, Manipulation fällt auf', () => {
  const r = rnd(5);
  for (const n of [3, 4]) {
    let m = S.newMatch(n); const recs = [];
    for (let i = 0; i < S.MATCH_DEALS; i++) {
      let s = S.newDeal({ n, dealer: S.dealerFor(m, i), deck: shuffle(S.DECK, r) });
      s = AI.autoDeal(s); const rec = S.dealRecord(s); recs.push(rec); m = S.addDeal(m, s.result, rec);
    }
    assert.ok(m.done);
    const v = S.verifyMatch(n, recs);
    assert.deepEqual(v.totals, m.totals); assert.deepEqual(v.wins, m.wins); assert.deepEqual(v.losses, m.losses);
    const bad = JSON.parse(JSON.stringify(recs)); bad[3].plays.reverse();
    assert.throws(() => S.verifyMatch(n, bad));
    const bad2 = JSON.parse(JSON.stringify(recs)); bad2[0].dealer = (bad2[0].dealer + 1) % n;
    assert.throws(() => S.verifyMatch(n, bad2), /Geber/);
    assert.throws(() => S.verifyMatch(n, recs.slice(0, 5)), /12/);
    const bad3 = JSON.parse(JSON.stringify(recs)); const h = bad3[1].hands.find((x) => x.length); h[0] = h[1];
    assert.throws(() => S.verifyMatch(n, bad3));
  }
  assert.throws(() => S.verifyMatch(2, []));
});
