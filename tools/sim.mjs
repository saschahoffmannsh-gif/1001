// Selbstspiel Computer gegen Computer: prüft Regeln und kalibriert das Reizen (2, 3 und 4 Spieler).
import * as R from '../src/game/rules.js';
import * as AI from '../src/game/ai.js';
export function playDeal(forehand, log = false, bidder = AI.chooseBid, players = 2) {
  let st = R.newDealState({ forehand, players });
  const est = st.hands.map((h) => AI.handEstimate(h, players));
  while (st.phase === 'bidding') st = R.applyBid(st, st.turn, bidder(st, st.turn));
  if (st.phase === 'discard') st = R.applyDiscard(st, st.contract.by, AI.chooseDiscard(st, st.contract.by, st.skat.length));
  while (st.phase === 'play') {
    const p = st.turn; const m = AI.chooseMove(st, p);
    const r = R.playCard(st, p, m.card, { declare: m.declare });
    if (log) for (const e of r.events) if (e.type !== 'draw') console.log(JSON.stringify(e));
    st = r.state;
  }
  return { st, est };
}
if ((process.argv[1] || '').endsWith('sim.mjs')) {
  const N = Number(process.argv[2] || 300);
  for (const n of [2, 3, 4]) {
    const t0 = Date.now();
    // Schätzung gegen tatsächliche Punkte, wenn der Spieler selbst das (Pflicht-)Spiel hat
    let xs = [], ys = [];
    for (let i = 0; i < N; i++) {
      const fh = i % n;
      const { st, est } = playDeal(fh, false, () => 'pass', n);
      xs.push(est[fh]); ys.push(st.result.points[fh]);
    }
    let made = 0;
    for (let i = 0; i < N; i++) { const { st } = playDeal(i % n, false, AI.chooseBid, n); if (st.result.made) made++; }
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    console.log({ n, meanEst: mean(xs).toFixed(1), meanPts: mean(ys).toFixed(1), made: (made / N * 100).toFixed(0) + '%', ms: Date.now() - t0 });
  }
}
