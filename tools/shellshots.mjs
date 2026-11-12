// Vorschau der Card-Master-Hülle. API wird im Browser abgefangen (Beispieldaten), es wird nichts gespeichert.
// node tools/shellshots.mjs <base-url> <prefix> [w h]
import { chromium } from '/workspace/pw/node_modules/playwright/index.mjs';
const [,, base = 'http://localhost:4317/1001/', prefix = '/workspace/1001-previews/cm', w = 1280, h = 800] = process.argv;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +w < 500 ? 2 : 1 });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
const now = Date.now(), d = (h) => new Date(now - h * 3600e3).toISOString();
const stats = [{ game: '1001', matches_played: 9, wins: 6, losses: 3, deals_played: 71, best_total: 1180, last_played_at: d(2) }];
const all = [
  { rank: 1, display_name: 'Sascha', wins: 6, losses: 3, matches_played: 9 }, { rank: 2, display_name: 'Mila', wins: 6, losses: 4, matches_played: 10 },
  { rank: 3, display_name: 'Jonas', wins: 4, losses: 1, matches_played: 5 }, { rank: 4, display_name: 'Lea', wins: 2, losses: 5, matches_played: 7 },
];
const g1001 = [
  { rank: 1, display_name: 'Mila', wins: 6, losses: 4, best_total: 1230 }, { rank: 2, display_name: 'Sascha', wins: 6, losses: 3, best_total: 1180 },
  { rank: 3, display_name: 'Jonas', wins: 4, losses: 1, best_total: 1090 }, { rank: 4, display_name: 'Lea', wins: 2, losses: 5, best_total: 1040 },
];
const hist = [{ game: '1001', human_total: 1040, computer_total: 860, winner: 'human', deals: 8, created_at: d(2) },
  { game: '1001', human_total: 720, computer_total: 1010, winner: 'computer', deals: 9, created_at: d(26) }];
const writes = [];
await p.route('**/functions/v1/tu**', async (r) => {
  const u = new URL(r.request().url()); const a = u.searchParams.get('action');
  if (r.request().method() !== 'GET' && r.request().method() !== 'OPTIONS') writes.push(r.request().postData());
  const body = a === 'leaderboard' ? { leaderboard: u.searchParams.get('game') === '1001' ? g1001 : all }
    : a === 'history' ? { history: hist, profile: { display_name: 'Sascha', wins: 6, losses: 3, matches_played: 9 }, stats } : { error: 'Vorschau' };
  await r.fulfill({ status: a ? 200 : 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
});
await p.addInitScript(() => localStorage.setItem('tu_name', 'Sascha'));
await p.goto(base);
await p.waitForFunction(() => !document.getElementById('btn-start').disabled, null, { timeout: 120000 });
await p.waitForTimeout(800);
const shot = async (n) => { await p.screenshot({ path: `${prefix}_${n}.png`, timeout: 180000 }); console.log('shot', n); };
await shot('home');
await p.click('.game.soon[data-game="skat"]', { force: true }); await p.waitForTimeout(300); await shot('soon_toast');
await p.click('.game[data-game="1001"]'); await p.waitForTimeout(400); await p.click('#pcount button[data-n="3"]'); await shot('setup1001');
await p.click('#btn-back'); await p.click('#btn-profile'); await p.waitForTimeout(600); await shot('profile');
await p.click('#profile .close'); await p.click('#btn-board'); await p.waitForTimeout(600); await shot('rank_all');
await p.click('#lb-tabs button[data-game="1001"]'); await p.waitForTimeout(500); await shot('rank_1001');
console.log('writes', writes.length);
await b.close();
