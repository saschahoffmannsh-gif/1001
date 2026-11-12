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
const params = new URLSearchParams(location.search);
const FAST = params.has('fast');
const TESTRUN = params.has('autostart') || params.has('autoplay');   // automatische Tests speichern nichts
const T = (ms) => (FAST ? Math.min(ms, 30) : ms);

const table = new Table($('stage'));
window.__table = table;
window.__game = () => ({ match, st });
if (params.has('still')) table.instant = true;

let match = null, st = null, board = null, matchStart = 0, players = 2;
let forceNewTrack = false, lastLeader = null, profile = null, saving = false;
const NAMES = () => R.PLAYER_NAMES[players];
const nm = (p) => NAMES()[p];
const SHORT = { 'Du': 'Du', 'Computer': 'Computer', 'Computer 1': 'Comp. 1', 'Computer 2': 'Comp. 2', 'Computer 3': 'Comp. 3' };
// Verb passend zur Person: "Du reizt" / "Computer 1 reizt"
const vb = (p, du, er) => `${nm(p)} ${p === 0 ? du : er}`;

// ------------------------------------------------------------ Laden & Start
table.load((p) => { $('loadbar').firstElementChild.style.width = Math.round(p * 100) + '%'; }).then(() => {
  $('btn-start').disabled = false; $('btn-start').textContent = 'Partie starten';
  $('loadbar').style.opacity = 0;
  if (params.has('hero')) heroScene();
  if (params.has('autostart')) $('btn-start').click();
}).catch((e) => { $('btn-start').textContent = 'Fehler beim Laden'; console.error(e); });

$('name').value = localStorage.getItem('tu_name') || '';
players = Number(params.get('players')) || Number(localStorage.getItem('tu_players')) || 2;
if (![2, 3, 4].includes(players)) players = 2;
function markPlayers() { for (const b of document.querySelectorAll('#pcount button')) b.classList.toggle('on', Number(b.dataset.n) === players); }
for (const b of document.querySelectorAll('#pcount button')) b.onclick = () => { players = Number(b.dataset.n); markPlayers(); };
markPlayers();
$('btn-start').onclick = async () => {
  const name = $('name').value.trim() || 'Spieler';
  localStorage.setItem('tu_name', name); localStorage.setItem('tu_players', String(players));
  show('start', false);
  if (!TESTRUN) api.profile(name).then((r) => { profile = r.profile; }).catch(() => {});
  newMatch();
};
for (const b of document.querySelectorAll('.panel .close')) b.onclick = () => b.closest('.panel').classList.add('hidden');
$('btn-rules').onclick = $('btn-help').onclick = () => show('help');
$('btn-menu').onclick = () => show('menu');
$('m-resume').onclick = () => show('menu', false);
$('m-cam').onclick = () => { table.resetCamera(); show('menu', false); };
$('m-new').onclick = () => { show('menu', false); if (confirm('Aktuelle Partie abbrechen und zum Start zurück?')) { st = null; for (const id of ['result', 'matchend', 'bidding', 'meld', 'discard', 'hud', 'status']) show(id, false); table.clearBoard(); show('start'); } };
$('btn-board').onclick = $('m-board').onclick = $('me-board').onclick = openLeaderboard;
$('btn-newtrack').onclick = () => { forceNewTrack = !forceNewTrack; $('btn-newtrack').classList.toggle('on', forceNewTrack); };

function setStatus(txt, think = false) {
  show('status', !!txt); $('status-txt').innerHTML = txt || ''; $('status').classList.toggle('think', think);
}
function toast(t, ms = 2200) { $('toast').textContent = t; show('toast'); clearTimeout(toast._t); toast._t = setTimeout(() => show('toast', false), ms); }
async function banner(html, ms = 1500) { $('banner').innerHTML = html; show('banner'); await sleep(T(ms)); show('banner', false); }

