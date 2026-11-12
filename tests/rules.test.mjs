import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/game/rules.js';
import * as AI from '../src/game/ai.js';
import { playDeal } from '../tools/sim.mjs';
import { newBoard, openTrack, addTile } from '../src/game/tracks.js';

test('Blatt: 2 Spieler 24 Steine, 120 Augen', () => {
  const d = R.newDeck();
  assert.equal(d.length, 24); assert.equal(new Set(d).size, 24);
  assert.equal(R.cardPoints(d), 120);
});

test('Mischen: jede Runde neu, keine Wiederholung, gleichmäßig', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const s = R.shuffle(R.newDeck());
    assert.equal(new Set(s).size, 24);
    seen.add(s.join(''));
  }
  assert.equal(seen.size, 2000);
  // Position des Herz-Ass grob gleichverteilt
  const counts = new Array(24).fill(0);
  for (let i = 0; i < 24000; i++) counts[R.shuffle(R.newDeck()).indexOf('HA')]++;
  for (const c of counts) assert.ok(c > 700 && c < 1300, 'Verteilung ' + c);
});

test('Geben 3-2-3 und Stock 8', () => {
  const d = R.deal(0);
  assert.equal(d.hands[0].length, 8); assert.equal(d.hands[1].length, 8); assert.equal(d.stock.length, 8);
  assert.deepEqual(d.hands[0].slice(0, 3), d.deck.slice(0, 3));
  assert.deepEqual(d.hands[1].slice(0, 3), d.deck.slice(3, 6));
  assert.deepEqual(d.hands[0].slice(3, 5), d.deck.slice(6, 8));
});

test('Stichgewinner', () => {
  const W = (a, b, t) => R.trickWinner({ p: 0, card: a }, { p: 1, card: b }, t);
  assert.equal(W('HA', 'H9', null), 0);
  assert.equal(W('H9', 'HA', null), 1);
  assert.equal(W('H10', 'HK', null), 0);       // Zehn über König
  assert.equal(W('H7', 'H8', null), 1); assert.equal(W('H8', 'H9', null), 1); assert.equal(W('H9', 'H7', null), 0);
  assert.equal(W('HK', 'H10', null), 1);
  assert.equal(W('HA', 'C9', null), 0);        // abwerfen ohne Trumpf
  assert.equal(W('HA', 'C9', 'C'), 1);         // Trumpf sticht
  assert.equal(W('CA', 'C9', 'C'), 0);
});

test('Zulässige Züge: frei solange Stock, dann Farb-, Stich- und Trumpfzwang', () => {
  const hand = ['H9', 'HA', 'C10', 'SJ'];
  assert.deepEqual(R.legalMoves(hand, 'HK', null, false).sort(), hand.slice().sort());
  assert.deepEqual(R.legalMoves(hand, 'HK', null, true), ['HA']);          // muss überstechen
  assert.deepEqual(R.legalMoves(['H9', 'C10'], 'HK', null, true), ['H9']);  // bedienen
  assert.deepEqual(R.legalMoves(['C10', 'SJ'], 'HK', 'S', true), ['SJ']);   // Trumpfzwang
  assert.deepEqual(R.legalMoves(['C10', 'SJ'], 'HK', null, true).sort(), ['C10', 'SJ']);
});

test('Hochzeit: Werte, Trumpfwechsel, nicht doppelt, nur mit Stich', () => {
  assert.deepEqual(R.MARRIAGE, { D: 40, H: 60, S: 80, C: 100 });
  const dealt = { deck: [], hands: [['HK', 'HQ', 'CK', 'CQ', 'D9', 'DJ', 'S9', 'SJ'], ['HA', 'H10', 'CA', 'C10', 'DA', 'D10', 'SA', 'S10']], stock: ['H9', 'HJ', 'C9', 'CJ', 'DK', 'DQ', 'SK', 'SQ'] };
  let st = R.newDealState({ forehand: 0, dealt });
  st = R.applyBid(st, 0, 40); st = R.applyBid(st, 1, 50); st = R.applyBid(st, 0, 60); st = R.applyBid(st, 1, 'pass');
  assert.equal(st.contract.by, 0); assert.equal(st.leader, 0);
  assert.ok(R.canDeclare(st, 0, 'HQ'));
  assert.ok(!R.canDeclare(st, 0, 'D9'));
  let r = R.playCard(st, 0, 'HQ', { declare: true });
  assert.equal(r.state.trump, 'H');
  assert.equal(r.events[0].points, 60);
  st = R.playCard(r.state, 1, 'HA').state;          // Computer sticht mit Herz-Ass
  assert.equal(st.leader, 1);
  assert.ok(!R.canDeclare(st, 0, 'HK'));             // nicht am Zug
  assert.equal(st.declared.H, 0);
});

