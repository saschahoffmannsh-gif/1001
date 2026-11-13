// Card Master – Skat nach Internationaler Skatordnung (ISkO), reine Logik ohne DOM.
// Gemeinsam genutzt von Spiel-Client, Tests und Edge Function (Nachspielen/Prüfen eingereichter Partien).
//
// Sitzplätze 0..n-1 (n = 3 oder 4), gespielt wird im Uhrzeigersinn p -> p+1.
// Vorhand = links vom Geber (Geber+1), Mittelhand = Geber+2, Hinterhand = Geber+3 (bei 3 Spielern = Geber).
// Bei 4 Spielern setzt der Geber aus.
//
// Wertung (Turnierpunkte, Seeger-Fabian wie ISkO-Liste):
//   gewonnen:  Alleinspieler + (Spielwert × K + 50)
//   verloren:  Alleinspieler − (2 × Spielwert × K + 50); jeder andere Spieler am Tisch +40 (3er-Tisch) bzw. +30 (4er-Tisch)
//   K = 1, bei Kontra 2, bei Re 4.
// Ramsch (wenn alle passen; Vereinbarung, nicht Teil der ISkO-Liste): wer die meisten Augen hat, verliert diese Augen
//   als Minuspunkte (verdoppelt je Jungfrau); Durchmarsch (alle Stiche) bringt +120. Keine Siege/Niederlagen.
// Card-Master-Rangliste je Spiel: gewonnenes Spiel = Sieg für den Alleinspieler; verlorenes Spiel = Niederlage für den
//   Alleinspieler und Sieg für jeden Gegenspieler. Aussetzender Geber und Ramsch: weder Sieg noch Niederlage.

export const SUITS = ['C', 'S', 'H', 'D'];                       // Kreuz, Pik, Herz, Karo
export const SUIT_NAME = { C: 'Kreuz', S: 'Pik', H: 'Herz', D: 'Karo' };
export const BASE = { D: 9, H: 10, S: 11, C: 12, grand: 24 };
export const NULL_VALUES = { plain: 23, hand: 35, ouvert: 46, ouvertHand: 59 };
export const EYES = { A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 };
export const JACKS = ['CJ', 'SJ', 'HJ', 'DJ'];
const SUIT_RANKS = ['A', '10', 'K', 'Q', '9', '8', '7'];          // Farbe / Trumpf ohne Buben, hoch -> niedrig
const NULL_RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7'];     // Null, hoch -> niedrig
export const DECK = SUITS.flatMap((s) => ['A', '10', 'K', 'Q', 'J', '9', '8', '7'].map((r) => s + r));
export const MATCH_DEALS = 12;                                     // eine Serie = 12 Spiele
export const DEFENDER_BONUS = { 3: 40, 4: 30 };

export const suitOf = (c) => c[0];
export const rankOf = (c) => c.slice(1);
export const eyes = (c) => EYES[rankOf(c)];
export const eyesOf = (cards) => cards.reduce((s, c) => s + eyes(c), 0);

// Reizwerte: alle möglichen Spielwerte ab 18 (Farbspiele bis 18-fach, Grand bis 11-fach, Null)
export const BIDS = (() => {
  const v = new Set(Object.values(NULL_VALUES));
  for (const b of [9, 10, 11, 12]) for (let m = 2; m <= 18; m++) v.add(b * m);
  for (let m = 2; m <= 11; m++) v.add(24 * m);
  return [...v].filter((x) => x >= 18).sort((a, b) => a - b);
})();
export const nextBid = (v) => BIDS.find((x) => x > v) ?? null;

// ------------------------------------------------------------ Trumpf, Rang, Stich
export function isTrump(card, game) {
  if (!game || game.type === 'null') return false;
  if (rankOf(card) === 'J') return true;
  return game.type === 'suit' && suitOf(card) === game.suit;
}
export const effSuit = (card, game) => (isTrump(card, game) ? 'T' : suitOf(card));
export function power(card, game) {
  if (game.type === 'null') return 8 - NULL_RANKS.indexOf(rankOf(card));
  if (rankOf(card) === 'J') return 100 - JACKS.indexOf(card);
  const base = 8 - SUIT_RANKS.indexOf(rankOf(card));
  return isTrump(card, game) ? 50 + base : base;
}
export function trickWinner(trick, game) {
  const led = effSuit(trick[0].card, game);
  let best = trick[0];
  for (const t of trick.slice(1)) {
    const s = effSuit(t.card, game), bs = effSuit(best.card, game);
    if (s === bs ? power(t.card, game) > power(best.card, game) : s === 'T' && bs !== 'T') best = t;
  }
  void led;
  return best.p;
}
export function legalCards(hand, trick, game) {
  if (!trick.length) return hand.slice();
  const led = effSuit(trick[0].card, game);
  const same = hand.filter((c) => effSuit(c, game) === led);
  return same.length ? same : hand.slice();
}
export function sortForGame(hand, game) {
  const g = game || { type: 'grand' };
  const order = ['C', 'S', 'H', 'D'];
  const key = (c) => {
    if (isTrump(c, g)) return [0, -power(c, g)];
    return [1 + order.indexOf(suitOf(c)), -power(c, g)];
  };
  return hand.slice().sort((a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1]; });
}

