import { chromium } from '/workspace/roller/node_modules/playwright/index.mjs';
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('console:', m.text().slice(0, 200)); });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
p.on('response', (r) => { if (r.url().includes('supabase')) console.log('supabase', r.request().method(), r.status(), r.url().slice(0, 90)); });
await p.goto('https://saschahoffmannsh-gif.github.io/1001/?still');
await p.waitForFunction(() => !document.getElementById('btn-start').disabled, null, { timeout: 90000 });
await p.screenshot({ path: '/workspace/1001-previews/live_start.png', timeout: 120000 });
await p.fill('#name', 'Testlauf');
await p.click('#btn-start');
await p.waitForTimeout(12000);
await p.screenshot({ path: '/workspace/1001-previews/live_bidding.png', timeout: 120000 });
// Hilfe öffnen
await b.close();
