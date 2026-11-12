import './style.css';
import * as R from './game/rules.js';
import * as AI from './game/ai.js';
import { newBoard, openTrack, addTile } from './game/tracks.js';
import { Table } from './render/scene.js';
import { api } from './net.js';

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sym = (s) => `<span class="suit-${s}">${R.SUIT_SYMBOL[s]}</span>`;
const suitLabel = (s) => `${sym(s)} ${R.SUIT_NAME[s]}`;
const params = new URLSearchParams(location.search);
const FAST = params.has('fast');
const TESTRUN = params.has('autostart') || params.has('autoplay');   // automatische Tests speichern nichts
const T = (ms) => (FAST ? Math.min(ms, 30) : ms);

const table = new Table($('stage'));
window.__table = table;
window.__game = () => ({ match, st });
if (params.has('still')) table.instant = true;

let match = null, st = null, board = null, matchStart = 0;
let forceNewTrack = false, lastLeader = null, profile = null, saving = false;

// ------------------------------------------------------------ Laden & Start
table.load((p) => { $('loadbar').firstElementChild.style.width = Math.round(p * 100) + '%'; }).then(() => {
  $('btn-start').disabled = false; $('btn-start').textContent = 'Partie starten';
  $('loadbar').style.opacity = 0;
  if (params.has('hero')) heroScene();
  if (params.has('autostart')) $('btn-start').click();
}).catch((e) => { $('btn-start').textContent = 'Fehler beim Laden'; console.error(e); });

$('name').value = localStorage.getItem('tu_name') || '';
$('btn-start').onclick = async () => {
  const name = $('name').value.trim() || 'Spieler';
  localStorage.setItem('tu_name', name);
  show('start', false);
  if (!TESTRUN) api.profile(name).then((r) => { profile = r.profile; }).catch(() => {});
  newMatch();
};
for (const b of document.querySelectorAll('.panel .close')) b.onclick = () => b.closest('.panel').classList.add('hidden');
$('btn-rules').onclick = $('btn-help').onclick = () => show('help');
$('btn-menu').onclick = () => show('menu');
$('m-resume').onclick = () => show('menu', false);
$('m-cam').onclick = () => { table.resetCamera(); show('menu', false); };
$('m-new').onclick = () => { show('menu', false); if (confirm('Aktuelle Partie abbrechen und neu beginnen?')) newMatch(); };
$('btn-board').onclick = $('m-board').onclick = $('me-board').onclick = openLeaderboard;
$('btn-newtrack').onclick = () => { forceNewTrack = !forceNewTrack; $('btn-newtrack').classList.toggle('on', forceNewTrack); };

function setStatus(txt, think = false) {
  show('status', !!txt); $('status-txt').innerHTML = txt || ''; $('status').classList.toggle('think', think);
}
function toast(t, ms = 2200) { $('toast').textContent = t; show('toast'); clearTimeout(toast._t); toast._t = setTimeout(() => show('toast', false), ms); }
async function banner(html, ms = 1500) { $('banner').innerHTML = html; show('banner'); await sleep(T(ms)); show('banner', false); }

function updateHud() {
  show('hud');
  $('sc-0').textContent = match.totals[0]; $('sc-1').textContent = match.totals[1];
  if (!st) return;
  $('i-bid').innerHTML = st.contract ? `${st.contract.value} <small>(${st.contract.by === 0 ? 'Du' : 'CPU'})</small>` : (st.auction.high ? `${st.auction.high.value}…` : '–');
  $('i-trump').innerHTML = st.trump ? suitLabel(st.trump) : 'keiner';
  $('i-trick').textContent = `${Math.min(12, st.trickNo + (st.trick.length ? 1 : 0))}/12`;
  $('i-stock').textContent = st.stock.length;
  const pts = [0, 1].map((p) => R.cardPoints(st.taken[p]) + st.melds[p].reduce((s, x) => s + R.MARRIAGE[x], 0));
  $('i-round').textContent = `Du ${pts[0]} · CPU ${pts[1]}`;
}
table.onHandLayout = (topFrac) => {
  document.documentElement.style.setProperty('--hand-h', Math.round(innerHeight * (1 - topFrac)) + 'px');
};
window.addEventListener('resize', () => updateHud && match && updateHud());