test('Hochzeit zählt nicht ohne Stich, Reiz verfehlt = Minus', () => {
  const st = { taken: [[], ['HA', 'H10']], tricks: [0, 1], melds: [['C'], []], contract: { by: 0, value: 120 } };
  const res = R.scoreDeal(st);
  assert.equal(res.meldPoints[0], 0); assert.equal(res.lostMelds[0], 100);
  assert.equal(res.made, false); assert.equal(res.delta[0], -120); assert.equal(res.delta[1], 21);
  const st2 = { taken: [['HA', 'H10', 'CA'], ['S9']], tricks: [2, 1], melds: [['C'], []], contract: { by: 0, value: 120 } };
  const res2 = R.scoreDeal(st2);
  assert.equal(res2.points[0], 132); assert.equal(res2.made, true); assert.equal(res2.delta[0], 132);
});

test('Reizrunde: nacheinander, immer genau +10', () => {
  let a = R.newAuction(0);
  assert.deepEqual(R.auctionOptions(a), [40]);
  a = R.auctionAct(a, 0, 40); assert.deepEqual(R.auctionOptions(a), [50]);
  a = R.auctionAct(a, 1, 50); assert.deepEqual(R.auctionOptions(a), [60]);
  a = R.auctionAct(a, 0, 60); a = R.auctionAct(a, 1, 'pass');
  assert.equal(a.done, true); assert.equal(a.winner, 0); assert.equal(a.value, 60);
  assert.throws(() => R.auctionAct(R.auctionAct(R.newAuction(0), 0, 40), 1, 60));    // kein Springen
  assert.throws(() => R.auctionAct(R.auctionAct(R.newAuction(0), 0, 40), 1, 140));
  assert.throws(() => R.auctionAct(R.newAuction(0), 0, 50));                         // Eröffnung ist 40
  assert.throws(() => R.auctionAct(R.newAuction(0), 1, 40));                         // nicht am Zug
  let b = R.auctionAct(R.newAuction(1), 1, 'pass');      // Vorhand passt
  b = R.auctionAct(b, 0, 40);                            // der andere reizt 40
  assert.equal(b.done, true); assert.equal(b.winner, 0); assert.equal(b.value, 40);
  let c = R.auctionAct(R.newAuction(1), 1, 'pass'); c = R.auctionAct(c, 0, 'pass');
  assert.equal(c.winner, 1); assert.equal(c.value, 40); assert.equal(c.forced, true);
});

test('Reizrunde mit 3 Spielern reihum', () => {
  let a = R.newAuction(1, 3);
  a = R.auctionAct(a, 1, 40); a = R.auctionAct(a, 2, 50); a = R.auctionAct(a, 0, 'pass');
  a = R.auctionAct(a, 1, 60); assert.equal(a.turn, 2);   // Spieler 0 ist raus
  a = R.auctionAct(a, 2, 'pass');
  assert.equal(a.done, true); assert.equal(a.winner, 1); assert.equal(a.value, 60);
  let b = R.newAuction(0, 3); b = R.auctionAct(b, 0, 'pass'); b = R.auctionAct(b, 1, 'pass'); b = R.auctionAct(b, 2, 'pass');
  assert.equal(b.winner, 0); assert.equal(b.value, 40); assert.equal(b.forced, true);
  let c = R.newAuction(0, 3); c = R.auctionAct(c, 0, 'pass'); c = R.auctionAct(c, 1, 'pass'); c = R.auctionAct(c, 2, 40);
  assert.equal(c.done, true); assert.equal(c.winner, 2);
  // Computer reizt nur +10 oder passt
  const st = R.newDealState({ forehand: 0, players: 3 });
  const x = AI.chooseBid(st, 0); assert.ok(x === 'pass' || x === 40);
});

test('Computer spielt nur zulässige Züge und eine komplette Runde endet korrekt', () => {
  for (let i = 0; i < 150; i++) {
    const { st } = playDeal(i % 2);
    assert.equal(st.phase, 'done');
    assert.equal(st.history.length, 12);
    assert.equal(st.taken[0].length + st.taken[1].length, 24);
    assert.equal(R.cardPoints(st.taken[0]) + R.cardPoints(st.taken[1]), 120);
    assert.ok(st.contract.value >= 40);
  }
});

