// Skat-Vorschaubilder: Mensch reizt immer mit, Screenshots von Reizen, Skat, Drücken, Ansage, Spiel, Ergebnis.
// node tools/skatshots.mjs <base-url> <prefix> <players> [w h]
import { chromium } from '/workspace/pw/node_modules/playwright/index.mjs';
const [,, base, prefix, players = 3, w = 1280, h = 800] = process.argv;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const calls = [];
p.on('request', (r) => { if (r.url().includes('/functions/v1/tu')) calls.push(r.method() + ' ' + r.url()); });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto(base + `?autostart&game=skat&players=${players}&still&fast`);
const shot = async (n) => { await p.waitForTimeout(500); await p.screenshot({ path: `${prefix}_${n}.png`, timeout: 180000 }); console.log('shot', n); };
const pend = () => p.evaluate(() => window.__skatPending?.kind || null);
const auto = () => p.evaluate(() => window.__skatPending?.auto());
const want = new Set(['bid', 'skat', 'discard', 'announce', 'play', 'sitout', 'result']);
const t0 = Date.now(); let declarer = false, nb = 0;
while (want.size && Date.now() - t0 < 500000) {
  await p.waitForTimeout(150);
  const k = await pend();
  const st = await p.evaluate(() => { const { s } = window.__skat(); return s ? { sit: s.sitting, plays: s.record.plays.length, decl: s.declarer, bid: s.bid } : {}; });
  if (+players === 4 && st.sit === 0 && want.has('sitout') && st.plays >= 6) { await shot('aussetzen'); want.delete('sitout'); }
  if (!k) continue;
  if (k === 'bid') {
    if (want.has('bid') && ++nb >= 2) { await shot('reizen'); want.delete('bid'); }
    await p.click('#skb-yes'); continue;
  }
  if (k === 'skat') { if (want.has('skat')) { await shot('skat'); want.delete('skat'); } await p.click('#skc-a'); continue; }
  if (k === 'discard') { if (want.has('discard')) { await p.evaluate(() => { const { s } = window.__skat(); window.__skatPick(s.hands[0].slice(-2)); }); await shot('druecken'); want.delete('discard'); } await auto(); continue; }
  if (k === 'announce') { if (want.has('announce')) { await shot('ansage'); want.delete('announce'); } await auto(); continue; }
  if (k === 'play' && st.plays >= 9 && want.has('play')) { await shot('spiel'); want.delete('play'); }
  if (k === 'result' && want.has('result')) { await shot('ergebnis'); want.delete('result'); }
  if (+players !== 4) want.delete('sitout');
  await auto();
}
console.log('left', [...want], 'api calls', calls.length);
await b.close();
