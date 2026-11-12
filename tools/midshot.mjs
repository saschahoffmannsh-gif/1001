// Bild aus der Spielmitte (ohne Autoplay, Testlauf speichert nichts): node tools/midshot.mjs <url> <out> <w> <h> [stich] [bidshot]
import { chromium } from '/workspace/pw/node_modules/playwright/index.mjs';
const [,, url, out, w = 1280, h = 800, at = 5, bidOut = ''] = process.argv;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto(url);
const t0 = Date.now(); let bidShot = !bidOut;
while (Date.now() - t0 < 150000) {
  const s = await p.evaluate(() => { const g = window.__game(); const st = g.st; return st ? { ph: st.phase, tr: st.trickNo, turn: st.turn, high: st.auction.high, by: st.contract && st.contract.by } : null; });
  if (!s) { await p.waitForTimeout(300); continue; }
  if (s.ph === 'play' && s.tr >= +at && s.turn === 0) break;
  const act = await p.evaluate(({ s, bidShot }) => {
    const $ = (id) => document.getElementById(id); const t = window.__table; const st = window.__game().st;
    if (s.ph === 'bidding' && s.turn === 0 && !$('bid-up').disabled) {
      if (!bidShot && s.high) return 'shoot';
      (s.high && s.high.value >= 60 ? $('bid-pass') : $('bid-up')).click(); return 'bid';
    }
    if (s.ph === 'discard' && s.by === 0 && t.onPick && !$('discard').classList.contains('hidden')) { t.onPick(st.hands[0][0]); t.onPick(st.hands[0][1]); $('disc-ok').click(); return 'disc'; }
    if (s.ph === 'play' && s.turn === 0 && t.onPick) {
      if (!$('meld').classList.contains('hidden')) { $('meld-yes').click(); return 'meld'; }
      const legal = [...t.pickable]; if (legal.length) t.onPick(legal[Math.floor(Math.random() * legal.length)]); return 'play';
    }
    return '';
  }, { s, bidShot });
  if (act === 'shoot') { await p.waitForTimeout(500); await p.screenshot({ path: bidOut, timeout: 120000 }); bidShot = true; console.log('ok', bidOut); }
  await p.waitForTimeout(250);
}
await p.waitForTimeout(1200);
await p.screenshot({ path: out, timeout: 120000 });
console.log('ok', out);
await b.close();