test('Skript-Partie bis 1001 – Sieger wird ermittelt', () => {
  let m = R.newMatch(); let n = 0;
  while (m.winner === null && n < 200) {
    const fh = m.nextForehand;
    const { st } = playDeal(fh);
    m = R.applyDealResult(m, st.result, fh); n++;
  }
  assert.ok(m.winner === 0 || m.winner === 1, 'Sieger');
  assert.ok(m.totals[m.winner] >= 1001);
  console.log('Partie:', n, 'Runden, Stand', m.totals.join(':'), 'Sieger', R.PLAYER_NAME[m.winner]);
});

test('Spuren: Steine belegen freie Felder', () => {
  let b = newBoard();
  const cells = new Set();
  for (let t = 0; t < 12; t++) {
    if (t % 2 === 0) b = openTrack(b, t % 2);
    for (const c of ['a', 'b']) { const r = addTile(b, c); b = r.board; cells.add(r.cell.join(',')); }
  }
  assert.equal(cells.size, 24);
});

test('Computer reizt mit starker Hand, passt mit schwacher', () => {
  const strong = ['CK', 'CQ', 'SK', 'SQ', 'HA', 'DA', 'H10', 'CA'];
  const weak = ['H9', 'D9', 'SJ', 'CJ', 'HJ', 'D J'.replace(' ', ''), 'S9', 'C9'];
  assert.ok(AI.maxBidFor(strong) >= 200);
  assert.ok(AI.maxBidFor(weak) < 60);
});

test('Ab 3 Spielern 32 Steine mit 7 und 8 (je 0 Augen, unter der Neun)', () => {
  const d2 = R.newDeck(2), d3 = R.newDeck(3), d4 = R.newDeck(4);
  assert.equal(d2.length, 24); assert.ok(!d2.some((c) => R.rankOf(c) === '7' || R.rankOf(c) === '8'));
  assert.equal(d3.length, 32); assert.equal(d4.length, 32); assert.equal(new Set(d3).size, 32);
  for (const s of R.SUITS) { assert.ok(d3.includes(s + '7')); assert.ok(d3.includes(s + '8')); }
  assert.equal(R.cardPoints(d3), 120);
  assert.equal(R.valueOf('H7'), 0); assert.equal(R.valueOf('S8'), 0);
  assert.ok(R.strength('C9') > R.strength('C8') && R.strength('C8') > R.strength('C7'));
  assert.deepEqual(R.RANKS, ['A', '10', 'K', 'Q', 'J', '9', '8', '7']);
  assert.equal(R.newDealState({ forehand: 0, players: 2 }).deck.length, 24);
  assert.equal(R.newDealState({ forehand: 0, players: 3 }).deck.length, 32);
  const g3 = R.deal(0, undefined, 3); assert.deepEqual(g3.hands.map((h) => h.length), [10, 10, 10]); assert.equal(g3.stock.length, 2);
  assert.deepEqual(g3.hands[0].slice(0, 3), g3.deck.slice(0, 3)); assert.deepEqual(g3.hands[1].slice(0, 3), g3.deck.slice(3, 6));
  assert.deepEqual(g3.hands[0].slice(3, 7), g3.deck.slice(9, 13));          // zweites Paket: 4
  const g4 = R.deal(1, undefined, 4); assert.deepEqual(g4.hands.map((h) => h.length), [8, 8, 8, 8]); assert.equal(g4.stock.length, 0);
  assert.equal(new Set([...g3.hands.flat(), ...g3.stock]).size, 32);
});

