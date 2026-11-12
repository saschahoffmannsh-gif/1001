// Computer-Gegner: nutzt nur eigene Hand + offen gespielte/gemeldete Steine.
export let AI_SEARCH_DEPTH = 7;
export function setSearchDepth(n) { AI_SEARCH_DEPTH = n; }
import { SUITS, RANKS, MARRIAGE, BID_MIN, BID_STEP, suitOf, rankOf, valueOf, strength, other, newDeck,
  legalMoves, trickWinner, declarableSuits, auctionOptions, minBid } from './rules.js';

// ------------------------------------------------------------ Wissen des Computers
export function knowledge(st, p) {
  const seen = new Set(st.hands[p]);
  for (const h of st.history) { seen.add(h.lead.card); seen.add(h.follow.card); }
  for (const t of st.trick) seen.add(t.card);
  // Gemeldete Hochzeiten verraten den Partner auf der Gegnerhand
  const knownOpp = new Set();
  const o = other(p);
  for (const s of st.melds[o]) {
    for (const r of ['K', 'Q']) {
      const c = s + r;
      const played = st.history.some((h) => h.lead.card === c || h.follow.card === c) || st.trick.some((t) => t.card === c);
      if (!played) knownOpp.add(c);
    }
  }
  const unseen = newDeck().filter((c) => !seen.has(c));
  return { unseen, knownOpp, oppCount: st.hands[o].length, stockCount: st.stock.length };
}

// ------------------------------------------------------------ Reizen
export function handEstimate(hand, unseenAll) {
  let est = 24;
  for (const c of hand) est += { A: 11.5, '10': 8.5, K: 3.5, Q: 2.5, J: 1.5, '9': 0.5 }[rankOf(c)];
  for (const s of SUITS) {
    const k = hand.includes(s + 'K'), q = hand.includes(s + 'Q');
    if (k && q) est += MARRIAGE[s] * 0.85;
    else if (k || q) est += MARRIAGE[s] * 0.12; // Partner koennte aus dem Stock kommen
    const n = hand.filter((c) => suitOf(c) === s).length;
    if (n >= 4) est += 4;
  }
  return est;
}
export function maxBidFor(hand) {
  const est = handEstimate(hand);
  return Math.floor((est - 8) / BID_STEP) * BID_STEP;
}
export function chooseBid(st, p) {
  const a = st.auction;
  const limit = maxBidFor(st.hands[p]);
  const need = minBid(a);
  if (need <= limit) return need;            // minimal erhöhen
  return 'pass';
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
  const legal = (() => {
    const lead = st.trick.length ? st.trick[0].card : null;
    return legalMoves(hand, lead, st.trump, st.stock.length === 0);
  })();
  const K = knowledge(st, p);
  const trump = st.trump;

  // Stock leer: Gegnerhand ist durch Mitzählen bekannt -> exakte Suche (ab 6 Steinen je Hand)
  if (st.stock.length === 0 && hand.length <= AI_SEARCH_DEPTH) {
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
  const lead = st.trick[0];
  const L = lead.card;
  const ownMarriage = declarableSuitsAfterLead(hand, st);
  const opts = legal.map((c) => {
    const w = trickWinner(lead, { p, card: c }, trump) === p;
    const pts = valueOf(L) + valueOf(c);
    let score = w ? pts : -pts;
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
