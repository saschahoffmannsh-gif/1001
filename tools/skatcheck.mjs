// Skat-Testlauf über die Hülle: Spielauswahl -> Skat -> Spieler -> Serie (Autoplay). Zählt API-Aufrufe (müssen 0 sein).
// node tools/skatcheck.mjs <base-url> <prefix> <players> [w h] [secs] [shots=1]
import { chromium } from '/workspace/pw/node_modules/playwright/index.mjs';
const [,, base, prefix, players = 3, w = 1280, h = 800, secs = 600, shots = '1'] = process.argv;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const calls = [];
p.on('request', (r) => { if (r.url().includes('/functions/v1/tu')) calls.push(r.method() + ' ' + r.url()); });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
await p.goto(base + '?autoplay&still&fast');
await p.waitForFunction(() => !document.getElementById('sk-start').disabled, null, { timeout: 120000 });
await p.click('.game[data-game="skat"]');
await p.click(`#sk-pcount button[data-n="${players}"]`);
await p.click('#sk-start');
const shot = async (n) => { if (shots === '1') { await p.screenshot({ path: `${prefix}_${n}.png`, timeout: 180000 }); console.log('shot', n); } };
const t0 = Date.now(); let deals = 0, seenPlay = false;
while (Date.now() - t0 < secs * 1000) {
  await p.waitForTimeout(400);
  if (await p.isVisible('#matchend')) { await p.waitForTimeout(800); await shot('matchend'); break; }
  if (!seenPlay && await p.evaluate(() => window.__skat?.().s?.phase === 'play' && (window.__skat().s.record.plays || []).length >= 4)) { await shot('play'); seenPlay = true; }
  if (await p.isVisible('#result')) { deals++; if (deals === 1) await shot('result'); await p.click('#res-next').catch(() => {}); }
}
const s = await p.evaluate(() => { const m = window.__skat?.().m; return m ? { totals: m.totals, deals: m.deals.length, wins: m.wins, losses: m.losses } : null; });
console.log(JSON.stringify(s), 'deals seen', deals, 'secs', Math.round((Date.now() - t0) / 1000)); console.log('api calls', calls.length, calls);
await b.close();