// ------------------------------------------------------------ Partie / Runde
function newMatch() {
  match = R.newMatch(); matchStart = Date.now(); saving = false;
  for (const id of ['result', 'matchend', 'bidding', 'meld']) show(id, false);
  table.movePeg(0, 0); table.movePeg(1, 0);
  startDeal();
}

async function startDeal() {
  table.clearBoard();
  board = newBoard(); lastLeader = null; forceNewTrack = false;
  const fh = match.nextForehand;
  st = R.newDealState({ forehand: fh });       // komplett neu gemischt (crypto)
  updateHud();
  setStatus(`Runde ${match.deals.length + 1} – es wird gemischt und gegeben`);
  await dealAnimation();
  await bidding();
  await playLoop();
}

async function dealAnimation() {
  const deck = st.deck;
  // alle Steine verdeckt als Stapel bereitlegen
  const meshes = deck.map((c, i) => {
    const m = table.makeTile(c, false); table.scene.add(m);
    m.position.copy(table.stockSlot(Math.min(i, 23) * 0 + (23 - i)));
    return m;
  });
  await sleep(T(250));
  const order = [];
  const fh = st.forehand, dl = R.other(fh);
  let i = 0; for (const n of [3, 2, 3]) { for (let k = 0; k < n; k++) order.push([fh, deck[i++]]); for (let k = 0; k < n; k++) order.push([dl, deck[i++]]); }
  const humanCards = [], cpuCards = [];
  for (const [p, c] of order) {
    if (p === 0) { humanCards.push(c); }
    else { cpuCards.push(c); }
  }
  // Computer-Hand verdeckt ablegen
  cpuCards.forEach((c, k) => {
    const m = table.tiles.get(c);
    table.flyToWorld(m, table.computerSlot(k, 8), { faceUp: false, dur: T(0.55), arc: 1.0 });
  });
  await sleep(T(150));
  // eigene Hand: umdrehen und in die Hand
  for (const c of humanCards) table.setFace(table.tiles.get(c), true);
  table.setHand(R.sortHand(st.hands[0], st.trump), !FAST);
  // Stock neu stapeln
  st.stock.forEach((c, k) => { const m = table.tiles.get(c); table.tween(m, { pos: table.stockSlot(k), quat: m.quaternion.clone(), scale: 1, dur: T(0.3) }); });
  await sleep(T(600));
}

function layoutCpuHand() {
  const n = st.hands[1].length;
  st.hands[1].forEach((c, k) => { const m = table.tiles.get(c); table.flyToWorld(m, table.computerSlot(k, n), { faceUp: false, dur: T(0.35), arc: 0.3 }); });
}

// ------------------------------------------------------------ Reizrunde
async function bidding() {
  show('bidding'); renderBidLog();
  while (st.phase === 'bidding') {
    const p = st.turn;
    if (p === 1) {
      $('bid-btns').innerHTML = '<div class="think">Computer überlegt …</div>';
      setStatus('Computer denkt …', true);
      await sleep(T(700 + Math.random() * 500));
      const a = AI.chooseBid(st, 1);
      st = R.applyBid(st, 1, a);
    } else {
      setStatus(st.auction.high ? `Computer reizt ${st.auction.high.value} – halten oder passen?` : (st.auction.passed[1] ? 'Computer passt – willst du 40 reizen?' : 'Du reizt zuerst'));
      const a = await humanBid();
      st = R.applyBid(st, 0, a);
    }
    renderBidLog(); updateHud();
  }
  const c = st.contract;
  $('bid-btns').innerHTML = '';
  await sleep(T(300));
  show('bidding', false);
  await banner(`${c.by === 0 ? 'Du spielst' : 'Computer spielt'} ${c.value}<small>${c.forced ? 'Beide haben gepasst – Vorhand muss 40 spielen' : 'Reizgewinner spielt aus'}</small>`, 1600);
  table.setHand(R.sortHand(st.hands[0], st.trump));
}
function renderBidLog() {
  $('bid-log').innerHTML = st.auction.log.map((e) => `<span class="${e.p ? 'cpu' : ''}">${e.p ? 'Computer' : 'Du'}: ${e.pass ? 'passe' : e.bid}</span>`).join('')
    || `<span>${st.forehand === 0 ? 'Du bist Vorhand' : 'Computer ist Vorhand'}</span>`;
}
function humanBid() {
  return new Promise((resolve) => {
    const opts = R.auctionOptions(st.auction).slice(0, 6);
    const box = $('bid-btns'); box.innerHTML = '';
    for (const v of opts) {
      const b = document.createElement('button'); b.className = v === opts[0] ? 'primary' : ''; b.textContent = v;
      b.onclick = () => resolve(v); box.appendChild(b);
    }
    const p = document.createElement('button'); p.className = 'pass'; p.textContent = 'Passen'; p.onclick = () => resolve('pass'); box.appendChild(p);
  });
}