// ------------------------------------------------------------ Spielwert
export function matadors(cards, game) {
  if (game.type === 'null' || game.type === 'ramsch') return { with: false, n: 0 };
  const seq = game.type === 'grand' ? JACKS.slice() : [...JACKS, ...SUIT_RANKS.map((r) => game.suit + r)];
  const has = seq.map((c) => cards.includes(c));
  const w = has[0]; let n = 0;
  while (n < seq.length && has[n] === w) n++;
  return { with: w, n };
}
export function normalizeGame(g) {
  const type = g.type;
  if (type === 'null') {
    return { type, hand: !!g.hand, ouvert: !!g.ouvert, schneider: false, schwarz: false };
  }
  if (type !== 'suit' && type !== 'grand') throw new Error('Unbekannte Spielart');
  if (type === 'suit' && !SUITS.includes(g.suit)) throw new Error('Unbekannte Trumpffarbe');
  const ouvert = !!g.ouvert, schwarz = !!g.schwarz || ouvert, schneider = !!g.schneider || schwarz;
  const hand = !!g.hand || schneider;               // Ansagen nur im Handspiel
  if (schneider && !g.hand) throw new Error('Schneider/Schwarz/Ouvert ansagen geht nur im Handspiel');
  return { type, suit: type === 'suit' ? g.suit : undefined, hand, ouvert, schneider, schwarz };
}
export function nullValue(game) { return game.ouvert ? (game.hand ? 59 : 46) : (game.hand ? 35 : 23); }
// Mögliche Mindest-Spielwerte (ohne Schneider) – für Hinweise beim Ansagen
export function baseValue(game, cards) {
  if (game.type === 'null') return nullValue(game);
  const m = matadors(cards, game).n;
  const mult = m + 1 + (game.hand ? 1 : 0) + (game.schneider ? 2 : 0) + (game.schwarz ? 2 : 0) + (game.ouvert ? 1 : 0);
  return BASE[game.type === 'grand' ? 'grand' : game.suit] * mult;
}
export function canAnnounce(game, bid) { return game.type !== 'null' || nullValue(game) >= bid; }

// ------------------------------------------------------------ Geben
export function dealOrder(n, dealer) {
  return [1, 2, 3].map((k) => (dealer + k) % n);    // [Vorhand, Mittelhand, Hinterhand]
}
// deck: gemischtes Blatt (32). Geben 3 – Skat 2 – 4 – 3.
export function newDeal({ n, dealer, deck }) {
  if (n !== 3 && n !== 4) throw new Error('Skat braucht 3 oder 4 Spieler');
  const order = dealOrder(n, dealer);
  const hands = Array.from({ length: n }, () => []);
  let k = 0;
  const give = (cnt) => { for (const p of order) for (let i = 0; i < cnt; i++) hands[p].push(deck[k++]); };
  give(3); const skat = [deck[k++], deck[k++]]; give(4); give(3);
  return fromHands({ n, dealer, hands, skat });
}
export function fromHands({ n, dealer, hands, skat }) {
  const order = dealOrder(n, dealer);
  const all = [...hands.flat(), ...skat];
  if (all.length !== 32 || new Set(all).size !== 32 || !all.every((c) => DECK.includes(c))) throw new Error('Blatt ungültig');
  for (let p = 0; p < n; p++) if (hands[p].length !== (order.includes(p) ? 10 : 0)) throw new Error('Handgröße ungültig');
  return {
    n, dealer, order, sitting: n === 4 ? dealer : null,
    initial: { hands: hands.map((h) => h.slice()), skat: skat.slice() },
    hands: hands.map((h) => h.slice()), skat: skat.slice(),
    phase: 'bid',
    auction: { stage: 1, sayer: order[1], listener: order[0], waiting: 'say', bid: 0, passed: [], log: [] },
    declarer: null, bid: 0, handGame: null, discard: null, game: null,
    kontra: 0, kontraBy: null, kontraAsked: [], reAsked: false,
    trick: [], tricks: [], taken: Array.from({ length: n }, () => []), turn: null,
    record: { bids: [], pick: null, discard: null, game: null, kontra: [], plays: [] },
  };
}
const clone = (s) => JSON.parse(JSON.stringify(s));

