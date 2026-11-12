// Tausendundeins (1001) – reine Spiellogik, ohne DOM. 0 = Mensch, 1 = Computer.
export const SUITS = ['D', 'H', 'S', 'C'];             // Karo, Herz, Pik, Kreuz
export const RANKS = ['A', '10', 'K', 'Q', 'J', '9'];  // hoch -> niedrig
export const VALUE = { A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0 };
export const MARRIAGE = { D: 40, H: 60, S: 80, C: 100 };
export const SUIT_NAME = { D: 'Karo', H: 'Herz', S: 'Pik', C: 'Kreuz' };
export const SUIT_SYMBOL = { D: '♦', H: '♥', S: '♠', C: '♣' };
export const RANK_NAME = { A: 'Ass', '10': 'Zehn', K: 'König', Q: 'Dame', J: 'Bube', '9': 'Neun' };
export const TARGET = 1001;
export const BID_MIN = 40, BID_STEP = 20, BID_MAX = 340;
export const PLAYER_NAME = ['Du', 'Computer'];

export const suitOf = (c) => c[0];
export const rankOf = (c) => c.slice(1);
export const valueOf = (c) => VALUE[rankOf(c)];
export const strength = (c) => 6 - RANKS.indexOf(rankOf(c)); // A=6 ... 9=1
export const cardName = (c) => `${SUIT_NAME[suitOf(c)]}-${RANK_NAME[rankOf(c)]}`;
export const other = (p) => 1 - p;

export function newDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(s + r);
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

// Geben: 3-2-3, Vorhand zuerst. Rest (8) ist der verdeckte Stock.
export function deal(forehand, rand) {
  const deck = shuffle(newDeck(), rand);
  const hands = [[], []];
  const dealer = other(forehand);
  let i = 0;
  for (const n of [3, 2, 3]) {
    for (let k = 0; k < n; k++) hands[forehand].push(deck[i++]);
    for (let k = 0; k < n; k++) hands[dealer].push(deck[i++]);
  }
  return { deck, hands, stock: deck.slice(i) };
}

// ------------------------------------------------------------ Reizrunde
export function newAuction(forehand) {
  return { forehand, turn: forehand, high: null, passed: [false, false], log: [], done: false, winner: null, value: null };
}
export function minBid(a) { return a.high ? a.high.value + BID_STEP : BID_MIN; }
export function auctionOptions(a) {
  const out = [];
  for (let v = minBid(a); v <= BID_MAX; v += BID_STEP) out.push(v);
  return out;
}
export function auctionAct(a0, p, action) {
  if (a0.done) throw new Error('Reizen ist beendet');
  if (p !== a0.turn) throw new Error('Nicht am Zug');
  const a = { ...a0, passed: a0.passed.slice(), log: a0.log.slice() };
  const o = other(p);
  if (action === 'pass') {
    a.passed[p] = true; a.log.push({ p, pass: true });
    if (a.passed[o]) {               // beide gepasst
      if (a.high) finish(a, a.high.by, a.high.value);
      else finish(a, a.forehand, BID_MIN, true);
    } else if (a.high && a.high.by === o) finish(a, o, a.high.value);
    else a.turn = o;                 // Gegner darf (Pflicht-)reizen oder passen
  } else {
    const v = Number(action);
    if (!Number.isInteger(v) || v < minBid(a) || v > BID_MAX || (v - BID_MIN) % BID_STEP !== 0) throw new Error('Ungültiges Gebot');
    a.high = { value: v, by: p }; a.log.push({ p, bid: v });
    if (a.passed[o]) finish(a, p, v); else a.turn = o;
  }
  return a;
}
function finish(a, winner, value, forced = false) {
  a.done = true; a.winner = winner; a.value = value; a.forced = forced; a.turn = null;
}

// ------------------------------------------------------------ Stiche
export function trickWinner(lead, follow, trump) {
  // lead/follow: {p, card}
  const sl = suitOf(lead.card), sf = suitOf(follow.card);
  if (sl === sf) return strength(follow.card) > strength(lead.card) ? follow.p : lead.p;
  if (trump && sf === trump) return follow.p;
  return lead.p;
}