// ------------------------------------------------------------ HUD (Holzleiste)
function buildHud() {
  $('hud').dataset.n = players;
  $('hud-players').innerHTML = NAMES().map((n, p) => `
    <div class="pl" id="pl-${p}"><i class="peg p${p}"></i>
      <span class="nm"><span class="full">${n}</span><span class="short">${SHORT[n]}</span></span>
      <b class="tot" id="sc-${p}">0</b><span class="rd" id="rd-${p}"><span class="rl">Runde </span>0</span></div>`).join('');
}
function trumpChip(s) { return s ? `<span class="mini-tile s-${s}">${R.SUIT_SYMBOL[s]}</span><span class="tname">${R.SUIT_NAME[s]}</span>` : '<span class="none">keiner</span>'; }
function updateHud() {
  show('hud');
  for (let p = 0; p < players; p++) $('sc-' + p).textContent = match.totals[p];
  if (!st) return;
  const c = st.contract;
  $('i-bid').innerHTML = c ? `${c.value}<small>${SHORT[nm(c.by)]}</small>` : (st.auction.high ? `${st.auction.high.value}<small>…</small>` : '–');
  $('i-trump').innerHTML = trumpChip(st.trump);
  const tot = R.tricksPerDeal(st);
  $('i-trick').textContent = `${Math.min(tot, st.trickNo + (st.trick.length ? 1 : 0))}/${tot}`;
  $('i-stock').textContent = players === 3 ? (st.phase === 'bidding' ? st.stock.length : '–') : (players === 4 ? '–' : st.stock.length);
  $('stat-stock').querySelector('.k').textContent = players === 3 ? 'Talon' : 'Stock';
  for (let p = 0; p < players; p++) {
    const pts = R.cardPoints(st.taken[p]) + st.melds[p].reduce((s, x) => s + R.MARRIAGE[x], 0);
    $('rd-' + p).innerHTML = `<span class="rl">Runde </span>${pts}`;
    const el = $('pl-' + p);
    el.classList.toggle('turn', st.phase !== 'done' && st.turn === p && !st.result);
    el.classList.toggle('bidder', !!c && c.by === p);
  }
}
function measureHud() {
  const r = $('hud').getBoundingClientRect();
  table.hudPx = Math.round(r.bottom + 8); table.resetCamera();
}
table.onHandLayout = (topFrac) => {
  document.documentElement.style.setProperty('--hand-h', Math.round(innerHeight * (1 - topFrac)) + 'px');
};
window.addEventListener('resize', () => { if (match) { updateHud(); measureHud(); } });

// ------------------------------------------------------------ Partie / Runde
function newMatch() {
  match = R.newMatch(players); matchStart = Date.now(); saving = false;
  for (const id of ['result', 'matchend', 'bidding', 'meld', 'discard']) show(id, false);
  table.setPlayers(players);
  buildHud(); show('hud'); measureHud();
  for (let p = 0; p < players; p++) table.movePeg(p, 0);
  startDeal();
}

async function startDeal() {
  table.clearBoard();
  board = newBoard(); lastLeader = null; forceNewTrack = false;
  const fh = match.nextForehand;
  st = R.newDealState({ forehand: fh, players });       // komplett neu gemischt (crypto)
  updateHud();
  setStatus(`Runde ${match.deals.length + 1} – es wird gemischt und gegeben`);
  await dealAnimation();
  await bidding();
  if (st.phase === 'discard') await discardPhase();
  await playLoop();
}

async function dealAnimation() {
  const deck = st.deck;
  // alle Steine verdeckt als Stapel bereitlegen
  deck.forEach((c, i) => { const m = table.makeTile(c, false); table.scene.add(m); m.position.copy(table.stockSlot(deck.length - 1 - i)); });
  await sleep(T(250));
  // Computer-Hände verdeckt an ihre Plätze
  for (let p = 1; p < players; p++) layoutCpuHand(p, 0.55, 1.0);
  await sleep(T(150));
  // eigene Hand: umdrehen und in die Hand
  for (const c of st.hands[0]) table.setFace(table.tiles.get(c), true);
  table.setHand(R.sortHand(st.hands[0], st.trump), !FAST);
  // Stock / Talon neu stapeln
  st.stock.forEach((c, k) => { const m = table.tiles.get(c); table.tween(m, { pos: table.stockSlot(k), quat: m.quaternion.clone(), scale: 1, dur: T(0.3) }); });
  await sleep(T(600));
}

function layoutCpuHand(p, dur = 0.35, arc = 0.3) {
  const n = st.hands[p].length;
  st.hands[p].forEach((c, k) => { const m = table.tiles.get(c); table.flyToWorld(m, table.computerSlot(k, n, p), { faceUp: false, dur: T(dur), arc }); });
}