// ------------------------------------------------------------ Spiel
async function playLoop() {
  while (st.phase === 'play') {
    updateHud();
    const p = st.turn;
    let move;
    if (p === 1) {
      setStatus(st.trick.length ? 'Computer denkt …' : 'Computer spielt aus …', true);
      show('actions', false);
      await sleep(T(550 + Math.random() * 450));
      move = AI.chooseMove(st, 1);
    } else {
      move = await humanMove();
    }
    await doMove(p, move);
  }
  await endOfDeal();
}

function humanMove() {
  return new Promise((resolve) => {
    const legal = R.legalFor(st, 0);
    const leading = st.trick.length === 0;
    const forced = st.stock.length === 0 && !leading;
    setStatus(leading ? 'Du spielst aus – tippe einen Stein' : (forced ? 'Bedienen / überstechen – tippe einen hellen Stein' : 'Du bist dran – lege einen Stein'));
    show('actions', leading);
    $('btn-newtrack').classList.toggle('on', forceNewTrack);
    table.setPlayable(st.hands[0], legal);
    table.onPick = async (card) => {
      if (!legal.includes(card)) return;
      if (leading && R.canDeclare(st, 0, card)) {
        const choice = await askMeld(card);
        if (choice === 'cancel') return;
        finish({ card, declare: choice === 'yes' });
      } else finish({ card, declare: false });
    };
    function finish(m) { table.onPick = null; table.clearPlayable(st.hands[0]); table.hover = null; show('actions', false); resolve(m); }
  });
}
function askMeld(card) {
  return new Promise((resolve) => {
    const s = R.suitOf(card);
    $('meld-title').innerHTML = `${suitLabel(s)}-Hochzeit melden?`;
    $('meld-text').innerHTML = `Du hast König und Dame in ${R.SUIT_NAME[s]}. Meldung: <b>${R.MARRIAGE[s]} Punkte</b>, ${R.SUIT_NAME[s]} wird Trumpf.` +
      (st.tricks[0] === 0 ? '<br><span class="muted">Zählt nur, wenn du in dieser Runde mindestens einen Stich machst.</span>' : '');
    show('meld');
    const done = (v) => { show('meld', false); resolve(v); };
    $('meld-yes').onclick = () => done('yes'); $('meld-no').onclick = () => done('no'); $('meld-cancel').onclick = () => done('cancel');
  });
}

