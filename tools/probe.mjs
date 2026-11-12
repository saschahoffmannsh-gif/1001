import { chromium } from '/workspace/pw/node_modules/playwright/index.mjs';
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
p.on('console', (m) => console.log('console:', m.type(), m.text().slice(0, 200)));
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto(process.argv[2]);
for (let i = 0; i < 8; i++) {
  await p.waitForTimeout(3000);
  const r = await p.evaluate(() => { const t = window.__table; if (!t) return 'no table'; const t0 = performance.now(); t.invalidate(); t.frame(); return { ms: performance.now() - t0, tiles: t.tiles.size, tweens: t.tweens.length, gl: t.renderer.getContext().getParameter(t.renderer.getContext().VERSION) }; }).catch(e => 'eval err ' + e.message);
  console.log(i, JSON.stringify(r));
}
await b.close();
