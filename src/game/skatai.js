// Card Master – Skat-Computerspieler („solider Hobbyspieler“). Nutzt nur eigenes Wissen:
// eigene Steine, gespielte Steine, Ansagen, beim Alleinspieler den aufgenommenen/gedrückten Skat,
// bei Ouvert die offene Hand des Alleinspielers. Keine Blicke in fremde Hände.
import * as S from '../../supabase/functions/tu/skat.js';

const { suitOf, rankOf, eyes, isTrump, effSuit, power } = S;
const SIDE = ['C', 'S', 'H', 'D'];
const GAMES = [...SIDE.map((s) => ({ type: 'suit', suit: s })), { type: 'grand' }, { type: 'null' }];
export const THRESH = { suit: 3.9, grand: 5.2, null: 0 };

function suitStrength(cards, trump) {
  const g = { type: 'suit', suit: trump };
  const tr = cards.filter((c) => isTrump(c, g));
  const nT = tr.length, jacks = cards.filter((c) => rankOf(c) === 'J');
  let v = 0;
  const jw = { CJ: 1.0, SJ: 0.9, HJ: 0.8, DJ: 0.7 };
  for (const j of jacks) v += jw[j];
  const has = (r) => cards.includes(trump + r);
  if (has('A')) v += 0.85; if (has('10')) v += has('A') ? 0.75 : 0.5; if (has('K')) v += 0.45;
  v += tr.filter((c) => ['Q', '9', '8', '7'].includes(rankOf(c))).length * (nT >= 5 ? 0.42 : 0.25);
  for (const s of SIDE) {
    if (s === trump) continue;
    const sc = cards.filter((c) => suitOf(c) === s && rankOf(c) !== 'J');
    const h = (r) => sc.some((c) => rankOf(c) === r);
    if (h('A')) v += 0.9;
    if (h('10')) v += h('A') ? 0.75 : sc.length >= 3 ? 0.35 : 0.1;
    if (h('K') && h('A') && h('10')) v += 0.4;
    if (!sc.length && nT >= 5) v += 0.3;
  }
  if (nT < 5) v -= (5 - nT) * 0.7;
  return v;
}
function grandStrength(cards) {
  let v = 0;
  const jw = { CJ: 1.25, SJ: 1.1, HJ: 0.95, DJ: 0.85 };
  const jacks = cards.filter((c) => rankOf(c) === 'J');
  for (const j of jacks) v += jw[j];
  for (const s of SIDE) {
    const sc = cards.filter((c) => suitOf(c) === s && rankOf(c) !== 'J');
    const h = (r) => sc.some((c) => rankOf(c) === r);
    if (h('A')) v += 1.0;
    if (h('10')) v += h('A') ? 0.9 : sc.length >= 3 ? 0.3 : 0;
    if (h('A') && h('10') && h('K')) v += 0.5;
    if (h('A') && h('10') && sc.length >= 4) v += (sc.length - 3) * 0.5;
  }
  if (jacks.length < 2) v -= 1.2;
  return v;
}
const NULL_IDX = { '7': 0, '8': 1, '9': 2, '10': 3, J: 4, Q: 5, K: 6, A: 7 };
function nullDanger(cards) {
  let d = 0;
  for (const s of SIDE) {
    const r = cards.filter((c) => suitOf(c) === s).map((c) => NULL_IDX[rankOf(c)]).sort((a, b) => a - b);
    r.forEach((x, k) => { if (x > 2 * k) d += 1 + (x - 2 * k) * 0.15; });
  }
  return d;
}
export function strengthOf(cards, game) {
  if (game.type === 'null') return 1.5 - nullDanger(cards) * 1.5;   // >0 = spielbar
  return game.type === 'grand' ? grandStrength(cards) : suitStrength(cards, game.suit);
}
const margin = (cards, game, bonus = 0) => strengthOf(cards, game) + bonus - THRESH[game.type];