async function doMove(p, move) {
  const leading = st.trick.length === 0;
  const prev = st;
  const r = R.playCard(st, p, move.card, { declare: move.declare });
  st = r.state;
  // Spur wählen: neue Spur, wenn der Ausspieler wechselt, bei Meldung oder auf Wunsch
  if (leading) {
    const wantNew = board.tracks.length === 0 || lastLeader !== p || move.declare || (p === 0 && forceNewTrack);
    if (wantNew) board = openTrack(board, p);
    lastLeader = p; forceNewTrack = false;
  }
  const placed = addTile(board, move.card); board = placed.board;
  if (p === 0) { table.hand = table.hand.filter((c) => c !== move.card); table.layoutHand(true); }
  const meld = r.events.find((e) => e.type === 'meld');
  if (meld) {
    setStatus(`${p === 0 ? 'Du meldest' : 'Computer meldet'} ${R.SUIT_NAME[meld.suit]}-Hochzeit`);
    banner(`${sym(meld.suit)} ${R.SUIT_NAME[meld.suit]} ${meld.points}<small>${p === 0 ? 'Deine' : 'Computer-'}Hochzeit · ${R.SUIT_NAME[meld.suit]} ist Trumpf</small>`, 1900);
  }
  await table.placeOnBoard(move.card, placed.cell, { faceUp: true });
  if (p === 1) layoutCpuHand();
  if (meld) { table.pulse(move.card); table.setHand(R.sortHand(st.hands[0], st.trump)); await sleep(T(900)); }
  updateHud();
  const trick = r.events.find((e) => e.type === 'trick');
  if (trick) {
    const w = trick.winner;
    const last = st.lastTrick;
    table.pulse(w === last.lead.p ? last.lead.card : last.follow.card, w === 0 ? '#ff8a6b' : '#9ab8c0');
    setStatus(`${w === 0 ? 'Du gewinnst' : 'Computer gewinnt'} den Stich (+${trick.points})`);
    await sleep(T(900));
    const draws = r.events.filter((e) => e.type === 'draw');
    for (const d of draws) {
      const m = table.tiles.get(d.card);
      if (d.p === 0) { table.setFace(m, true); table.hand.push(d.card); table.setHand(R.sortHand(st.hands[0], st.trump)); }
      else { await table.flyToWorld(m, table.computerSlot(st.hands[1].length - 1, st.hands[1].length), { faceUp: false, dur: T(0.45), arc: 0.6 }); }
      await sleep(T(180));
    }
    if (draws.length) { layoutCpuHand(); if (st.stock.length === 0) toast('Stock ist leer – jetzt gilt Farbzwang, Stichzwang und Trumpfzwang', 3200); }
  }
}

