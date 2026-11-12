import { chromium } from '/workspace/roller/node_modules/playwright/index.mjs';
const [,, url, out, secs = 90, w = 1280, h = 800] = process.argv;
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('console:', m.type(), m.text().slice(0, 300)); });
p.on('pageerror', (e) => console.log('pageerror:', e.message, e.stack?.slice(0, 300)));
await p.goto(url);
const t0 = Date.now();
while (Date.now() - t0 < secs * 1000) {
  await p.waitForTimeout(10000);
  const s = await p.evaluate(() => { const g = window.__game(); return g.match ? { totals: g.match.totals, deals: g.match.deals.length, winner: g.match.winner, phase: g.st?.phase, trick: g.st?.trickNo } : null; });
  console.log(Math.round((Date.now() - t0) / 1000) + 's', JSON.stringify(s));
  if (s && s.winner !== null && s.winner !== undefined) break;
}
await p.screenshot({ path: out, timeout: 120000 });
await b.close();
