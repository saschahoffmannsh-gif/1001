// Computer-Gegner: nutzt nur eigene Hand + offen gespielte/gemeldete Steine.
export let AI_SEARCH_DEPTH = 7;
export function setSearchDepth(n) { AI_SEARCH_DEPTH = n; }
import { SUITS, RANKS, MARRIAGE, BID_MIN, BID_STEP, BID_MAX, suitOf, rankOf, valueOf, strength, other, newDeck,
  legalMoves, trickWinner, currentWinner, declarableSuits, auctionOptions, minBid } from './rules.js';

// ------------------------------------------------------------ Wissen des Computers
// Jeder Computer kennt nur: eigene Hand, gespielte Steine, gemeldete Hochzeiten, eigene gedrückte Steine.
export function knowledge(st, p) {
  const n = st.n || 2;
  const seen = new Set(st.hands[p]);
  for (const h of st.history) for (const t of (h.cards || [h.lead, h.follow])) seen.add(t.card);
  for (const t of st.trick) seen.add(t.card);
  if (st.contract && st.contract.by === p) for (const c of st.discard || []) seen.add(c);
  // Gemeldete Hochzeiten verraten den Partner auf einer Gegnerhand
  const knownOpp = new Set();
  for (let o = 0; o < n; o++) {
    if (o === p) continue;
    for (const s of st.melds[o]) for (const r of ['K', 'Q']) { const c = s + r; if (!seen.has(c)) knownOpp.add(c); }
  }
  const unseen = newDeck(n).filter((c) => !seen.has(c));
  let oppCount = 0; for (let o = 0; o < n; o++) if (o !== p) oppCount += st.hands[o].length;
  return { unseen, knownOpp, oppCount, stockCount: st.stock.length };
}

// ------------------------------------------------------------ Reizen
// Grundwert je Spielerzahl (mit tools/sim.mjs kalibriert): mehr Gegner = weniger Augen pro Hand
export const EST_BASE = { 2: 24, 3: 14, 4: 0 };
export function handEstimate(hand, n = 2) {
  let est = EST_BASE[n] ?? 24;
  for (const c of hand) est += { A: 11.5, '10': 8.5, K: 3.5, Q: 2.5, J: 1.5, '9': 0.5, '8': 0.3, '7': 0.2 }[rankOf(c)];
  const partnerChance = n === 2 ? 0.12 : n === 3 ? 0.05 : 0;      // Partner könnte aus Stock/Talon kommen
  for (const s of SUITS) {
    const k = hand.includes(s + 'K'), q = hand.includes(s + 'Q');
    if (k && q) est += MARRIAGE[s] * 0.85;
    else if (k || q) est += MARRIAGE[s] * partnerChance;
    const m = hand.filter((c) => suitOf(c) === s).length;
    if (m >= 4) est += 4;
  }
  return est;
}
export function maxBidFor(hand, n = 2) {
  const est = handEstimate(hand, n);
  return Math.floor((est - 8) / BID_STEP) * BID_STEP;
}
// Reizen nacheinander: nur genau +10 oder passen
export function chooseBid(st, p) {
  const limit = maxBidFor(st.hands[p], st.n || 2);
  const need = minBid(st.auction);
  return need <= Math.min(limit, BID_MAX) ? need : 'pass';
}
// 3 Spieler: Reizgewinner drückt 2 Steine (zählen für ihn). Blanke Zehnen und kurze Farben bevorzugt.
export function chooseDiscard(st, p, count = 2) {
  const hand = st.hands[p];
  const scored = hand.map((c) => {
    const s = suitOf(c), r = rankOf(c);
    const inSuit = hand.filter((x) => suitOf(x) === s);
    let v = 0;
    if ((r === 'K' || r === 'Q') && hand.includes(s + (r === 'K' ? 'Q' : 'K'))) v -= 100;   // Hochzeit behalten
    if (r === 'A') v -= 30;                                                                     // Asse stechen selbst
    if (r === '10') v += hand.includes(s + 'A') ? -10 : 14;                                     // blanke Zehn sichern
    v += valueOf(c) * 0.5 + (5 - inSuit.length) * 2 - strength(c) * 0.3;
    return { c, v };
  });
  scored.sort((a, b) => b.v - a.v);
  return scored.slice(0, count).map((x) => x.c);
}