async function endOfDeal() {
  setStatus('');
  updateHud();
  const res = st.result;
  const fh = st.forehand;
  match = R.applyDealResult(match, res, fh);
  updateHud();
  const name = ['Du', 'Computer'];
  const row = (label, a, b, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="${a < 0 ? 'neg' : ''}">${a}</td><td class="${b < 0 ? 'neg' : ''}">${b}</td></tr>`;
  $('res-title').textContent = res.made ? `${name[res.bidder]} ${res.bidder === 0 ? 'hast' : 'hat'} das Gebot geschafft` : `${name[res.bidder]} ${res.bidder === 0 ? 'bist' : 'ist'} reingefallen`;
  $('res-table').innerHTML = `<tr><th></th><th>Du</th><th>Computer</th></tr>` +
    row('Augen', res.cardPoints[0], res.cardPoints[1]) +
    row('Meldungen', res.meldPoints[0], res.meldPoints[1]) +
    row('Stiche', res.tricks[0], res.tricks[1]) +
    row(`Reiz ${res.bid} (${res.bidder === 0 ? 'Du' : 'CPU'})`, res.bidder === 0 ? (res.made ? '✓' : '✗') : '', res.bidder === 1 ? (res.made ? '✓' : '✗') : '') +
    row('Runde', res.delta[0], res.delta[1], 'sum') +
    row('Gesamt', match.totals[0], match.totals[1], 'sum');
  const notes = [];
  for (const p of [0, 1]) if (res.lostMelds[p]) notes.push(`${name[p]} ohne Stich – Meldung (${res.lostMelds[p]}) zählt nicht.`);
  if (!res.made) notes.push(`Gebot ${res.bid} nicht erreicht (${res.points[res.bidder]}) – ${res.bid} Punkte Abzug.`);
  $('res-note').textContent = notes.join(' ');
  await Promise.all([table.movePeg(0, match.totals[0]), table.movePeg(1, match.totals[1])]);
  if (match.winner !== null) return matchEnd();
  show('result');
  $('res-next').onclick = () => { show('result', false); startDeal(); };
  if (params.has('autoplay')) setTimeout(() => $('res-next').click(), 300);
}

async function matchEnd() {
  const w = match.winner;
  $('me-title').textContent = w === 0 ? 'Gewonnen! 🎉' : 'Der Computer gewinnt';
  $('me-text').innerHTML = `Endstand <b>${match.totals[0]} : ${match.totals[1]}</b> nach ${match.deals.length} Runden.`;
  $('me-save').textContent = 'Ergebnis wird gespeichert …';
  show('matchend');
  $('me-new').onclick = () => { show('matchend', false); newMatch(); };
  if (saving) return; saving = true;
  if (TESTRUN) { $('me-save').textContent = 'Testlauf – nicht gespeichert'; return; }
  try {
    if (!profile) profile = (await api.profile(localStorage.getItem('tu_name') || 'Spieler')).profile;
    const r = await api.result({
      human_total: match.totals[0], computer_total: match.totals[1], winner: w === 0 ? 'human' : 'computer',
      duration_s: Math.min(86400, Math.round((Date.now() - matchStart) / 1000)),
      deals: match.deals.map((d) => ({ bidder: d.bidder, bid: d.bid, made: d.made, delta: d.delta, melds: d.meldPoints })),
    });
    profile = r.profile;
    $('me-save').textContent = `Gespeichert · Bilanz ${profile.wins} Siege / ${profile.losses} Niederlagen`;
  } catch (e) { $('me-save').textContent = 'Nicht gespeichert: ' + e.message; }
}

async function openLeaderboard() {
  show('menu', false); show('leader'); $('lb-body').textContent = 'Lade …'; $('hist-body').textContent = '';
  try {
    const { leaderboard } = await api.leaderboard();
    $('lb-body').innerHTML = leaderboard.length ? `<table class="lb">${leaderboard.map((r, i) => `<tr><td>${i + 1}.</td><td>${esc(r.display_name)}</td><td class="n">${r.wins} S</td><td class="n">${r.losses} N</td><td class="n">best ${r.best_total}</td></tr>`).join('')}</table>` : '<p class="muted">Noch keine Partien gespeichert.</p>';
  } catch (e) { $('lb-body').textContent = e.message; }
  try {
    const { history } = await api.history();
    $('hist-body').innerHTML = history.length ? `<table class="lb">${history.map((h) => `<tr><td>${new Date(h.created_at).toLocaleDateString('de-DE')}</td><td>${h.winner === 'human' ? 'Sieg' : 'Niederlage'}</td><td class="n">${h.human_total}:${h.computer_total}</td><td class="n">${h.deals} R.</td></tr>`).join('')}</table>` : '<p class="muted">Noch keine eigenen Partien.</p>';
  } catch { $('hist-body').innerHTML = '<p class="muted">Noch keine eigenen Partien.</p>'; }
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------ Vergleichsszene wie auf dem Referenzbild
function heroScene() {
  show('start', false); table.heroCamera();
  const put = (c, col, row, rot) => { const m = table.makeTile(c, true); table.scene.add(m); table.placeOnBoard(c, [col, row], { rotY: rot }); };
  put('HA', 1, 5, 0.01); put('H9', 2, 5, -0.005); put('HK', 3, 5, 0.017);
  put('DQ', 7, 2, -0.026); put('CJ', 8, 2, 0.035); put('S10', 7, 1, 0.009);
}

// Test-Hilfe: automatischer Spieler (?autoplay) – spielt als Mensch mit der KI
if (params.has('autoplay')) {
  const origPick = () => {};
  setInterval(() => {
    if (!st) return;
    if (st.phase === 'bidding' && st.turn === 0 && !$('bidding').classList.contains('hidden')) {
      const b = $('bid-btns').querySelector('button'); if (b) b.click();
    } else if (st.phase === 'play' && st.turn === 0 && table.onPick) {
      if (!$('meld').classList.contains('hidden')) { $('meld-yes').click(); return; }
      const m = AI.chooseMove(st, 0); table.onPick(m.card);
    }
  }, FAST ? 60 : 400);
  void origPick;
}