// ------------------------------------------------------------ Reizen
// Wer muss handeln? { p, role: 'say' | 'answer', value }  (say: nächsten Reizwert sagen oder passen; answer: „ja“ oder passen)
export function bidTurn(s) {
  const a = s.auction;
  if (s.phase !== 'bid') return null;
  if (a.waiting === 'say') return { p: a.sayer, role: 'say', value: a.stage === 3 ? 18 : nextBid(a.bid) };
  return { p: a.listener, role: 'answer', value: a.bid };
}
// act: 'say' | 'yes' | 'pass'
export function applyBid(s0, p, act) {
  const s = clone(s0), a = s.auction, t = bidTurn(s);
  if (!t || t.p !== p) throw new Error('Nicht am Zug beim Reizen');
  const { order } = s;
  const [vh, , hh] = order;
  a.log.push({ p, act, value: act === 'say' ? t.value : a.bid });
  s.record.bids.push(act);
  const finish = (decl, bid) => {
    a.done = true;
    if (decl === null) { s.phase = 'play'; s.game = { type: 'ramsch' }; s.declarer = null; s.turn = vh; return; }
    s.declarer = decl; s.bid = bid; s.phase = 'skat';
  };
  const advance = (survivor) => {
    if (a.stage === 1) { a.stage = 2; a.sayer = hh; a.listener = survivor; a.waiting = 'say'; return; }
    if (a.stage === 2) {
      if (survivor === hh) return finish(hh, a.bid);
      if (a.bid > 0) return finish(survivor, a.bid);
      // niemand hat gereizt: Vorhand darf 18 sagen
      a.stage = 3; a.sayer = vh; a.listener = null; a.waiting = 'say'; return;
    }
  };
  if (t.role === 'say') {
    if (act === 'pass') {
      a.passed.push(p);
      if (a.stage === 3) return finish(null), s;
      advance(a.listener);
    } else if (act === 'say') {
      if (t.value === null) throw new Error('Höher geht es nicht');
      a.bid = t.value;
      if (a.stage === 3) { finish(vh, 18); return s; }
      a.waiting = 'answer';
    } else throw new Error('Ungültige Reizansage');
  } else {
    if (act === 'yes') a.waiting = 'say';
    else if (act === 'pass') { a.passed.push(p); const sayer = a.sayer; if (a.stage === 1) advance(sayer); else finish(sayer, a.bid); }
    else throw new Error('Ungültige Reizantwort');
  }
  return s;
}

// ------------------------------------------------------------ Skat aufnehmen / Hand / Drücken / Ansagen
export function chooseSkat(s0, p, takeSkat) {
  const s = clone(s0);
  if (s.phase !== 'skat' || p !== s.declarer) throw new Error('Nicht am Zug');
  s.handGame = !takeSkat; s.record.pick = takeSkat ? 'take' : 'hand';
  if (takeSkat) { s.hands[p].push(...s.skat); s.skat = []; s.phase = 'discard'; } else s.phase = 'announce';
  return s;
}
export function discard(s0, p, cards) {
  const s = clone(s0);
  if (s.phase !== 'discard' || p !== s.declarer) throw new Error('Nicht am Zug');
  if (!Array.isArray(cards) || cards.length !== 2 || cards[0] === cards[1] || !cards.every((c) => s.hands[p].includes(c))) throw new Error('Zwei eigene Steine drücken');
  s.hands[p] = s.hands[p].filter((c) => !cards.includes(c));
  s.skat = cards.slice(); s.discard = cards.slice(); s.record.discard = cards.slice(); s.phase = 'announce';
  return s;
}
export function announce(s0, p, g) {
  const s = clone(s0);
  if (s.phase !== 'announce' || p !== s.declarer) throw new Error('Nicht am Zug');
  const game = normalizeGame({ ...g, hand: s.handGame });
  if (!s.handGame && (g.schneider || g.schwarz || (g.ouvert && g.type !== 'null'))) throw new Error('Ansagen nur im Handspiel');
  if (!canAnnounce(game, s.bid)) throw new Error('Nullspiel unter dem Reizwert');
  s.game = game; s.record.game = { ...game };
  s.phase = 'kontra'; s.kontraAsked = [];
  return s;
}
// Kontra: jeder Gegenspieler (in Sitzreihenfolge ab Vorhand) darf Kontra sagen; danach darf der Alleinspieler Re sagen.
export function kontraTurn(s) {
  if (s.phase !== 'kontra') return null;
  if (s.kontra === 1 && !s.reAsked) return { p: s.declarer, role: 're' };
  if (s.kontra === 0) {
    const d = s.order.filter((q) => q !== s.declarer && !s.kontraAsked.includes(q));
    if (d.length) return { p: d[0], role: 'kontra' };
  }
  return null;
}
export function applyKontra(s0, p, yes) {
  const s = clone(s0), t = kontraTurn(s);
  if (!t || t.p !== p) throw new Error('Nicht am Zug');
  s.record.kontra.push(!!yes);
  if (t.role === 'kontra') { s.kontraAsked.push(p); if (yes) { s.kontra = 1; s.kontraBy = p; } }
  else { s.reAsked = true; if (yes) s.kontra = 2; }
  if (!kontraTurn(s)) { s.phase = 'play'; s.turn = s.order[0]; }
  return s;
}

