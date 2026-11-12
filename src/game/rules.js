// Tausendundeins (1001) – reine Spiellogik, ohne DOM. Spieler 0 = Mensch, 1.. = Computer.
// 2 Spieler: 24 Steine (9 bis Ass). Ab 3 Spielern: 32 Steine (zusätzlich 7 und 8).
export const SUITS = ['D', 'H', 'S', 'C'];                         // Karo, Herz, Pik, Kreuz
export const RANKS = ['A', '10', 'K', 'Q', 'J', '9', '8', '7'];    // hoch -> niedrig
export const VALUE = { A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 };
export const MARRIAGE = { D: 40, H: 60, S: 80, C: 100 };
export const SUIT_NAME = { D: 'Karo', H: 'Herz', S: 'Pik', C: 'Kreuz' };
export const SUIT_SYMBOL = { D: '♦', H: '♥', S: '♠', C: '♣' };
export const RANK_NAME = { A: 'Ass', '10': 'Zehn', K: 'König', Q: 'Dame', J: 'Bube', '9': 'Neun', '8': 'Acht', '7': 'Sieben' };
export const TARGET = 1001;
export const BID_MIN = 40, BID_STEP = 10, BID_MAX = 400;
export const PLAYER_NAMES = {
  2: ['Du', 'Computer'],
  3: ['Du', 'Computer 1', 'Computer 2'],
  4: ['Du', 'Computer 1', 'Computer 2', 'Computer 3'],
};
export const PLAYER_NAME = PLAYER_NAMES[2];
// Geben je Spielerzahl: Pakete pro Spieler (reihum, Vorhand zuerst), Rest = Stock
export const DEAL_SCHEME = {
  2: { packets: [3, 2, 3], stock: 8, stockMode: 'draw' },     // 8 je Spieler, Stock 8 zum Nachziehen
  3: { packets: [3, 4, 3], stock: 2, stockMode: 'bidder' },   // 10 je Spieler, Talon 2 für den Reizgewinner
  4: { packets: [3, 2, 3], stock: 0, stockMode: 'none' },     // 8 je Spieler, kein Stock
};

export const suitOf = (c) => c[0];
export const rankOf = (c) => c.slice(1);
export const valueOf = (c) => VALUE[rankOf(c)];
export const strength = (c) => 8 - RANKS.indexOf(rankOf(c)); // A=8 ... 7=1
export const cardName = (c) => `${SUIT_NAME[suitOf(c)]}-${RANK_NAME[rankOf(c)]}`;
export const other = (p) => 1 - p;          // nur 2 Spieler
export const nextP = (p, n = 2) => (p + 1) % n;

export const ranksFor = (n = 2) => (n >= 3 ? RANKS : RANKS.slice(0, 6));
export function newDeck(n = 2) {
  const d = [];
  for (const s of SUITS) for (const r of ranksFor(n)) d.push(s + r);
  return d;
}

// Kryptografischer Zufall (Browser + Node 20+)
function randInt(n, rand) {
  if (rand) return Math.floor(rand() * n);
  const g = globalThis.crypto;
  const max = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  let x;
  do { g.getRandomValues(buf); x = buf[0]; } while (x >= max);
  return x % n;
}

// Fisher-Yates ueber das komplette Blatt – bei jedem Geben neu.
export function shuffle(cards, rand) {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1, rand);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sortHand(hand, trump) {
  const order = ['C', 'S', 'H', 'D'];
  return hand.slice().sort((a, b) => {
    const sa = suitOf(a) === trump ? -1 : order.indexOf(suitOf(a));
    const sb = suitOf(b) === trump ? -1 : order.indexOf(suitOf(b));
    return sa - sb || strength(b) - strength(a);
  });
}