// Höchster Reizwert, den die Hand trägt (Skat noch unbekannt: kleiner Bonus für die Aufnahme)
export function bidLimit(hand) {
  let best = 0;
  for (const g of GAMES) {
    if (g.type === 'null') {
      const d = nullDanger(hand);
      if (d === 0) best = Math.max(best, 35); else if (d <= 1.2) best = Math.max(best, 23);
      continue;
    }
    if (margin(hand, g, 0.45) < 0) continue;
    const m = S.matadors(hand, g);
    const mult = m.n + 1;
    best = Math.max(best, S.BASE[g.type === 'grand' ? 'grand' : g.suit] * mult);
  }
  return best;
}
export function chooseBid(s, p) {
  const t = S.bidTurn(s);
  const lim = bidLimit(s.hands[p]);
  if (t.role === 'say') return t.value !== null && t.value <= lim ? 'say' : 'pass';
  return t.value <= lim ? 'yes' : 'pass';
}
// Hand spielen, wenn die Hand schon allein klar reicht
export function chooseTakeSkat(s, p) {
  const h = s.hands[p];
  for (const g of GAMES) {
    if (g.type === 'null') { if (nullDanger(h) === 0 && 35 >= s.bid) return false; continue; }
    const v = S.baseValue({ ...g, hand: true }, [...s.initial.hands[p], ...s.initial.skat]);
    if (margin(h, g) >= 1.2 && v >= s.bid) return false;
  }
  return true;
}
function bestGameFor(cards10, allCards, bid, hand) {
  let best = null;
  for (const g0 of GAMES) {
    const g = { ...g0, hand };
    const ok = g.type === 'null' ? S.nullValue(g) >= bid : S.baseValue(g, allCards) >= bid;
    let m = margin(cards10, g);
    if (g.type === 'null' && hand && S.nullValue(g) < bid) continue;
    if (!ok) m -= 10;
    if (!best || m > best.m) best = { g, m };
  }
  return best;
}
export function chooseDiscard(s, p) {
  const h = s.hands[p], all = [...s.initial.hands[p], ...s.initial.skat];
  let best = null;
  for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) {
    const rest = h.filter((_, k) => k !== i && k !== j);
    const bg = bestGameFor(rest, all, s.bid, false);
    let sc = bg.m;
    if (bg.g.type !== 'null') {
      sc += (eyes(h[i]) + eyes(h[j])) * 0.025;
      if (isTrump(h[i], bg.g) || isTrump(h[j], bg.g)) sc -= 0.6;
    }
    if (!best || sc > best.sc) best = { sc, cards: [h[i], h[j]], g: bg.g };
  }
  return best.cards;
}
export function chooseGame(s, p) {
  const all = [...s.initial.hands[p], ...s.initial.skat];
  const bg = bestGameFor(s.hands[p], all, s.bid, s.handGame);
  const g = { ...bg.g };
  if (g.type === 'null' && s.handGame === false && nullDanger(s.hands[p]) === 0 && 46 >= s.bid && Math.random() < 0.3) g.ouvert = true;
  delete g.hand;
  return g;
}
export function chooseKontra(s, p) {
  const t = S.kontraTurn(s); const h = s.hands[p], g = s.game;
  if (g.type === 'null') return false;
  if (t.role === 're') return margin(h, g) >= 2.2;
  const tr = h.filter((c) => isTrump(c, g));
  const jacks = h.filter((c) => rankOf(c) === 'J').length;
  const aces = h.filter((c) => rankOf(c) === 'A' && !isTrump(c, g)).length;
  return (g.type === 'suit' && tr.length >= 4 && jacks >= 2 && aces >= 2) || (g.type === 'grand' && jacks >= 2 && aces >= 2);
}

// ------------------------------------------------------------ Spielen
function knowledge(s, p) {
  const played = new Set([...s.tricks.flatMap((t) => t.cards.map((x) => x.card)), ...s.trick.map((x) => x.card)]);
  const known = new Set([...s.hands[p], ...played]);
  if (p === s.declarer && s.discard) for (const c of s.discard) known.add(c);
  const openHand = s.game && s.game.ouvert && p !== s.declarer ? s.hands[s.declarer] : null;
  const unknown = S.DECK.filter((c) => !known.has(c));
  return { played, unknown, openHand };
}
const beats = (a, b, game, led) => {
  const ea = effSuit(a, game), eb = effSuit(b, game);
  if (ea === eb) return power(a, game) > power(b, game);
  return ea === 'T' && eb !== 'T' && game.type !== 'null' && game.type !== 'x' ? true : (ea === led && eb !== led && eb !== 'T' ? true : false);
};
function currentWinner(trick, game) {
  if (!trick.length) return null;
  const w = S.trickWinner(trick, game);
  return trick.find((t) => t.p === w);
}
const lowest = (cards, game) => cards.slice().sort((a, b) => eyes(a) - eyes(b) || power(a, game) - power(b, game))[0];
const highestEyes = (cards, game) => cards.slice().sort((a, b) => eyes(b) - eyes(a) || power(a, game) - power(b, game))[0];
function isMaster(card, game, unknown) {
  const e = effSuit(card, game);
  return !unknown.some((u) => effSuit(u, game) === e && power(u, game) > power(card, game));
}
function winnersOver(legal, trick, game) {
  if (!trick.length) return [];
  const best = currentWinner(trick, game);
  const led = effSuit(trick[0].card, game);
  return legal.filter((c) => {
    const t = [...trick, { p: -1, card: c }];
    return S.trickWinner(t, game) === -1 && beats(c, best.card, game, led);
  });
}