// ------------------------------------------------------------ Reizrunde (nacheinander, immer +10)
async function bidding() {
  show('bidding'); renderAuction();
  while (st.phase === 'bidding') {
    const p = st.turn;
    renderAuction();
    if (p !== 0) {
      setBidButtons(null, `${nm(p)} überlegt …`);
      setStatus(`${nm(p)} denkt …`, true);
      await sleep(T(800 + Math.random() * 500));
      const a = AI.chooseBid(st, p);
      st = R.applyBid(st, p, a);
    } else {
      const need = R.minBid(st.auction);
      setStatus(st.auction.high ? `${nm(st.auction.high.p)} hält ${st.auction.high.value} – ${need} reizen oder passen?` : 'Du bist dran: 40 reizen oder passen?');
      const a = await humanBid(need);
      st = R.applyBid(st, 0, a);
    }
    renderAuction(); updateHud();
  }
  const c = st.contract;
  setBidButtons(null, ''); setStatus('');
  await sleep(T(500));
  show('bidding', false);
  const forcedTxt = players === 2 ? 'Beide haben gepasst – Vorhand muss 40 spielen' : 'Alle haben gepasst – Vorhand muss 40 spielen';
  await banner(`${vb(c.by, 'spielst', 'spielt')} ${c.value}<small>${c.forced ? forcedTxt : (players === 3 ? 'Reizgewinner nimmt den Talon und drückt 2' : 'Reizgewinner spielt aus')}</small>`, 1600);
  table.setHand(R.sortHand(st.hands[0], st.trump));
}
function renderAuction() {
  const a = st.auction;
  // Sitzreihe: wer ist dran, wer hat gepasst, letztes Gebot je Spieler
  const last = (p) => { for (let i = a.log.length - 1; i >= 0; i--) if (a.log[i].p === p) return a.log[i]; return null; };
  $('bid-seats').dataset.n = players;
  $('bid-seats').innerHTML = NAMES().map((n, p) => {
    const l = last(p);
    const state = a.passed[p] ? 'passed' : (a.high && a.high.p === p ? 'high' : '');
    const val = l ? (l.pass ? 'passt' : l.bid) : '–';
    const vh = p === a.forehand ? `<em class="vh" title="Vorhand">${players > 2 ? 'VH' : 'Vorhand'}</em>` : '';
    return `<div class="seat ${state} ${!a.done && a.turn === p ? 'turn' : ''}"><i class="peg p${p}"></i><span class="sn">${SHORT[n]}</span>${vh}<span class="sv">${val}</span></div>`;
  }).join('');
  $('bid-high').innerHTML = a.high ? `<span class="k">Höchstes Gebot</span><b>${a.high.value}</b><span class="who">${nm(a.high.p)}</span>` : `<span class="k">Noch kein Gebot</span><b>–</b><span class="who">Eröffnung mit 40</span>`;
  $('bid-log').innerHTML = a.log.map((e) => `<span class="chip-tile p${e.p} ${e.pass ? 'pass' : ''}" title="${nm(e.p)}">${e.pass ? 'P' : e.bid}</span>`).join('');
}
function setBidButtons(need, waitTxt) {
  const up = $('bid-up'), pass = $('bid-pass');
  if (need === null) { up.disabled = pass.disabled = true; up.innerHTML = waitTxt ? `<span class="wait">${waitTxt}</span>` : '…'; up.classList.add('waiting'); return; }
  up.disabled = pass.disabled = false; up.classList.remove('waiting');
  up.innerHTML = `Reizen: <b>${need}</b>`;
}
function humanBid(need) {
  return new Promise((resolve) => {
    if (need > R.BID_MAX) { resolve('pass'); return; }
    setBidButtons(need);
    const done = (v) => { $('bid-up').onclick = $('bid-pass').onclick = null; setBidButtons(null, ''); resolve(v); };
    $('bid-up').onclick = () => done(need);
    $('bid-pass').onclick = () => done('pass');
  });
}

