// 1001-Testlauf über die Card-Master-Hülle: Spielauswahl -> 1001 -> Spieler -> Partie (Autoplay). Zählt API-Aufrufe (müssen 0 sein).
// node tools/playcheck.mjs <base-url> <prefix> <players> [w h] [secs]
import { chromium } from '/workspace/pw/node_modules/playwright/index.mjs';
const [,, base, prefix, players = 3, w = 1280, h = 800, secs = 400] = process.argv;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const calls = [];
p.on('request', (r) => { if (r.url().includes('/functions/v1/tu')) calls.push(r.method() + ' ' + r.url()); });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto(base + '?autoplay&still&fast');
await p.waitForFunction(() => !document.getElementById('btn-start').disabled, null, { timeout: 120000 });
await p.click('.game[data-game="1001"]');
await p.click(`#pcount button[data-n="${players}"]`);
await p.click('#btn-start');
const shot = async (n) => { await p.screenshot({ path: `${prefix}_${n}.png`, timeout: 180000 }); console.log('shot', n); };
await p.waitForTimeout(6000); await shot('play');
let gotResult = false, gotMenu = false;
const t0 = Date.now();
while (Date.now() - t0 < secs * 1000) {
  await p.waitForTimeout(500);
  if (!gotResult && await p.isVisible('#result')) { await shot('result'); gotResult = true; await p.click('#res-next', { timeout: 3000 }).catch(() => {}); }
  else if (await p.isVisible('#result')) await p.click('#res-next', { timeout: 3000 }).catch(() => {});
  if (await p.isVisible('#matchend')) { await p.waitForTimeout(800); await shot('matchend'); break; }
  if (gotResult && !gotMenu) { await p.click('#btn-menu'); await p.waitForTimeout(300); await shot('menu'); await p.click('#m-resume'); gotMenu = true; }
}
const s = await p.evaluate(() => { const g = window.__game(); return { totals: g.match.totals, deals: g.match.deals.length, winner: g.match.winner, save: document.getElementById('me-save').textContent }; });
console.log(JSON.stringify(s)); console.log('api calls', calls.length, calls);
await b.close();
