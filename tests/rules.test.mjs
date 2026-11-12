import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/game/rules.js';
import * as AI from '../src/game/ai.js';
import { playDeal } from '../tools/sim.mjs';
import { newBoard, openTrack, addTile } from '../src/game/tracks.js';

test('Blatt: 24 Steine, 120 Augen', () => {
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
  st = R.applyBid(st, 0, 60); st = R.applyBid(st, 1, 'pass');
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

test('Reizrunde', () => {
  let a = R.newAuction(0);
  assert.deepEqual(R.auctionOptions(a).slice(0, 3), [40, 60, 80]);
  a = R.auctionAct(a, 0, 40); a = R.auctionAct(a, 1, 60); a = R.auctionAct(a, 0, 100); a = R.auctionAct(a, 1, 'pass');
  assert.equal(a.done, true); assert.equal(a.winner, 0); assert.equal(a.value, 100);
  let b = R.auctionAct(R.newAuction(1), 1, 'pass');      // Vorhand passt
  b = R.auctionAct(b, 0, 40);                            // Pflichtreiz
  assert.equal(b.done, true); assert.equal(b.winner, 0); assert.equal(b.value, 40);
  let c = R.auctionAct(R.newAuction(1), 1, 'pass'); c = R.auctionAct(c, 0, 'pass');
  assert.equal(c.winner, 1); assert.equal(c.value, 40); assert.equal(c.forced, true);
  assert.throws(() => R.auctionAct(R.newAuction(0), 0, 50));
  assert.throws(() => R.auctionAct(R.newAuction(0), 1, 40));
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