// Geben in Paketen, Vorhand zuerst, reihum (siehe DEAL_SCHEME). Rest ist Stock bzw. Talon.
export function deal(forehand, rand, n = 2) {
  const deck = shuffle(newDeck(n), rand);
  const hands = Array.from({ length: n }, () => []);
  let i = 0;
  for (const k of DEAL_SCHEME[n].packets) {
    for (let s = 0; s < n; s++) {
      const p = (forehand + s) % n;
      for (let j = 0; j < k; j++) hands[p].push(deck[i++]);
    }
  }
  return { deck, hands, stock: deck.slice(i) };
}

// ------------------------------------------------------------ Reizrunde (nacheinander, immer +10)
export function newAuction(forehand, n = 2) {
  return { n, forehand, turn: forehand, high: null, passed: new Array(n).fill(false), log: [], done: false, winner: null, value: null };
}
export function minBid(a) { return a.high ? a.high.value + BID_STEP : BID_MIN; }
// Es gibt immer nur genau eine Erhöhung: das nächste Gebot (+10)
export function auctionOptions(a) { const v = minBid(a); return v <= BID_MAX ? [v] : []; }
function nextActive(a, p) {
  for (let k = 1; k <= a.n; k++) { const q = (p + k) % a.n; if (!a.passed[q]) return q; }
  return null;
}
export function auctionAct(a0, p, action) {
  if (a0.done) throw new Error('Reizen ist beendet');
  if (p !== a0.turn) throw new Error('Nicht am Zug');
  const a = { ...a0, passed: a0.passed.slice(), log: a0.log.slice() };
  const active = () => a.passed.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0);
  if (action === 'pass') {
    a.passed[p] = true; a.log.push({ p, pass: true });
    const act = active();
    if (act.length === 0) finish(a, a.high ? a.high.p : a.forehand, a.high ? a.high.value : BID_MIN, !a.high);
    else if (act.length === 1 && a.high && a.high.p === act[0]) finish(a, act[0], a.high.value);
    else a.turn = nextActive(a, p);   // der Nächste darf erhöhen – auch der Letzte ohne Gebot
  } else {
    const v = Number(action);
    if (v !== minBid(a) || v > BID_MAX) throw new Error('Gereizt wird nur in 10er-Schritten: ' + minBid(a) + ' oder passen');
    a.high = { value: v, p, by: p }; a.log.push({ p, bid: v });
    const act = active();
    if (act.length === 1) finish(a, p, v);    // alle anderen haben schon gepasst
    else a.turn = nextActive(a, p);
  }
  return a;
}
function finish(a, winner, value, forced = false) {
  a.done = true; a.winner = winner; a.value = value; a.forced = forced; a.turn = null;
}

// ------------------------------------------------------------ Stiche
// Wer liegt im Stich vorn? trick: [{p, card}, ...]
export function currentWinner(trick, trump) {
  let best = trick[0];
  for (const t of trick.slice(1)) {
    const sb = suitOf(best.card), st = suitOf(t.card);
    if (st === sb) { if (strength(t.card) > strength(best.card)) best = t; }
    else if (trump && st === trump) best = t;
  }
  return best;
}
// trickWinner(trick, trump) oder trickWinner(lead, follow, trump) (2 Spieler)
export function trickWinner(a, b, trump) {
  if (Array.isArray(a)) return currentWinner(a, b).p;
  return currentWinner([a, b], trump).p;
}

// trickCards: bisher gelegte Karten (Array) oder nur die Ausspielkarte (String)
export function legalMoves(hand, trickCards, trump, forced) {
  const cards = trickCards == null ? [] : (Array.isArray(trickCards) ? trickCards : [trickCards]);
  if (!cards.length || !forced) return hand.slice();
  const ls = suitOf(cards[0]);
  const best = currentWinner(cards.map((card, i) => ({ p: i, card })), trump).card;
  const same = hand.filter((c) => suitOf(c) === ls);
  if (same.length) {
    // Farbzwang; Stichzwang nur, wenn der Stich noch in der ausgespielten Farbe gewonnen wird
    if (suitOf(best) === ls) { const higher = same.filter((c) => strength(c) > strength(best)); if (higher.length) return higher; }
    return same;
  }
  if (trump) {
    const tr = hand.filter((c) => suitOf(c) === trump);
    if (tr.length) {
      if (suitOf(best) === trump) { const over = tr.filter((c) => strength(c) > strength(best)); if (over.length) return over; }
      return tr;                             // Trumpfzwang
    }
  }
  return hand.slice();
}