export function chooseCard(s, p) {
  const legal = S.legalFor(s, p);
  if (legal.length === 1) return legal[0];
  const g = s.game;
  const k = knowledge(s, p);
  if (g.type === 'ramsch') return ramschCard(s, p, legal, g);
  if (g.type === 'null') return p === s.declarer ? nullDeclCard(s, p, legal, g) : nullDefCard(s, p, legal, g, k);
  return p === s.declarer ? declCard(s, p, legal, g, k) : defCard(s, p, legal, g, k);
}

function declCard(s, p, legal, g, k) {
  const trick = s.trick;
  if (!trick.length) {
    const tr = legal.filter((c) => isTrump(c, g));
    const outT = k.unknown.filter((c) => isTrump(c, g));
    if (tr.length && outT.length) {
      const master = tr.filter((c) => isMaster(c, g, k.unknown)).sort((a, b) => power(b, g) - power(a, g));
      if (master.length) return master[0];
      if (tr.length >= outT.length || tr.length >= 3) return tr.slice().sort((a, b) => power(a, g) - power(b, g))[0];
    }
    const side = legal.filter((c) => !isTrump(c, g));
    const masters = side.filter((c) => isMaster(c, g, k.unknown)).sort((a, b) => eyes(b) - eyes(a));
    if (masters.length) return masters[0];
    if (side.length) {
      // kurze Farbe, kleiner Stein, keine ungeschützte Zehn
      const bySuit = {}; for (const c of side) (bySuit[suitOf(c)] ||= []).push(c);
      const suits = Object.values(bySuit).sort((a, b) => a.length - b.length);
      for (const cs of suits) { const lo = cs.filter((c) => rankOf(c) !== '10').sort((a, b) => eyes(a) - eyes(b) || power(a, g) - power(b, g)); if (lo.length) return lo[0]; }
      return lowest(side, g);
    }
    return lowest(legal, g);
  }
  return followGeneric(s, p, legal, g, k, false);
}

function defCard(s, p, legal, g, k) {
  const trick = s.trick, d = s.declarer;
  if (!trick.length) {
    const side = legal.filter((c) => !isTrump(c, g));
    const aces = side.filter((c) => rankOf(c) === 'A');
    if (aces.length) return aces[0];
    const masters = side.filter((c) => isMaster(c, g, k.unknown)).sort((a, b) => eyes(b) - eyes(a));
    if (masters.length) return masters[0];
    // Alleinspieler in Mittelhand? „Kurzer Weg, lange Farbe“: lange Farbe mit kleinem Stein
    if (side.length) {
      const bySuit = {}; for (const c of side) (bySuit[suitOf(c)] ||= []).push(c);
      const cs = Object.values(bySuit).sort((a, b) => b.length - a.length)[0];
      const lo = cs.filter((c) => rankOf(c) !== '10'); return lowest(lo.length ? lo : cs, g);
    }
    return lowest(legal, g);
  }
  return followGeneric(s, p, legal, g, k, true);
}