// ------------------------------------------------------------ 3 Spieler: Talon aufnehmen und 2 Steine drücken
async function discardPhase() {
  const p = st.contract.by;
  const talon = st.skat.slice();
  if (p === 0) {
    for (const c of talon) table.setFace(table.tiles.get(c), true);
    table.setHand(R.sortHand(st.hands[0], st.trump));
    setStatus('Talon aufgenommen – wähle 2 Steine zum Drücken');
    const cards = await humanDiscard();
    st = R.applyDiscard(st, 0, cards);
    table.hand = table.hand.filter((c) => !cards.includes(c));
    table.layoutHand(true);
    for (const c of cards) { const m = table.tiles.get(c); table.setFace(m, false); }
    await putDiscard(cards);
  } else {
    setStatus(`${nm(p)} nimmt den Talon auf …`, true);
    layoutCpuHand(p, 0.5, 0.8);
    await sleep(T(900));
    const cards = AI.chooseDiscard(st, p, talon.length);
    st = R.applyDiscard(st, p, cards);
    await putDiscard(cards);
    layoutCpuHand(p);
    setStatus(`${nm(p)} hat 2 Steine gedrückt`);
    await sleep(T(700));
  }
  updateHud();
}
async function putDiscard(cards) {
  // verdeckt neben den Bieter-Stapel legen (zählen für ihn)
  await Promise.all(cards.map((c, k) => table.flyToWorld(table.tiles.get(c), table.stockSlot(k), { faceUp: false, dur: T(0.5), arc: 0.8 })));
}
function humanDiscard() {
  return new Promise((resolve) => {
    const sel = new Set();
    show('discard'); $('disc-ok').disabled = true; $('disc-count').textContent = '0 von 2 gewählt';
    table.setPlayable(st.hands[0], st.hands[0]);
    table.onPick = (card) => {
      if (sel.has(card)) sel.delete(card); else if (sel.size < 2) sel.add(card); else return;
      for (const c of st.hands[0]) { const u = table.tiles.get(c).userData; u.sel = sel.has(c); u.lift = u.sel ? 0.34 : 0; }
      table.layoutHand(true);
      const pts = [...sel].reduce((s, c) => s + R.valueOf(c), 0);
      $('disc-count').textContent = `${sel.size} von 2 gewählt${sel.size ? ` · ${pts} Augen` : ''}`;
      $('disc-ok').disabled = sel.size !== 2;
    };
    $('disc-ok').onclick = () => {
      if (sel.size !== 2) return;
      table.onPick = null; table.clearPlayable(st.hands[0]); show('discard', false);
      for (const c of st.hands[0]) { const u = table.tiles.get(c).userData; u.sel = false; u.lift = 0; }
      resolve([...sel]);
    };
  });
}

// ------------------------------------------------------------ Spiel
async function playLoop() {
  while (st.phase === 'play') {
    updateHud();
    const p = st.turn;
    let move;
    if (p !== 0) {
      setStatus(st.trick.length ? `${nm(p)} denkt …` : `${nm(p)} spielt aus …`, true);
      show('actions', false);
      await sleep(T(550 + Math.random() * 450));
      move = AI.chooseMove(st, p);
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
    function finish(m) { table.onPick = null; table.clearPlayable(st.hands[0]); table.hover = null; show('actions', false); setStatus(''); resolve(m); }
  });
}
function askMeld(card) {
  return new Promise((resolve) => {
    const s = R.suitOf(card);
    $('meld-title').innerHTML = `${sym(s)} ${R.SUIT_NAME[s]}-Hochzeit melden?`;
    $('meld-text').innerHTML = `Du hast König und Dame in ${R.SUIT_NAME[s]}. Meldung: <b>${R.MARRIAGE[s]} Punkte</b>, ${R.SUIT_NAME[s]} wird Trumpf.` +
      (st.tricks[0] === 0 ? '<br><span class="muted">Zählt nur, wenn du in dieser Runde mindestens einen Stich machst.</span>' : '');
    show('meld');
    const done = (v) => { show('meld', false); resolve(v); };
    $('meld-yes').onclick = () => done('yes'); $('meld-no').onclick = () => done('no'); $('meld-cancel').onclick = () => done('cancel');
  });
}

const PULSE = ['#ff8a6b', '#9ab8c0', '#7fc4cc', '#ffb36b'];
async function doMove(p, move) {
  const leading = st.trick.length === 0;
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
    setStatus(`${vb(p, 'meldest', 'meldet')} ${R.SUIT_NAME[meld.suit]}-Hochzeit`);
    banner(`${sym(meld.suit)} ${R.SUIT_NAME[meld.suit]} ${meld.points}<small>Hochzeit von ${p === 0 ? 'dir' : nm(p)} · ${R.SUIT_NAME[meld.suit]} ist Trumpf</small>`, 1900);
  }
  await table.placeOnBoard(move.card, placed.cell, { faceUp: true });
  if (p !== 0) layoutCpuHand(p);
  if (meld) { table.pulse(move.card); table.setHand(R.sortHand(st.hands[0], st.trump)); await sleep(T(900)); }
  updateHud();
  const trick = r.events.find((e) => e.type === 'trick');
  if (trick) {
    const w = trick.winner;
    const win = st.lastTrick.cards.find((t) => t.p === w);
    table.pulse(win.card, PULSE[w]);
    setStatus(`${vb(w, 'gewinnst', 'gewinnt')} den Stich (+${trick.points})`);
    await sleep(T(900));
    const draws = r.events.filter((e) => e.type === 'draw');
    for (const d of draws) {
      const m = table.tiles.get(d.card);
      if (d.p === 0) { table.setFace(m, true); table.hand.push(d.card); table.setHand(R.sortHand(st.hands[0], st.trump)); }
      else { const n = st.hands[d.p].length; await table.flyToWorld(m, table.computerSlot(n - 1, n, d.p), { faceUp: false, dur: T(0.45), arc: 0.6 }); }
      await sleep(T(180));
    }
    if (draws.length) { for (let q = 1; q < players; q++) layoutCpuHand(q); if (st.stock.length === 0) toast('Stock ist leer – jetzt gilt Farbzwang, Stichzwang und Trumpfzwang', 3200); }
  }
}

