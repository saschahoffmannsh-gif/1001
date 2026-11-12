// Selbstspiel Computer gegen Computer: prüft Regeln und kalibriert das Reizen.
import * as R from '../src/game/rules.js';
import * as AI from '../src/game/ai.js';
export function playDeal(forehand, log = false, bidders = [AI.chooseBid, AI.chooseBid]) {
  let st = R.newDealState({ forehand });
  const est = [AI.handEstimate(st.hands[0]), AI.handEstimate(st.hands[1])];
  while (st.phase === 'bidding') st = R.applyBid(st, st.turn, bidders[st.turn](st, st.turn));
  while (st.phase === 'play') {
    const p = st.turn; const m = AI.chooseMove(st, p);
    const r = R.playCard(st, p, m.card, { declare: m.declare });
    if (log) for (const e of r.events) if (e.type !== 'draw') console.log(JSON.stringify(e));
    st = r.state;
  }
  return { st, est };
}
if ((process.argv[1] || '').endsWith('sim.mjs')) {
  const N = Number(process.argv[2] || 400);
  let xs = [], ys = [], made = 0, bids = 0, t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const { st, est } = playDeal(i % 2, false, [() => 'pass', () => 'pass']);
    for (const p of [0, 1]) { xs.push(est[p]); ys.push(st.result.points[p]); }
  }
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let sxy = 0, sxx = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const slope = sxy / sxx; let res = 0; for (let i = 0; i < xs.length; i++) res += (ys[i] - (my + slope * (xs[i] - mx))) ** 2;
  console.log({ deals: N, meanEst: mx.toFixed(1), meanPts: my.toFixed(1), slope: slope.toFixed(2), rmse: Math.sqrt(res / xs.length).toFixed(1), ms: Date.now() - t0 });
  for (let i = 0; i < N; i++) {
    const { st } = playDeal(i % 2);
    bids++; if (st.result.made) made++;
  }
  console.log({ withBidding: N, contractsMade: (made / bids * 100).toFixed(0) + '%' });
}