// ------------------------------------------------------------ Hilfen
function pBeatByOpp(card, trump, unseen, knownOpp, oppCount) {
  const s = suitOf(card);
  const beaters = unseen.filter((c) => (suitOf(c) === s && strength(c) > strength(card)) || (trump && s !== trump && suitOf(c) === trump));
  if (beaters.some((c) => knownOpp.has(c))) return 1;
  const n = unseen.length || 1, k = beaters.length;
  let pNone = 1;
  for (let i = 0; i < oppCount; i++) pNone *= Math.max(0, (n - k - i) / (n - i));
  return 1 - pNone;
}
function marriagePotential(card, hand, st, unseen) {
  const r = rankOf(card), s = suitOf(card);
  if ((r !== 'K' && r !== 'Q') || st.declared[s] !== undefined) return 0;
  const partner = s + (r === 'K' ? 'Q' : 'K');
  if (hand.includes(partner)) return MARRIAGE[s];               // fertige Hochzeit
  if (unseen.includes(partner) && st.stock.length > 0) return MARRIAGE[s] * 0.25;
  return 0;
}

// ------------------------------------------------------------ Vollständige Suche (Stock leer, alles bekannt)
function solve(hands, leader, trump, declared, me, memo, alpha, beta) {
  // liefert (meine Punkte - Gegnerpunkte) der Restrunde, Hochzeiten zählen sofort (vereinfachend)
  if (hands[0].length === 0) return 0;
  const key = hands[0].join(',') + '|' + hands[1].join(',') + '|' + leader + '|' + (trump || '-') + '|' + declared;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const f = other(leader);
  const sign = leader === me ? 1 : -1;
  let best = -Infinity * sign;
  const leads = [];
  for (const c of hands[leader]) {
    leads.push({ c, decl: false });
    const r = rankOf(c), s = suitOf(c);
    if ((r === 'K' || r === 'Q') && !declared.includes(s) && hands[leader].includes(s + (r === 'K' ? 'Q' : 'K'))) leads.push({ c, decl: true });
  }
  for (const { c, decl } of leads) {
    const t = decl ? suitOf(c) : trump;
    const meld = decl ? MARRIAGE[suitOf(c)] : 0;
    const lh = hands[leader].filter((x) => x !== c);
    const resp = legalMoves(hands[f], c, t, true);
    let worst = Infinity * sign;
    for (const r of resp) {
      const fh = hands[f].filter((x) => x !== r);
      const w = trickWinner({ p: leader, card: c }, { p: f, card: r }, t);
      const pts = valueOf(c) + valueOf(r);
      const nh = leader === 0 ? [lh, fh] : [fh, lh];
      const sub = solve(nh, w, t, decl ? declared + suitOf(c) : declared, me, memo, -Infinity, Infinity);
      const v = (w === me ? pts : -pts) + (leader === me ? meld : -meld) + sub;
      if (sign > 0 ? v < worst : v > worst) worst = v;   // Gegner minimiert
    }
    if (sign > 0 ? worst > best : worst < best) best = worst;
  }
  memo.set(key, best);
  return best;
}

function solveChoice(st, p, legal, oppHand) {
  const me = p, o = other(p);
  const memo = new Map();
  const declaredStr = Object.keys(st.declared).join('');
  let best = null, bestV = -Infinity;
  if (st.trick.length === 0) {
    const options = [];
    for (const c of legal) {
      options.push({ c, decl: false });
      if (declarableSuits(st, p).includes(suitOf(c)) && (rankOf(c) === 'K' || rankOf(c) === 'Q')) options.push({ c, decl: true });
    }
    for (const { c, decl } of options) {
      const t = decl ? suitOf(c) : st.trump;
      const lh = st.hands[p].filter((x) => x !== c);
      let worst = Infinity;
      for (const r of legalMoves(oppHand, c, t, true)) {
        const fh = oppHand.filter((x) => x !== r);
        const w = trickWinner({ p, card: c }, { p: o, card: r }, t);
        const pts = valueOf(c) + valueOf(r);
        const nh = p === 0 ? [lh, fh] : [fh, lh];
        const v = (w === me ? pts : -pts) + (decl ? MARRIAGE[suitOf(c)] : 0) + solve(nh, w, t, decl ? declaredStr + suitOf(c) : declaredStr, me, memo);
        worst = Math.min(worst, v);
      }
      if (worst > bestV) { bestV = worst; best = { card: c, declare: decl }; }
    }
  } else {
    const lead = st.trick[0];
    for (const r of legal) {
      const myRest = st.hands[p].filter((x) => x !== r);
      const w = trickWinner(lead, { p, card: r }, st.trump);
      const pts = valueOf(lead.card) + valueOf(r);
      const nh = p === 0 ? [myRest, oppHand] : [oppHand, myRest];
      const v = (w === me ? pts : -pts) + solve(nh, w, st.trump, declaredStr, me, memo);
      if (v > bestV) { bestV = v; best = { card: r, declare: false }; }
    }
  }
  return best;
}