// Mögliche Meldungen beim Ausspielen dieser Karte
export function canDeclare(state, p, card) {
  if (state.leader !== p || state.trick.length !== 0) return false;
  const r = rankOf(card), s = suitOf(card);
  if (r !== 'K' && r !== 'Q') return false;
  if (state.declared[s] !== undefined) return false;
  const partner = s + (r === 'K' ? 'Q' : 'K');
  return state.hands[p].includes(partner);
}
export function declarableSuits(state, p) {
  return SUITS.filter((s) => state.leader === p && state.trick.length === 0 && state.declared[s] === undefined
    && state.hands[p].includes(s + 'K') && state.hands[p].includes(s + 'Q'));
}

// ------------------------------------------------------------ Spielzustand einer Runde
export function newDealState({ forehand, rand, dealt, players = 2 }) {
  const n = players;
  const d = dealt || deal(forehand, rand, n);
  return {
    n, forehand, deck: d.deck, hands: d.hands.map((h) => h.slice()), stock: d.stock.slice(),
    auction: newAuction(forehand, n), contract: null, skat: [], discard: [],
    phase: 'bidding', trump: null, declared: {}, melds: Array.from({ length: n }, () => []),
    taken: Array.from({ length: n }, () => []), tricks: new Array(n).fill(0), leader: null, turn: forehand, trick: [], trickNo: 0,
    history: [], lastTrick: null, result: null,
  };
}
export const tricksPerDeal = (st) => ((st.n || 2) === 2 ? 12 : st.n === 3 ? 10 : 8);

export function applyBid(st, p, action) {
  const a = auctionAct(st.auction, p, action);
  const s = { ...st, auction: a, turn: a.turn };
  if (a.done) {
    s.contract = { by: a.winner, value: a.value, forced: !!a.forced };
    s.leader = a.winner; s.turn = a.winner;
    if (DEAL_SCHEME[st.n || 2].stockMode === 'bidder') {
      // Reizgewinner nimmt den Talon auf und drückt danach 2 Steine
      s.hands = st.hands.map((h) => h.slice());
      s.hands[a.winner].push(...st.stock);
      s.skat = st.stock.slice(); s.stock = [];
      s.phase = 'discard';
    } else s.phase = 'play';
  }
  return s;
}
export function applyDiscard(st0, p, cards) {
  if (st0.phase !== 'discard' || p !== st0.contract.by) throw new Error('Nicht am Drücken');
  if (cards.length !== st0.skat.length || new Set(cards).size !== cards.length || !cards.every((c) => st0.hands[p].includes(c))) throw new Error('Ungültig gedrückt');
  const st = structuredClone(st0);
  st.hands[p] = st.hands[p].filter((c) => !cards.includes(c));
  st.discard = cards.slice();
  st.taken[p].push(...cards);          // Gedrückte Augen zählen für den Reizgewinner
  st.phase = 'play';
  return st;
}

export function stockEmpty(st) { return st.stock.length === 0; }

export function legalFor(st, p) {
  if (st.phase !== 'play' || st.turn !== p) return [];
  return legalMoves(st.hands[p], st.trick.map((t) => t.card), st.trump, stockEmpty(st));
}