async function endOfDeal() {
  setStatus('');
  const res = st.result;
  const fh = st.forehand;
  match = R.applyDealResult(match, res, fh);
  updateHud();
  const ps = [...Array(players).keys()];
  const cell = (v) => `<td class="${typeof v === 'number' && v < 0 ? 'neg' : ''}">${v}</td>`;
  const row = (label, vals, cls = '') => `<tr class="${cls}"><td>${label}</td>${vals.map(cell).join('')}</tr>`;
  const b = res.bidder;
  $('res-title').textContent = res.made ? `${vb(b, 'hast', 'hat')} das Gebot geschafft` : `${vb(b, 'bist', 'ist')} reingefallen`;
  $('res-table').dataset.n = players;
  $('res-table').innerHTML = `<tr><th></th>${ps.map((p) => `<th>${SHORT[nm(p)]}</th>`).join('')}</tr>` +
    row('Augen', res.cardPoints) +
    row('Meldungen', res.meldPoints) +
    row('Stiche', res.tricks) +
    row(`Reiz ${res.bid}`, ps.map((p) => (p === b ? (res.made ? '✓' : '✗') : ''))) +
    row('Runde', res.delta, 'sum') +
    row('Gesamt', match.totals, 'sum');
  const notes = [];
  for (const p of ps) if (res.lostMelds[p]) notes.push(`${nm(p)} ohne Stich – Meldung (${res.lostMelds[p]}) zählt nicht.`);
  if (players === 3 && st.discard.length) notes.push(`Gedrückt: ${st.discard.map(R.cardName).join(', ')} (zählt für ${p0(b)}).`);
  if (!res.made) notes.push(`Gebot ${res.bid} nicht erreicht (${res.points[b]}) – ${res.bid} Punkte Abzug.`);
  $('res-note').textContent = notes.join(' ');
  await Promise.all(ps.map((p) => table.movePeg(p, match.totals[p])));
  if (match.winner !== null) return matchEnd();
  show('result');
  $('res-next').onclick = () => { show('result', false); startDeal(); };
  if (params.has('autoplay') && !params.has('hold')) setTimeout(() => $('res-next').click(), 300);
}
const p0 = (p) => (p === 0 ? 'dich' : nm(p));

async function matchEnd() {
  const w = match.winner;
  $('me-title').textContent = w === 0 ? 'Gewonnen! 🎉' : `${nm(w)} gewinnt`;
  $('me-text').innerHTML = `Endstand <b>${match.totals.join(' : ')}</b> nach ${match.deals.length} Runden.`;
  $('me-save').textContent = 'Ergebnis wird gespeichert …';
  show('matchend');
  $('me-new').onclick = () => { show('matchend', false); newMatch(); };
  if (saving) return; saving = true;
  if (TESTRUN) { $('me-save').textContent = 'Testlauf – nicht gespeichert'; return; }
  try {
    if (!profile) profile = (await api.profile(localStorage.getItem('tu_name') || 'Spieler')).profile;
    const r = await api.result({
      players, totals: match.totals,
      human_total: match.totals[0], computer_total: Math.max(...match.totals.slice(1)), winner: w === 0 ? 'human' : 'computer',
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
    if (st.phase === 'bidding' && st.turn === 0 && !$('bid-up').disabled) {
      const a = AI.chooseBid(st, 0); (a === 'pass' ? $('bid-pass') : $('bid-up')).click();
    } else if (st.phase === 'discard' && st.contract.by === 0 && table.onPick && !$('discard').classList.contains('hidden')) {
      for (const c of AI.chooseDiscard(st, 0, 2)) table.onPick(c);
      $('disc-ok').click();
    } else if (st.phase === 'play' && st.turn === 0 && table.onPick) {
      if (!$('meld').classList.contains('hidden')) { $('meld-yes').click(); return; }
      const m = AI.chooseMove(st, 0); table.onPick(m.card);
    }
  }, FAST ? 60 : 400);
  void origPick;
}