function followGeneric(s, p, legal, g, k, defender) {
  const trick = s.trick, d = s.declarer;
  const cur = currentWinner(trick, g);
  const last = trick.length === 2;
  const trickEyes = trick.reduce((a, t) => a + eyes(t.card), 0);
  const friendWins = defender ? cur.p !== d : false;
  const declarerStillToPlay = defender && !trick.some((t) => t.p === d);
  const wins = winnersOver(legal, trick, g);
  if (friendWins) {
    // Partner liegt vorn: schmieren, wenn der Alleinspieler nicht mehr drüber kann
    const safe = !declarerStillToPlay || isMaster(cur.card, g, k.unknown.filter((c) => !k.openHand || k.openHand.includes(c)));
    if (safe) { const nonT = legal.filter((c) => !isTrump(c, g) || rankOf(c) !== 'J'); return highestEyes(nonT.length ? nonT : legal, g); }
    return lowest(legal, g);
  }
  if (wins.length) {
    const cheapest = wins.slice().sort((a, b) => power(a, g) - power(b, g) || eyes(a) - eyes(b));
    if (last) {
      if (trickEyes > 0 || !isTrump(cheapest[0], g)) return cheapest[0];
    } else {
      const masterWins = wins.filter((c) => isMaster(c, g, k.unknown)).sort((a, b) => eyes(b) - eyes(a) || power(a, g) - power(b, g));
      if (masterWins.length && (trickEyes >= 3 || eyes(masterWins[0]) >= 10)) return masterWins[0];
      if (trickEyes >= 10) return wins.slice().sort((a, b) => power(b, g) - power(a, g))[0];
    }
  }
  return lowest(legal, g);
}

function nullDeclCard(s, p, legal, g) {
  const trick = s.trick;
  const byP = (a, b) => power(a, g) - power(b, g);
  if (!trick.length) return legal.slice().sort(byP)[0];
  const cur = currentWinner(trick, g);
  const led = effSuit(trick[0].card, g);
  const under = legal.filter((c) => !(effSuit(c, g) === led && power(c, g) > power(cur.card, g)));
  if (under.length) return under.sort(byP).at(-1);      // höchster Stein, der noch drunter bleibt
  return legal.slice().sort(byP).at(-1);
}
function nullDefCard(s, p, legal, g, k) {
  const trick = s.trick, d = s.declarer;
  const byP = (a, b) => power(a, g) - power(b, g);
  if (!trick.length) {
    if (k.openHand) {
      for (const c of legal.slice().sort(byP)) {
        const ds = k.openHand.filter((x) => suitOf(x) === suitOf(c));
        if (ds.length && ds.every((x) => power(x, g) > power(c, g))) return c;
      }
    }
    return legal.slice().sort(byP)[0];
  }
  const dPlayed = trick.find((t) => t.p === d);
  if (dPlayed) {
    const cur = currentWinner(trick, g);
    if (cur.p === d) {
      const led = effSuit(trick[0].card, g);
      const under = legal.filter((c) => !(effSuit(c, g) === led && power(c, g) > power(dPlayed.card, g)));
      if (under.length) return under.sort(byP).at(-1);
    }
    return legal.slice().sort(byP).at(-1);
  }
  return legal.slice().sort(byP)[0];
}
function ramschCard(s, p, legal, g) {
  const trick = s.trick;
  if (!trick.length) return legal.slice().sort((a, b) => power(a, g) - power(b, g) || eyes(a) - eyes(b))[0];
  const cur = currentWinner(trick, g);
  const led = effSuit(trick[0].card, g);
  const under = legal.filter((c) => !beats(c, cur.card, g, led));
  if (under.length) return under.sort((a, b) => power(b, g) - power(a, g) || eyes(b) - eyes(a))[0];
  if (trick.length === 2) return legal.slice().sort((a, b) => eyes(a) - eyes(b) || power(b, g) - power(a, g))[0];
  return legal.slice().sort((a, b) => power(b, g) - power(a, g))[0];
}

// Komplette Runde mit vier Computern (Tests / Simulation)
export function autoDeal(s0) {
  let s = s0;
  while (s.phase === 'bid') { const t = S.bidTurn(s); s = S.applyBid(s, t.p, chooseBid(s, t.p)); }
  if (s.phase === 'skat') {
    s = S.chooseSkat(s, s.declarer, chooseTakeSkat(s, s.declarer));
    if (s.phase === 'discard') s = S.discard(s, s.declarer, chooseDiscard(s, s.declarer));
    s = S.announce(s, s.declarer, chooseGame(s, s.declarer));
    while (s.phase === 'kontra') { const t = S.kontraTurn(s); s = S.applyKontra(s, t.p, chooseKontra(s, t.p)); }
  }
  while (s.phase === 'play') s = S.playCard(s, s.turn, chooseCard(s, s.turn)).state;
  return s;
}