// ------------------------------------------------------------ Zugwahl
export function chooseMove(st, p) {
  const hand = st.hands[p];
  const n = st.n || 2;
  const legal = legalMoves(hand, st.trick.map((t) => t.card), st.trump, st.stock.length === 0);
  const K = knowledge(st, p);
  const trump = st.trump;

  // Stock leer: Gegnerhand ist durch Mitzählen bekannt -> exakte Suche (ab 6 Steinen je Hand)
  if (n === 2 && st.stock.length === 0 && hand.length <= AI_SEARCH_DEPTH) {
    const oppHand = K.unseen;  // genau die Gegnerhand
    const choice = solveChoice(st, p, legal, oppHand);
    if (choice) return choice;
  }

  if (st.trick.length === 0) {
    // Ausspielen
    const decl = declarableSuits(st, p).sort((a, b) => MARRIAGE[b] - MARRIAGE[a]);
    if (decl.length) {
      const s = decl[0];
      return { card: s + 'Q', declare: true };
    }
    let best = null, bestEV = -Infinity;
    for (const c of legal) {
      const pb = pBeatByOpp(c, trump, K.unseen, K.knownOpp, K.oppCount);
      const v = valueOf(c);
      let ev = (1 - 2 * pb) * (v + 3) - marriagePotential(c, hand, st, K.unseen) * 0.6;
      if (trump && suitOf(c) === trump) ev -= st.stock.length ? 6 : 2;
      if (st.stock.length === 0 && pb === 0) ev += 6;   // sicherer Stich
      ev += Math.random() * 0.5;                        // kleine Varianz
      if (ev > bestEV) { bestEV = ev; best = c; }
    }
    return { card: best, declare: false };
  }

  // Bedienen / Stechen
  const ownMarriage = declarableSuitsAfterLead(hand, st);
  const later = n - st.trick.length - 1;                    // wie viele nach mir noch legen
  const sofar = st.trick.reduce((a, t) => a + valueOf(t.card), 0);
  const opts = legal.map((c) => {
    const nowW = currentWinner([...st.trick, { p, card: c }], trump).p === p;
    // Risiko, dass ein Späterer noch drüber geht (nur grob, aus den ungesehenen Steinen)
    const risk = nowW && later > 0 ? pBeatByOpp(c, trump, K.unseen, K.knownOpp, Math.min(K.oppCount, later * 3)) : 0;
    const w = nowW && risk < 0.5;
    const pts = sofar + valueOf(c);
    let score = nowW ? pts * (1 - 2 * risk) : -pts;
    // eigene Werte schonen / Hochzeiten nicht zerreißen
    score -= marriagePotential(c, hand, st, K.unseen) * (w ? 0.35 : 0.7);
    if (trump && suitOf(c) === trump) score -= (st.stock.length ? 4 : 1) + strength(c) * 0.8;
    if (!w) score -= valueOf(c) * 0.6;
    if (w && ownMarriage) score += 8;                     // Ausspielrecht für Meldung
    if (w && st.stock.length) score += 2;                 // zuerst nachziehen
    if (w) score -= strength(c) * 0.15;                   // billig gewinnen
    return { c, score };
  });
  opts.sort((a, b) => b.score - a.score);
  return { card: opts[0].c, declare: false };
}

function declarableSuitsAfterLead(hand, st) {
  return SUITS.some((s) => st.declared[s] === undefined && hand.includes(s + 'K') && hand.includes(s + 'Q'));
}