// ------------------------------------------------------------ Spielen
export const nextActive = (s, p) => s.order[(s.order.indexOf(p) + 1) % 3];
export function legalFor(s, p) { return s.phase === 'play' && s.turn === p ? legalCards(s.hands[p], s.trick, s.game) : []; }
export function playCard(s0, p, card) {
  const s = clone(s0);
  if (s.phase !== 'play' || s.turn !== p) throw new Error('Nicht am Zug');
  if (!legalCards(s.hands[p], s.trick, s.game).includes(card)) throw new Error('Stein nicht zulässig');
  s.hands[p] = s.hands[p].filter((c) => c !== card);
  s.trick.push({ p, card }); s.record.plays.push(card);
  const events = [];
  if (s.trick.length < 3) { s.turn = nextActive(s, p); return { state: s, events }; }
  const w = trickWinner(s.trick, s.game);
  s.tricks.push({ leader: s.trick[0].p, cards: s.trick, winner: w });
  s.taken[w].push(...s.trick.map((t) => t.card));
  events.push({ type: 'trick', winner: w, points: eyesOf(s.trick.map((t) => t.card)) });
  s.trick = []; s.turn = w;
  const nullLost = s.game.type === 'null' && w === s.declarer;
  if (s.tricks.length === 10 || nullLost) { s.phase = 'done'; s.result = score(s); events.push({ type: 'done' }); }
  return { state: s, events };
}

// ------------------------------------------------------------ Abrechnung
export function score(s) {
  const n = s.n, tp = new Array(n).fill(0), win = new Array(n).fill(false), loss = new Array(n).fill(false);
  const tricksBy = new Array(n).fill(0);
  for (const t of s.tricks) tricksBy[t.winner]++;
  if (s.game.type === 'ramsch') {
    const pts = new Array(n).fill(0);
    for (let p = 0; p < n; p++) pts[p] = eyesOf(s.taken[p]);
    const last = s.tricks[s.tricks.length - 1].winner;
    pts[last] += eyesOf(s.skat);
    const act = s.order;
    const durch = act.find((p) => tricksBy[p] === 10);
    let losers = [], jungfrau = 0, minus = 0;
    if (durch !== undefined) tp[durch] = 120;
    else {
      const max = Math.max(...act.map((p) => pts[p]));
      losers = act.filter((p) => pts[p] === max);
      jungfrau = act.filter((p) => tricksBy[p] === 0).length;
      minus = max * (jungfrau ? 2 ** jungfrau : 1);
      for (const p of losers) tp[p] = -minus;
    }
    return { type: 'ramsch', points: pts, tricks: tricksBy, losers, jungfrau, durchmarsch: durch ?? null, skatTo: last, tp, win, loss, value: minus };
  }
  const d = s.declarer, g = s.game;
  const declCards = [...s.initial.hands[d], ...s.initial.skat];       // Spitzen zählen mit Skat
  const mat = matadors(declCards, g);
  const dTricks = tricksBy[d];
  const dPoints = eyesOf(s.taken[d]) + (g.type === 'null' ? 0 : eyesOf(s.skat));
  let won, value, schneider = false, schwarz = false, overbid = false, mult = 0;
  if (g.type === 'null') {
    won = dTricks === 0; value = nullValue(g);
  } else {
    schneider = dPoints >= 90 || dPoints <= 30;
    const playedAll = s.tricks.length === 10;
    schwarz = playedAll && (dTricks === 10 || dTricks === 0);
    won = dPoints >= 61 && (!g.schneider || dPoints >= 90) && (!g.schwarz || dTricks === 10);
    mult = mat.n + 1 + (g.hand ? 1 : 0) + ((schneider || g.schneider) ? 1 : 0) + (g.schneider ? 1 : 0)
      + ((schwarz || g.schwarz) ? 1 : 0) + (g.schwarz ? 1 : 0) + (g.ouvert ? 1 : 0);
    const base = BASE[g.type === 'grand' ? 'grand' : g.suit];
    value = base * mult;
    if (value < s.bid) { overbid = true; won = false; value = base * Math.ceil(s.bid / base); }
  }
  const factor = [1, 2, 4][s.kontra];
  if (won) { tp[d] = value * factor + 50; win[d] = true; }
  else {
    tp[d] = -(2 * value * factor + 50); loss[d] = true;
    for (let p = 0; p < n; p++) if (p !== d) tp[p] = DEFENDER_BONUS[n];
    for (const p of s.order) if (p !== d) win[p] = true;
  }
  return { type: g.type, suit: g.suit, declarer: d, bid: s.bid, won, value, factor, matadors: mat, mult, points: dPoints, tricks: dTricks,
    schneider, schwarz, overbid, hand: g.hand, ouvert: g.ouvert, tp, win, loss };
}

