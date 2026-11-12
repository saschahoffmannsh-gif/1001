// Vorschau-Bilder: Reizrunde nach einem Gegengebot und Spielmitte. node tools/shots2.mjs <players> <w> <h> <prefix>
import { chromium } from '/workspace/pw/node_modules/playwright/index.mjs';
const [,, players = 2, w = 390, h = 844, prefix = '/workspace/1001-previews/x'] = process.argv;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +w < 500 ? 2 : 1 });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
const S = () => p.evaluate(() => { const g = window.__game(); const st = g.st; return st ? { phase: st.phase, turn: st.turn, high: st.auction.high, trick: st.trickNo, trump: st.trump, contract: st.contract } : null; });
await p.goto(`http://localhost:4317/1001/?autostart&still&players=${players}`);
const until = async (f, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await S(); if (s && f(s)) return s; await p.waitForTimeout(400); } return null; };
// Reizen: Mensch reizt, bis ein Computer erhöht hat und der Mensch wieder dran ist
let s = await until((s) => s.phase === 'bidding' && s.turn === 0 && !(s.high));
if (s) await p.click('#bid-up');
s = await until((s) => s.phase !== 'bidding' || (s.turn === 0 && s.high && s.high.p !== 0), 30000);
await p.waitForTimeout(600);
console.log('bid state', JSON.stringify(s));
await p.screenshot({ path: prefix + '_bid.png', timeout: 180000 });
// weiter: Mensch reizt noch einmal und passt dann
for (let k = 0; k < 6; k++) {
  s = await S(); if (!s || s.phase !== 'bidding') break;
  if (s.turn === 0 && !(await p.$eval('#bid-up', (e) => e.disabled))) { await p.click(k === 0 ? '#bid-up' : '#bid-pass'); }
  await p.waitForTimeout(1500);
}
// Drücken (3 Spieler, falls Mensch gewonnen)
s = await until((s) => s.phase === 'play' || s.phase === 'discard', 20000);
if (s && s.phase === 'discard' && s.contract.by === 0) {
  await p.waitForTimeout(800); await p.screenshot({ path: prefix + '_discard.png', timeout: 180000 });
  await p.evaluate(() => { const g = window.__game(); const t = window.__table; const hand = g.st.hands[0]; t.onPick(hand[0]); t.onPick(hand[1]); });
  await p.waitForTimeout(300); await p.screenshot({ path: prefix + '_discard2.png', timeout: 180000 });
  await p.click('#disc-ok');
}
// Spiel: Mensch spielt zufällige zulässige Steine, bis ein paar Stiche gelegt sind
for (let k = 0; k < 400; k++) {
  s = await S(); if (!s) break;
  if (s.phase === 'play' && s.trick >= Math.max(3, players == 2 ? 6 : 4)) break;
  await p.evaluate(() => {
    const g = window.__game(); const t = window.__table; const st = g.st;
    if (st.phase === 'play' && st.turn === 0 && t.onPick) {
      if (!document.getElementById('meld').classList.contains('hidden')) { document.getElementById('meld-yes').click(); return; }
      const legal = [...t.pickable]; if (legal.length) t.onPick(legal[Math.floor(Math.random() * legal.length)]);
    }
  });
  await p.waitForTimeout(300);
}
await p.waitForTimeout(1500);
console.log('play state', JSON.stringify(await S()));
await p.screenshot({ path: prefix + '_play.png', timeout: 180000 });
await b.close();