// Karte spielen. opts.declare=true meldet die Hochzeit (nur beim Ausspielen von K/D mit Partner).
export function playCard(st0, p, card, opts = {}) {
  if (st0.phase !== 'play') throw new Error('Keine Spielphase');
  if (st0.turn !== p) throw new Error('Nicht am Zug');
  if (!legalFor(st0, p).includes(card)) throw new Error('Unzulässige Karte: ' + card);
  const st = structuredClone(st0);
  const n = st.n || 2;
  const events = [];
  if (opts.declare) {
    if (!canDeclare(st0, p, card)) throw new Error('Meldung nicht erlaubt');
    const s = suitOf(card);
    st.declared[s] = p; st.melds[p].push(s); st.trump = s;
    events.push({ type: 'meld', p, suit: s, points: MARRIAGE[s] });
  }
  st.hands[p] = st.hands[p].filter((c) => c !== card);
  st.trick.push({ p, card, meld: !!opts.declare });
  events.push({ type: 'play', p, card });
  if (st.trick.length < n) {
    st.turn = nextP(p, n);
  } else {
    const cards = st.trick;
    const w = currentWinner(cards, st.trump).p;
    for (const t of cards) st.taken[w].push(t.card);
    st.tricks[w]++;
    st.trickNo++;
    const rec = { no: st.trickNo, cards, lead: cards[0], follow: cards[1], winner: w, trump: st.trump };
    st.history.push(rec);
    st.lastTrick = rec;
    st.trick = [];
    events.push({ type: 'trick', winner: w, points: cardPoints(cards.map((t) => t.card)) });
    if (st.stock.length >= n) {          // nur 2 Spieler: jeder zieht nach, Gewinner zuerst
      for (let k = 0; k < n; k++) { const q = (w + k) % n; const c = st.stock.shift(); st.hands[q].push(c); events.push({ type: 'draw', p: q, card: c }); }
    }
    st.leader = w; st.turn = w;
    if (st.hands.every((h) => h.length === 0)) {
      st.phase = 'done'; st.turn = null;
      st.result = scoreDeal(st);
      events.push({ type: 'dealEnd', result: st.result });
    }
  }
  return { state: st, events };
}

export function cardPoints(cards) { return cards.reduce((s, c) => s + valueOf(c), 0); }
export function meldPoints(st, p) { return st.tricks[p] > 0 ? st.melds[p].reduce((s, x) => s + MARRIAGE[x], 0) : 0; }

// Reizgewinner: schafft er sein Gebot, schreibt er seine Punkte, sonst -Gebot. Alle anderen schreiben ihre Punkte.
export function scoreDeal(st) {
  const n = st.n || st.taken.length;
  const ps = [...Array(n).keys()];
  const pts = ps.map((p) => cardPoints(st.taken[p]) + meldPoints(st, p));
  const { by, value } = st.contract;
  const delta = pts.slice();
  const made = pts[by] >= value;
  if (!made) delta[by] = -value;
  return {
    n,
    cardPoints: ps.map((p) => cardPoints(st.taken[p])),
    meldPoints: ps.map((p) => meldPoints(st, p)),
    lostMelds: ps.map((p) => (st.tricks[p] === 0 ? st.melds[p].reduce((s, x) => s + MARRIAGE[x], 0) : 0)),
    points: pts, delta, made, bidder: by, bid: value, tricks: st.tricks.slice(),
  };
}

// ------------------------------------------------------------ Partie
export function newMatch(players = 2) {
  return { n: players, totals: new Array(players).fill(0), deals: [], nextForehand: 0, winner: null };
}
export function applyDealResult(m0, res, forehand) {
  const m = structuredClone(m0);
  const n = m.n || m.totals.length;
  m.totals = m.totals.map((t, i) => t + res.delta[i]);
  m.deals.push({ ...res, forehand, totals: m.totals.slice() });
  m.nextForehand = (forehand + 1) % n;   // Vorhand wandert reihum
  const over = m.totals.map((t, i) => (t >= TARGET ? i : -1)).filter((i) => i >= 0);
  if (over.length) {
    const top = Math.max(...over.map((i) => m.totals[i]));
    const best = over.filter((i) => m.totals[i] === top);
    m.winner = best.includes(res.bidder) ? res.bidder : best[0];
  }
  return m;
}