export function legalMoves(hand, leadCard, trump, stockEmpty) {
  if (!leadCard || !stockEmpty) return hand.slice();
  const ls = suitOf(leadCard);
  const same = hand.filter((c) => suitOf(c) === ls);
  if (same.length) {
    const higher = same.filter((c) => strength(c) > strength(leadCard));
    return higher.length ? higher : same;   // Farbzwang + Stichzwang
  }
  if (trump && ls !== trump) {
    const tr = hand.filter((c) => suitOf(c) === trump);
    if (tr.length) return tr;               // Trumpfzwang
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
export function newDealState({ forehand, rand, dealt }) {
  const d = dealt || deal(forehand, rand);
  return {
    forehand, deck: d.deck, hands: [d.hands[0].slice(), d.hands[1].slice()], stock: d.stock.slice(),
    auction: newAuction(forehand), contract: null,
    phase: 'bidding', trump: null, declared: {}, melds: [[], []],
    taken: [[], []], tricks: [0, 0], leader: null, turn: forehand, trick: [], trickNo: 0,
    history: [], lastTrick: null, result: null,
  };
}

export function applyBid(st, p, action) {
  const a = auctionAct(st.auction, p, action);
  const s = { ...st, auction: a, turn: a.turn };
  if (a.done) {
    s.contract = { by: a.winner, value: a.value, forced: !!a.forced };
    s.phase = 'play'; s.leader = a.winner; s.turn = a.winner;
  }
  return s;
}

export function stockEmpty(st) { return st.stock.length === 0; }

export function legalFor(st, p) {
  if (st.phase !== 'play' || st.turn !== p) return [];
  const lead = st.trick.length ? st.trick[0].card : null;
  return legalMoves(st.hands[p], lead, st.trump, stockEmpty(st));
}

// Karte spielen. opts.declare=true meldet die Hochzeit (nur beim Ausspielen von K/D mit Partner).
export function playCard(st0, p, card, opts = {}) {
  if (st0.phase !== 'play') throw new Error('Keine Spielphase');
  if (st0.turn !== p) throw new Error('Nicht am Zug');
  if (!legalFor(st0, p).includes(card)) throw new Error('Unzulässige Karte: ' + card);
  const st = structuredClone(st0);
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
  if (st.trick.length === 1) {
    st.turn = other(p);
  } else {
    const [lead, follow] = st.trick;
    const w = trickWinner(lead, follow, st.trump);
    st.taken[w].push(lead.card, follow.card);
    st.tricks[w]++;
    st.trickNo++;
    st.history.push({ no: st.trickNo, lead, follow, winner: w, trump: st.trump });
    st.lastTrick = { lead, follow, winner: w };
    st.trick = [];
    events.push({ type: 'trick', winner: w, points: valueOf(lead.card) + valueOf(follow.card) });
    if (st.stock.length >= 2) {
      const a = st.stock.shift(), b = st.stock.shift();
      st.hands[w].push(a); st.hands[other(w)].push(b);
      events.push({ type: 'draw', p: w, card: a }, { type: 'draw', p: other(w), card: b });
    }
    st.leader = w; st.turn = w;
    if (st.hands[0].length === 0 && st.hands[1].length === 0) {
      st.phase = 'done'; st.turn = null;
      st.result = scoreDeal(st);
      events.push({ type: 'dealEnd', result: st.result });
    }
  }
  return { state: st, events };
}

export function cardPoints(cards) { return cards.reduce((s, c) => s + valueOf(c), 0); }
export function meldPoints(st, p) { return st.tricks[p] > 0 ? st.melds[p].reduce((s, x) => s + MARRIAGE[x], 0) : 0; }

export function scoreDeal(st) {
  const pts = [0, 1].map((p) => cardPoints(st.taken[p]) + meldPoints(st, p));
  const { by, value } = st.contract;
  const delta = pts.slice();
  const made = pts[by] >= value;
  if (!made) delta[by] = -value;
  return {
    cardPoints: [0, 1].map((p) => cardPoints(st.taken[p])),
    meldPoints: [0, 1].map((p) => meldPoints(st, p)),
    lostMelds: [0, 1].map((p) => (st.tricks[p] === 0 ? st.melds[p].reduce((s, x) => s + MARRIAGE[x], 0) : 0)),
    points: pts, delta, made, bidder: by, bid: value, tricks: st.tricks.slice(),
  };
}

// ------------------------------------------------------------ Partie
export function newMatch() {
  return { totals: [0, 0], deals: [], nextForehand: 0, winner: null };
}
export function applyDealResult(m0, res, forehand) {
  const m = structuredClone(m0);
  m.totals = [m.totals[0] + res.delta[0], m.totals[1] + res.delta[1]];
  m.deals.push({ ...res, forehand, totals: m.totals.slice() });
  m.nextForehand = other(forehand);   // Vorhand wechselt jede Runde
  const over = m.totals.map((t) => t >= TARGET);
  if (over[0] || over[1]) {
    if (over[0] && over[1]) m.winner = m.totals[0] === m.totals[1] ? res.bidder : (m.totals[0] > m.totals[1] ? 0 : 1);
    else m.winner = over[0] ? 0 : 1;
  }
  return m;
}