test('Zulässige Züge mit 7/8 und 3er-Stich', () => {
  assert.deepEqual(R.legalMoves(['H7', 'H8', 'C9'], ['H9'], null, true), ['H7', 'H8']);          // bedienen
  assert.deepEqual(R.legalMoves(['H7', 'HJ', 'C9'], ['H8'], null, true), ['HJ']);                // überstechen
  assert.deepEqual(R.legalMoves(['H7', 'H8', 'C9'], ['H8'], null, false).length, 3);             // Stock da: frei (2 Spieler)
  assert.deepEqual(R.legalMoves(['H7', 'HA'], ['H9', 'S7'], 'S', true).sort(), ['H7', 'HA']);    // Trumpf liegt vorn: nur bedienen
  assert.deepEqual(R.legalMoves(['C7', 'S8', 'SA'], ['H9', 'S9'], 'S', true), ['SA']);           // übertrumpfen
  assert.deepEqual(R.legalMoves(['C7', 'S8'], ['H9', 'SA'], 'S', true), ['S8']);                 // trumpfen, auch wenn nicht drüber
  assert.equal(R.trickWinner([{ p: 0, card: 'H8' }, { p: 1, card: 'H7' }, { p: 2, card: 'H9' }], null), 2);
  assert.equal(R.trickWinner([{ p: 1, card: 'HA' }, { p: 2, card: 'S7' }, { p: 0, card: 'H10' }], 'S'), 2);
  assert.equal(R.trickWinner([{ p: 2, card: 'HA' }, { p: 0, card: 'C7' }, { p: 1, card: 'C8' }], null), 2);
  assert.equal(R.trickWinner([{ p: 2, card: 'H7' }, { p: 0, card: 'H8' }, { p: 1, card: 'C8' }], null), 0);
});

test('3 Spieler: Talon an Reizgewinner, 2 drücken, 10 Stiche, Wertung', () => {
  for (let i = 0; i < 60; i++) {
    const { st } = playDeal(i % 3, false, AI.chooseBid, 3);
    assert.equal(st.phase, 'done');
    assert.equal(st.history.length, 10);
    assert.ok(st.history.every((h) => h.cards.length === 3));
    assert.equal(st.discard.length, 2);
    assert.equal(st.taken.flat().length, 32);
    assert.equal(R.cardPoints(st.taken.flat()), 120);
    const b = st.contract.by;
    for (const c of st.discard) assert.ok(st.taken[b].includes(c));
    for (let p = 0; p < 3; p++) if (p !== b) assert.equal(st.result.delta[p], st.result.points[p]);
    assert.equal(st.result.delta[b], st.result.made ? st.result.points[b] : -st.contract.value);
    assert.equal(st.contract.value % 10, 0);
  }
  for (let i = 0; i < 30; i++) {
    const { st } = playDeal(i % 4, false, AI.chooseBid, 4);
    assert.equal(st.history.length, 8); assert.ok(st.history.every((h) => h.cards.length === 4));
    assert.equal(R.cardPoints(st.taken.flat()), 120);
  }
});

test('Drücken: nur der Reizgewinner, genau 2 eigene Steine', () => {
  let st = R.newDealState({ forehand: 0, players: 3 });
  st = R.applyBid(st, 0, 40); st = R.applyBid(st, 1, 'pass'); st = R.applyBid(st, 2, 'pass');
  assert.equal(st.phase, 'discard'); assert.equal(st.hands[0].length, 12); assert.equal(st.stock.length, 0);
  assert.throws(() => R.applyDiscard(st, 1, st.hands[1].slice(0, 2)));
  assert.throws(() => R.applyDiscard(st, 0, st.hands[0].slice(0, 1)));
  assert.throws(() => R.applyDiscard(st, 0, [st.hands[1][0], st.hands[0][0]]));
  const s2 = R.applyDiscard(st, 0, st.hands[0].slice(0, 2));
  assert.equal(s2.phase, 'play'); assert.equal(s2.hands[0].length, 10); assert.equal(s2.turn, 0);
  assert.ok(R.legalFor(s2, 0).length === 10);
});

test('Partie mit 3 und 4 Spielern bis 1001, Vorhand wandert', () => {
  for (const n of [3, 4]) {
    let m = R.newMatch(n); let k = 0;
    while (m.winner === null && k < 300) {
      const fh = m.nextForehand; assert.equal(fh, k % n);
      const { st } = playDeal(fh, false, AI.chooseBid, n); m = R.applyDealResult(m, st.result, fh); k++;
    }
    assert.ok(m.winner !== null && m.totals[m.winner] >= 1001);
    assert.equal(m.totals.length, n);
  }
});

test('Spuren: 32 Steine passen aufs Brett', () => {
  let b = newBoard(); const cells = new Set();
  for (let t = 0; t < 10; t++) { b = openTrack(b, t % 3); for (let k = 0; k < (t < 2 ? 4 : 3); k++) { const r = addTile(b, 'x' + t + k); b = r.board; cells.add(r.cell.join(',')); } }
  assert.equal(cells.size, 32);
});