// ------------------------------------------------------------ Serie / Prüfen eingereichter Partien
export function newMatch(n, startDealer = n - 1) { return { n, startDealer, deals: [], totals: new Array(n).fill(0), wins: new Array(n).fill(0), losses: new Array(n).fill(0) }; }
export const dealerFor = (m, i) => (m.startDealer + i) % m.n;
export function addDeal(m0, res, record) {
  const m = clone(m0);
  m.deals.push({ ...record, result: res });
  res.tp.forEach((x, p) => { m.totals[p] += x; });
  res.win.forEach((x, p) => { if (x) m.wins[p]++; });
  res.loss.forEach((x, p) => { if (x) m.losses[p]++; });
  m.done = m.deals.length >= MATCH_DEALS;
  return m;
}
// Datensatz einer Runde (für den Server): Blatt, alle Entscheidungen, alle gespielten Steine.
export function dealRecord(s) {
  return { dealer: s.dealer, hands: s.initial.hands, skat: s.initial.skat, ...clone(s.record) };
}
// Spielt eine Runde aus dem Datensatz nach (wirft bei jeder Unstimmigkeit) und liefert das Ergebnis.
export function replayDeal(n, rec) {
  let s = fromHands({ n, dealer: rec.dealer, hands: rec.hands, skat: rec.skat });
  const bids = Array.isArray(rec.bids) ? rec.bids : [];
  for (const act of bids) { const t = bidTurn(s); if (!t) throw new Error('Reizfolge ungültig'); s = applyBid(s, t.p, act); }
  if (s.phase === 'bid') throw new Error('Reizen nicht abgeschlossen');
  if (s.phase === 'skat') {
    s = chooseSkat(s, s.declarer, rec.pick === 'take');
    if (s.phase === 'discard') s = discard(s, s.declarer, rec.discard);
    if (!rec.game || typeof rec.game !== 'object') throw new Error('Spielansage fehlt');
    s = announce(s, s.declarer, rec.game);
    const ks = Array.isArray(rec.kontra) ? rec.kontra : [];
    for (const k of ks) { const t = kontraTurn(s); if (!t) throw new Error('Kontra ungültig'); s = applyKontra(s, t.p, k); }
    if (s.phase !== 'play') throw new Error('Kontra-Abfrage unvollständig');
  }
  const plays = Array.isArray(rec.plays) ? rec.plays : [];
  for (const c of plays) { if (s.phase !== 'play') throw new Error('Zu viele Steine'); s = playCard(s, s.turn, c).state; }
  if (s.phase !== 'done') throw new Error('Runde nicht zu Ende gespielt');
  return s.result;
}
export function verifyMatch(n, deals, startDealer = n - 1) {
  if (n !== 3 && n !== 4) throw new Error('Skat: 3 oder 4 Spieler');
  if (!Array.isArray(deals) || deals.length !== MATCH_DEALS) throw new Error(`Eine Serie hat ${MATCH_DEALS} Spiele`);
  let m = newMatch(n, startDealer);
  deals.forEach((rec, i) => {
    if (!rec || rec.dealer !== dealerFor(m, i)) throw new Error(`Spiel ${i + 1}: Geber passt nicht`);
    let res;
    try { res = replayDeal(n, rec); } catch (e) { throw new Error(`Spiel ${i + 1}: ${e.message}`); }
    m = addDeal(m, res, { dealer: rec.dealer });
  });
  return m;
}
