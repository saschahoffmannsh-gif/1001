// Card Master – Skat-Ablauf im Browser (Brett, Steine, Holztafeln). Regeln: supabase/functions/tu/skat.js
import * as S from '../../supabase/functions/tu/skat.js';
import * as AI from '../game/skatai.js';
import { newBoard, openTrack, addTile } from '../game/tracks.js';

const SYM = { D: '♦', H: '♥', S: '♠', C: '♣' };
const NAMES = { 3: ['Du', 'Computer 1', 'Computer 2'], 4: ['Du', 'Computer 1', 'Computer 2', 'Computer 3'] };
const SHORT = { 'Du': 'Du', 'Computer 1': 'Comp. 1', 'Computer 2': 'Comp. 2', 'Computer 3': 'Comp. 3' };
const ROLE = ['Vorhand', 'Mittelhand', 'Hinterhand'];
const ROLE_S = ['VH', 'MH', 'HH'];
const PULSE = ['#ff8a6b', '#9ab8c0', '#7fc4cc', '#ffb36b'];

export function gameName(g, short = false) {
  if (!g) return '–';
  if (g.type === 'ramsch') return 'Ramsch';
  let t = g.type === 'grand' ? 'Grand' : g.type === 'null' ? 'Null' : S.SUIT_NAME[g.suit];
  const adds = [];
  if (g.type === 'null') { if (g.ouvert) adds.push('Ouvert'); if (g.hand) adds.push('Hand'); }
  else { if (g.hand) adds.push('Hand'); if (g.schwarz) adds.push('Schwarz angesagt'); else if (g.schneider) adds.push('Schneider angesagt'); if (g.ouvert) adds.push('Ouvert'); }
  if (short) return t + (adds.length ? ' ' + adds.map((a) => a.split(' ')[0]).join(' ') : '');
  return [t, ...adds].join(' ');
}
const chip = (s) => `<span class="mini-tile s-${s}">${SYM[s]}</span>`;
export function gameChip(g) {
  if (!g) return '<span class="none">–</span>';
  if (g.type === 'suit') return `${chip(g.suit)}<span class="tname">${S.SUIT_NAME[g.suit]}</span>`;
  if (g.type === 'grand') return `<span class="mini-tile s-J">B</span><span class="tname">Grand</span>`;
  if (g.type === 'null') return `<span class="mini-tile s-N">0</span><span class="tname">Null${g.ouvert ? ' ouv.' : ''}</span>`;
  return `<span class="mini-tile s-N">R</span><span class="tname">Ramsch</span>`;
}

export function createSkat(ctx) {
  const { $, show, sleep, T, setStatus, banner, toast, table, params, api, TESTRUN, FAST } = ctx;
  const AUTO = params.has('autoplay');
  let n = 3, s = null, m = null, board = null, lastLeader = null, gen = 0, records = [], started = 0, saving = false;
  const nm = (p) => NAMES[n][p];
  const vb = (p, du, er) => `${nm(p)} ${p === 0 ? du : er}`;
  const alive = (g) => { if (g !== gen) throw new Error('abgebrochen'); };
  const pause = async (g, ms) => { await sleep(T(ms)); alive(g); };
  window.__skat = () => ({ s, m, n, records });

  // --------------------------------------------------------- Warten auf den Menschen (auch für Tests/Autoplay)
  function waitHuman(kind, setup, aiChoice) {
    return new Promise((resolve) => {
      const done = (v) => { window.__skatPending = null; cleanup && cleanup(); resolve(v); };
      const cleanup = setup(done);
      window.__skatPending = { kind, auto: () => done(aiChoice()) };
      if (AUTO) setTimeout(() => window.__skatPending && window.__skatPending.kind === kind && window.__skatPending.auto(), FAST ? 40 : 450);
    });
  }

  // --------------------------------------------------------- HUD
  function buildHud() {
    $('hud').dataset.n = n; $('hud').dataset.game = 'skat';
    $('hud-players').innerHTML = NAMES[n].map((x, p) => `
      <div class="pl" id="pl-${p}"><i class="peg p${p}"></i>
        <span class="nm"><span class="full">${x}</span><span class="short">${SHORT[x]}</span></span>
        <b class="tot" id="sc-${p}">0</b><span class="rd" id="rd-${p}"><span class="rl">Augen </span>0</span></div>`).join('');
    $('stat-stock').querySelector('.k').textContent = 'Skat';
    document.querySelector('#hud .stat .k').textContent = 'Reiz';
    document.querySelector('#hud .stat.trump .k').textContent = 'Spiel';
  }
  function updateHud() {
    show('hud');
    for (let p = 0; p < n; p++) $('sc-' + p).textContent = m.totals[p];
    if (!s) return;
    $('i-bid').innerHTML = s.bid ? `${s.bid}<small>${SHORT[nm(s.declarer)]}</small>` : (s.auction.bid ? `${s.auction.bid}<small>…</small>` : '–');
    $('i-trump').innerHTML = s.game ? gameChip(s.game) + (s.kontra ? `<small class="kre">${s.kontra === 2 ? 'Re' : 'Kontra'}</small>` : '') : '<span class="none">–</span>';
    const done = s.tricks.length + (s.trick.length ? 1 : 0);
    $('i-trick').textContent = `${Math.min(10, done)}/10`;
    $('i-stock').textContent = s.phase === 'bid' || s.phase === 'skat' ? '2' : (s.handGame ? 'Hand' : '–');
    for (let p = 0; p < n; p++) {
      const el = $('pl-' + p);
      el.classList.toggle('sitout', p === s.sitting);
      el.classList.toggle('turn', (s.phase === 'play' && s.turn === p) || (s.phase === 'bid' && S.bidTurn(s)?.p === p));
      el.classList.toggle('decl', s.declarer === p && !!s.bid);
      const role = s.order.indexOf(p);
      $('rd-' + p).innerHTML = p === s.sitting ? '<span class="rl">setzt </span>aus' : `<span class="rl">${role >= 0 ? ROLE_S[role] + ' · ' : ''}</span>${S.eyesOf(s.taken[p])}`;
    }
  }

  // --------------------------------------------------------- Serie / Runde
  async function start(players) {
    const g = ++gen;
    n = players; m = S.newMatch(n); records = []; started = Date.now(); saving = false;
    table.setPlayers(n); table.showPegs(false);
    buildHud(); show('hud'); ctx.measureHud();
    try { await series(g); } catch (e) { if (e.message !== 'abgebrochen') console.error(e); }
  }
  function abort() { gen++; s = null; window.__skatPending = null; for (const id of ['sk-bid', 'sk-choice', 'sk-announce']) show(id, false); }
  async function series(g) {
    while (!m.done) {
      await deal(g);
      alive(g);
    }
  }

  async function deal(g) {
    table.clearBoard(); board = newBoard(); lastLeader = null;
    const dealer = S.dealerFor(m, m.deals.length);
    const deck = ctx.shuffle(S.DECK);
    s = S.newDeal({ n, dealer, deck });
    updateHud();
    setStatus(`Spiel ${m.deals.length + 1} von ${S.MATCH_DEALS} – ${vb(dealer, 'gibst', 'gibt')}${n === 4 ? ` und ${dealer === 0 ? 'setzt' : 'setzt'} aus` : ''}`);
    await dealAnimation(g);
    await bidding(g);
    if (s.phase === 'skat') await skatPhase(g);
    if (s.phase === 'kontra') await kontraPhase(g);
    await playLoop(g);
    await endOfDeal(g);
  }

  function layoutCpu(p, dur = 0.35, arc = 0.3) {
    const cards = S.sortForGame(s.hands[p], s.game);
    const open = !!(s.game && s.game.ouvert && p === s.declarer);
    cards.forEach((c, k) => { const mm = table.tiles.get(c); if (mm) table.flyToWorld(mm, table.computerSlot(k, cards.length, p), { faceUp: open, dur: T(dur), arc }); });
  }
  async function dealAnimation(g) {
    const all = [...s.order.flatMap((p) => s.hands[p]), ...s.skat];
    all.forEach((c, i) => { const mm = table.makeTile(c, false); table.scene.add(mm); mm.position.copy(table.stockSlot(all.length - 1 - i)); });
    await pause(g, 250);
    for (let p = 1; p < n; p++) if (s.hands[p].length) layoutCpu(p, 0.55, 1.0);
    await pause(g, 150);
    for (const c of s.hands[0]) table.setFace(table.tiles.get(c), true);
    table.setHand(S.sortForGame(s.hands[0], null), !FAST);
    s.skat.forEach((c, k) => { const mm = table.tiles.get(c); table.tween(mm, { pos: table.stockSlot(k), quat: mm.quaternion.clone(), scale: 1, dur: T(0.3) }); });
    await pause(g, 600);
    if (s.sitting === 0) { await banner('Du gibst und setzt aus<small>Die drei Computer spielen dieses Spiel</small>', 1500); alive(g); }
  }

  // --------------------------------------------------------- Reizen
  async function bidding(g) {
    show('sk-bid'); renderBid();
    while (s.phase === 'bid') {
      const t = S.bidTurn(s);
      renderBid(); updateHud();
      let act;
      if (t.p !== 0) {
        setBidButtons(null, `${nm(t.p)} überlegt …`);
        setStatus(`${nm(t.p)} ${t.role === 'say' ? 'reizt' : 'hört'} …`, true);
        await pause(g, 750 + Math.random() * 450);
        act = AI.chooseBid(s, t.p);
        const say = act === 'pass' ? 'weg' : act === 'yes' ? 'ja' : String(t.value);
        toastBid(t.p, say);
      } else {
        const who = t.role === 'answer' ? `${nm(s.auction.sayer)} sagt ${t.value}` : (s.auction.stage === 3 ? 'Alle anderen sind weg' : (s.auction.bid ? `${nm(s.auction.listener)} hält ${s.auction.bid}` : 'Du sagst an'));
        setStatus(`${who} – ${t.role === 'answer' ? 'Ja oder weg?' : (t.value ? `${t.value} sagen oder weg?` : 'weg?')}`);
        act = await humanBid(t);
        alive(g);
      }
      s = S.applyBid(s, t.p, act);
      renderBid(); updateHud();
    }
    setBidButtons(null, ''); setStatus('');
    await pause(g, 450);
    show('sk-bid', false);
    if (s.game && s.game.type === 'ramsch') {
      await banner('Alle sind weg – Ramsch<small>Jeder spielt für sich · wer die meisten Augen hat, verliert sie</small>', 2200); alive(g);
      table.setHand(S.sortForGame(s.hands[0], s.game));
    } else {
      await banner(`${vb(s.declarer, 'spielst', 'spielt')} – Reiz ${s.bid}<small>${s.declarer === 0 ? 'Du bist Alleinspieler' : 'Alleinspieler gegen dich und deinen Mitspieler'}</small>`, 1500); alive(g);
    }
  }
  function toastBid(p, say) { const el = document.querySelector(`#skb-seats [data-p="${p}"] .sv`); if (el) { el.textContent = say; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 600); } }
  function renderBid() {
    const a = s.auction;
    const last = (p) => { for (let i = a.log.length - 1; i >= 0; i--) if (a.log[i].p === p) return a.log[i]; return null; };
    const t = S.bidTurn(s);
    $('skb-seats').dataset.n = 3;
    $('skb-seats').innerHTML = s.order.map((p, r) => {
      const l = last(p);
      const state = a.passed.includes(p) ? 'passed' : '';
      const val = l ? (l.act === 'pass' ? 'weg' : l.act === 'yes' ? 'ja' : l.value) : '–';
      return `<div class="seat ${state} ${t && t.p === p ? 'turn' : ''}" data-p="${p}"><i class="peg p${p}"></i><span class="sn">${SHORT[nm(p)]}</span><em class="vh" title="${ROLE[r]}">${ROLE_S[r]}</em><span class="sv">${val}</span></div>`;
    }).join('');
    const sayer = a.stage < 3 ? `${SHORT[nm(a.sayer)]} sagt` : '';
    $('skb-high').innerHTML = a.bid ? `<span class="k">Gereizt</span><b>${a.bid}</b><span class="who">${a.stage === 1 ? `${SHORT[nm(a.sayer)]} → ${SHORT[nm(a.listener)]}` : a.stage === 2 ? `${SHORT[nm(a.sayer)]} → ${SHORT[nm(a.listener)]}` : ''}</span>`
      : `<span class="k">Noch nichts gereizt</span><b>18</b><span class="who">${sayer || 'Vorhand'} zuerst</span>`;
    $('skb-log').innerHTML = a.log.map((e) => `<span class="chip-tile p${e.p} ${e.act === 'pass' ? 'pass' : ''}" title="${nm(e.p)}">${e.act === 'pass' ? 'W' : e.act === 'yes' ? 'Ja' : e.value}</span>`).join('');
  }
  function setBidButtons(t, waitTxt) {
    const up = $('skb-yes'), pass = $('skb-pass');
    if (!t) { up.disabled = pass.disabled = true; up.innerHTML = waitTxt ? `<span class="wait">${waitTxt}</span>` : '…'; up.classList.add('waiting'); return; }
    up.classList.remove('waiting'); pass.disabled = false;
    if (t.role === 'answer') { up.disabled = false; up.innerHTML = `Ja <b>${t.value}</b>`; }
    else if (t.value) { up.disabled = false; up.innerHTML = `<b>${t.value}</b> sagen`; }
    else { up.disabled = true; up.innerHTML = 'höher geht nicht'; }
  }
  function humanBid(t) {
    return waitHuman('bid', (done) => {
      setBidButtons(t);
      $('skb-yes').onclick = () => done(t.role === 'answer' ? 'yes' : 'say');
      $('skb-pass').onclick = () => done('pass');
      return () => { $('skb-yes').onclick = $('skb-pass').onclick = null; setBidButtons(null, ''); };
    }, () => AI.chooseBid(s, 0));
  }

  // --------------------------------------------------------- Skat, Drücken, Ansage
  function choice({ title, rule, text, a, b, kind, ai }) {
    return waitHuman(kind, (done) => {
      $('skc-title').textContent = title; $('skc-rule').textContent = rule || ''; $('skc-text').innerHTML = text || '';
      $('skc-a').innerHTML = a; $('skc-a').disabled = false; show('skc-b', !!b); $('skc-b').innerHTML = b || '';
      show('sk-choice');
      $('skc-a').onclick = () => done(true); $('skc-b').onclick = () => done(false);
      return () => { show('sk-choice', false); $('skc-a').onclick = $('skc-b').onclick = null; };
    }, ai);
  }
  async function skatPhase(g) {
    const d = s.declarer;
    if (d === 0) {
      table.setHand(S.sortForGame(s.hands[0], null));
      const take = await choice({ kind: 'skat', title: `Reiz ${s.bid} gewonnen`, rule: 'Skat oder Hand?', text: 'Nimm den Skat auf und drücke danach zwei Steine – oder spiele <b>Hand</b> (der Skat bleibt liegen, das Spiel zählt eine Stufe mehr).', a: 'Skat aufnehmen', b: 'Hand spielen', ai: () => AI.chooseTakeSkat(s, 0) });
      alive(g);
      s = S.chooseSkat(s, 0, take);
      if (take) {
        for (const c of s.initial.skat) table.setFace(table.tiles.get(c), true);
        table.setHand(S.sortForGame(s.hands[0], null));
        await pause(g, 500);
        const cards = await humanDiscard();
        alive(g);
        s = S.discard(s, 0, cards);
        table.hand = table.hand.filter((c) => !cards.includes(c)); table.layoutHand(true);
        for (const c of cards) table.setFace(table.tiles.get(c), false);
        await Promise.all(cards.map((c, k) => table.flyToWorld(table.tiles.get(c), table.stockSlot(k), { faceUp: false, dur: T(0.5), arc: 0.8 })));
      }
      const game = await humanAnnounce();
      alive(g);
      s = S.announce(s, 0, game);
    } else {
      setStatus(`${nm(d)} überlegt: Skat oder Hand …`, true);
      await pause(g, 900);
      const take = AI.chooseTakeSkat(s, d);
      s = S.chooseSkat(s, d, take);
      if (take) {
        setStatus(`${nm(d)} nimmt den Skat auf …`, true);
        layoutCpu(d, 0.5, 0.8); await pause(g, 900);
        const cards = AI.chooseDiscard(s, d);
        s = S.discard(s, d, cards);
        await Promise.all(cards.map((c, k) => table.flyToWorld(table.tiles.get(c), table.stockSlot(k), { faceUp: false, dur: T(0.5), arc: 0.8 })));
        layoutCpu(d); setStatus(`${nm(d)} hat zwei Steine gedrückt`);
        await pause(g, 600);
      } else { setStatus(`${nm(d)} spielt Hand`); await pause(g, 700); }
      s = S.announce(s, d, AI.chooseGame(s, d));
    }
    setStatus('');
    table.setHand(S.sortForGame(s.hands[0], s.game));
    updateHud();
    const val = S.baseValue(s.game, [...s.initial.hands[d], ...s.initial.skat]);
    await banner(`${gameName(s.game)}<small>${vb(d, 'spielst', 'spielt')} · Reiz ${s.bid}${d === 0 ? ` · Spielwert ab ${val}` : ''}</small>`, 1800); alive(g);
    if (s.game.ouvert && d !== 0) { layoutCpu(d, 0.6, 0.6); toast(`${nm(d)} spielt offen – seine Steine liegen aufgedeckt`, 2600); }
  }
  function humanDiscard() {
    return waitHuman('discard', (done) => {
      const sel = new Set();
      const upd = () => {
        const pts = [...sel].reduce((a, c) => a + S.eyes(c), 0);
        $('skc-text').innerHTML = `${sel.size} von 2 gewählt${sel.size ? ` · ${pts} Augen (zählen für dich)` : ''}`;
        $('skc-a').disabled = sel.size !== 2;
      };
      $('skc-title').textContent = 'Skat aufgenommen'; $('skc-rule').textContent = '2 Steine drücken';
      $('skc-a').innerHTML = 'Drücken'; show('skc-b', false); show('sk-choice'); upd();
      table.setPlayable(s.hands[0], s.hands[0]);
      table.onPick = (card) => {
        if (sel.has(card)) sel.delete(card); else if (sel.size < 2) sel.add(card); else return;
        for (const c of s.hands[0]) { const u = table.tiles.get(c).userData; u.sel = sel.has(c); u.lift = u.sel ? 0.34 : 0; }
        table.layoutHand(true); upd();
      };
      $('skc-a').onclick = () => { if (sel.size === 2) done([...sel]); };
      window.__skatPick = (cards) => { sel.clear(); cards.forEach((c) => sel.add(c)); upd(); };
      return () => {
        table.onPick = null; table.clearPlayable(s.hands[0]); show('sk-choice', false); $('skc-a').onclick = null;
        for (const c of s.hands[0]) { const u = table.tiles.get(c).userData; u.sel = false; u.lift = 0; }
      };
    }, () => AI.chooseDiscard(s, 0));
  }
  function humanAnnounce() {
    const all = [...s.initial.hands[0], ...s.initial.skat];
    let pick = null; const opt = { schneider: false, schwarz: false, ouvert: false };
    return waitHuman('announce', (done) => {
      const render = () => {
        $('ska-info').innerHTML = `Reiz <b>${s.bid}</b> · ${s.handGame ? '<b>Handspiel</b> – Schneider, Schwarz und Ouvert dürfen angesagt werden' : 'Skat aufgenommen'}`;
        for (const b of document.querySelectorAll('#ska-games button')) {
          const g = gameOf(b.dataset.g);
          const ok = S.canAnnounce({ ...g, hand: s.handGame, ouvert: g.type === 'null' && opt.ouvert }, s.bid) || g.type !== 'null';
          b.classList.toggle('on', pick === b.dataset.g); b.classList.toggle('teal', pick === b.dataset.g); b.classList.toggle('ivory', pick !== b.dataset.g);
          b.disabled = !ok;
        }
        const nullPick = pick === 'null';
        show('ska-o-schneider', s.handGame && !nullPick); show('ska-o-schwarz', s.handGame && !nullPick);
        show('ska-o-ouvert', !!pick && (nullPick || s.handGame));
        for (const k of ['schneider', 'schwarz', 'ouvert']) { const b = $('ska-o-' + k); b.classList.toggle('on', opt[k]); b.classList.toggle('teal', opt[k]); b.classList.toggle('wood', !opt[k]); }
        const g = current();
        if (!g) { $('ska-value').innerHTML = 'Wähle eine Spielart.'; $('ska-ok').disabled = true; return; }
        let txt;
        if (g.type === 'null') txt = `${gameName(g)}: fester Wert <b>${S.nullValue(g)}</b>`;
        else {
          const mt = S.matadors(all, g); const v = S.baseValue(g, all);
          const steps = [`${mt.with ? 'mit' : 'ohne'} ${mt.n}`, 'Spiel', g.hand && 'Hand', g.schneider && 'Schneider, angesagt', g.schwarz && 'Schwarz, angesagt', g.ouvert && 'Ouvert'].filter(Boolean);
          txt = `${steps.join(' · ')} = <b>${v}</b> (${S.BASE[g.type === 'grand' ? 'grand' : g.suit]} × ${v / S.BASE[g.type === 'grand' ? 'grand' : g.suit]})`;
          if (v < s.bid) txt += ` <span class="warn">– unter dem Reiz; reicht nur mit Schneider/Schwarz</span>`;
        }
        $('ska-value').innerHTML = txt; $('ska-ok').disabled = false;
      };
      const gameOf = (k) => (k === 'grand' ? { type: 'grand' } : k === 'null' ? { type: 'null' } : { type: 'suit', suit: k });
      const current = () => {
        if (!pick) return null;
        const g = gameOf(pick);
        if (g.type === 'null') return S.normalizeGame({ ...g, hand: s.handGame, ouvert: opt.ouvert });
        if (!s.handGame) return S.normalizeGame({ ...g, hand: false });
        return S.normalizeGame({ ...g, hand: true, schneider: opt.schneider, schwarz: opt.schwarz, ouvert: opt.ouvert });
      };
      for (const b of document.querySelectorAll('#ska-games button')) b.onclick = () => {
        pick = b.dataset.g; if (pick === 'null') { opt.schneider = opt.schwarz = false; }
        else if (!s.handGame) opt.ouvert = false;
        table.setHand(S.sortForGame(s.hands[0], gameOf(pick))); render();
      };
      for (const k of ['schneider', 'schwarz', 'ouvert']) $('ska-o-' + k).onclick = () => {
        opt[k] = !opt[k];
        if (pick !== 'null') { if (k === 'ouvert' && opt.ouvert) opt.schwarz = opt.schneider = true; if (k === 'schwarz' && opt.schwarz) opt.schneider = true;
          if (k === 'schneider' && !opt.schneider) opt.schwarz = opt.ouvert = false; if (k === 'schwarz' && !opt.schwarz) opt.ouvert = false; }
        render();
      };
      $('ska-ok').onclick = () => { const g = current(); if (g && S.canAnnounce(g, s.bid)) done({ type: g.type, suit: g.suit, schneider: g.schneider, schwarz: g.schwarz, ouvert: g.ouvert }); };
      window.__skatAnnounce = (k) => { pick = k; render(); };
      show('sk-announce'); render();
      return () => { show('sk-announce', false); };
    }, () => AI.chooseGame(s, 0));
  }
  async function kontraPhase(g) {
    while (s.phase === 'kontra') {
      const t = S.kontraTurn(s);
      let yes;
      if (t.p === 0) {
        yes = await choice(t.role === 'kontra'
          ? { kind: 'kontra', title: `${nm(s.declarer)} spielt ${gameName(s.game)}`, rule: 'Kontra?', text: 'Glaubst du, das Spiel geht verloren? <b>Kontra</b> verdoppelt den Spielwert.', a: 'Kontra', b: 'Weiter', ai: () => AI.chooseKontra(s, 0) }
          : { kind: 're', title: `${nm(s.kontraBy)} sagt Kontra`, rule: 'Re?', text: 'Mit <b>Re</b> zählt das Spiel vierfach.', a: 'Re', b: 'Weiter', ai: () => AI.chooseKontra(s, 0) });
        alive(g);
      } else {
        await pause(g, 350);
        yes = AI.chooseKontra(s, t.p);
      }
      s = S.applyKontra(s, t.p, yes);
      if (yes) { await banner(t.role === 'kontra' ? `Kontra!<small>${nm(t.p)} verdoppelt</small>` : `Re!<small>${nm(t.p)} verdoppelt noch einmal</small>`, 1300); alive(g); }
      updateHud();
    }
  }

  // --------------------------------------------------------- Spielen
  async function playLoop(g) {
    while (s.phase === 'play') {
      updateHud();
      const p = s.turn;
      let card;
      if (p !== 0) {
        setStatus(s.trick.length ? `${nm(p)} denkt …` : `${nm(p)} spielt aus …`, true);
        await pause(g, 500 + Math.random() * 400);
        card = AI.chooseCard(s, p);
      } else { card = await humanMove(); alive(g); }
      await doMove(g, p, card);
    }
  }
  function humanMove() {
    const legal = S.legalFor(s, 0);
    const leading = s.trick.length === 0;
    const role = s.game.type === 'ramsch' ? 'Ramsch – möglichst wenig Augen' : s.declarer === 0 ? 'Alleinspieler' : `mit ${nm(s.order.find((q) => q !== 0 && q !== s.declarer))}`;
    setStatus(leading ? `Du spielst aus (${role})` : `Du bist dran – ${legal.length < s.hands[0].length ? 'bedienen' : 'freie Wahl'}`);
    return waitHuman('play', (done) => {
      table.setPlayable(s.hands[0], legal);
      table.onPick = (c) => { if (legal.includes(c)) done(c); };
      return () => { table.onPick = null; table.clearPlayable(s.hands[0]); table.hover = null; setStatus(''); };
    }, () => AI.chooseCard(s, 0));
  }
  async function doMove(g, p, card) {
    const leading = s.trick.length === 0;
    const r = S.playCard(s, p, card);
    s = r.state;
    if (leading) { if (board.tracks.length === 0 || lastLeader !== p) board = openTrack(board, p); lastLeader = p; }
    const placed = addTile(board, card); board = placed.board;
    if (p === 0) { table.hand = table.hand.filter((c) => c !== card); table.layoutHand(true); }
    await table.placeOnBoard(card, placed.cell, { faceUp: true });
    alive(g);
    if (p !== 0) layoutCpu(p);
    updateHud();
    const tr = r.events.find((e) => e.type === 'trick');
    if (tr) {
      const last = s.tricks[s.tricks.length - 1];
      const win = last.cards.find((t) => t.p === tr.winner);
      table.pulse(win.card, PULSE[tr.winner]);
      setStatus(`${vb(tr.winner, 'bekommst', 'bekommt')} den Stich (${tr.points} Augen)`);
      await pause(g, 850);
    }
  }

  // --------------------------------------------------------- Abrechnung
  async function endOfDeal(g) {
    setStatus('');
    const res = s.result;
    // Skat aufdecken
    for (const c of s.skat) { const mm = table.tiles.get(c); if (mm) table.setFace(mm, true); }
    for (const p of s.order) if (p !== 0) for (const c of s.hands[p]) { const mm = table.tiles.get(c); if (mm) table.setFace(mm, true); }
    const rec = S.dealRecord(s); records.push(rec);
    m = S.addDeal(m, res, rec);
    updateHud();
    await pause(g, 500);
    renderResult(res);
    const last = m.done;
    await waitHuman('result', (done) => {
      show('result'); $('res-next').textContent = last ? 'Serie auswerten' : 'Nächstes Spiel';
      $('res-next').onclick = () => done(true);
      return () => show('result', false);
    }, () => true);
    alive(g);
    if (last) await matchEnd();
  }
  function renderResult(res) {
    const ps = [...Array(n).keys()];
    const cell = (v, cls = '') => `<td class="${cls} ${typeof v === 'number' && v < 0 ? 'neg' : ''}">${v}</td>`;
    const row = (label, vals, cls = '') => `<tr class="${cls}"><td>${label}</td>${vals.map((v) => cell(v)).join('')}</tr>`;
    $('res-table').dataset.n = n;
    const head = `<tr><th></th>${ps.map((p) => `<th>${SHORT[nm(p)]}</th>`).join('')}</tr>`;
    const notes = [];
    if (res.type === 'ramsch') {
      $('res-title').textContent = res.durchmarsch !== null ? `Durchmarsch von ${nm(res.durchmarsch)}!` : `Ramsch – ${res.losers.map((p) => nm(p)).join(' und ')} ${res.losers.length > 1 ? 'verlieren' : (res.losers[0] === 0 ? 'verlierst' : 'verliert')}`;
      $('res-table').innerHTML = head + row('Augen', ps.map((p) => (p === s.sitting ? '–' : res.points[p]))) + row('Stiche', ps.map((p) => (p === s.sitting ? '–' : res.tricks[p])))
        + row('Punkte', res.tp, 'sum') + row('Gesamt', m.totals, 'sum');
      notes.push(`Der Skat (${s.skat.map(cardName).join(', ')}) ging an ${p0(res.skatTo)} (letzter Stich).`);
      if (res.jungfrau) notes.push(`Jungfrau: ${res.jungfrau === 1 ? 'ein Spieler' : 'zwei Spieler'} ohne Stich – Minuspunkte verdoppelt.`);
    } else {
      const d = res.declarer, G = s.game;
      $('res-title').textContent = `${nm(d)} ${res.won ? (d === 0 ? 'gewinnst' : 'gewinnt') : (d === 0 ? 'verlierst' : 'verliert')} ${gameName(G)}`;
      const def = 120 - res.points;
      const eyesRow = ps.map((p) => (p === s.sitting ? '–' : p === d ? res.points : (G.type === 'null' ? '–' : `(${def})`)));
      let calc;
      if (G.type === 'null') calc = `Null${G.ouvert ? ' Ouvert' : ''}${G.hand ? ' Hand' : ''} = ${res.value}`;
      else {
        const lv = [`${res.matadors.with ? 'mit' : 'ohne'} ${res.matadors.n}`, 'Spiel', G.hand && 'Hand', (res.schneider || G.schneider) && 'Schneider', G.schneider && 'angesagt', (res.schwarz || G.schwarz) && 'Schwarz', G.schwarz && 'angesagt', G.ouvert && 'Ouvert'].filter(Boolean);
        calc = res.overbid ? `überreizt: Reiz ${res.bid} → ${res.value}` : `${lv.join(' · ')} = ${res.mult} × ${S.BASE[G.type === 'grand' ? 'grand' : G.suit]} = ${res.value}`;
      }
      $('res-table').innerHTML = head
        + row(G.type === 'null' ? 'Stiche Allein.' : 'Augen', G.type === 'null' ? ps.map((p) => (p === d ? res.tricks : '–')) : eyesRow)
        + `<tr><td>Spielwert</td><td colspan="${n}" class="calc">${calc}${res.factor > 1 ? ` · ${res.factor === 2 ? 'Kontra ×2' : 'Re ×4'}` : ''}</td></tr>`
        + row('Punkte', res.tp, 'sum') + row('Gesamt', m.totals, 'sum');
      if (G.type !== 'null') notes.push(`Skat: ${s.skat.map(cardName).join(', ')} (${S.eyesOf(s.skat)} Augen, zählen für den Alleinspieler).`);
      notes.push(res.won ? `Gewonnen: +(Spielwert${res.factor > 1 ? ' × ' + res.factor : ''} + 50).` : `Verloren: −(2 × Spielwert${res.factor > 1 ? ' × ' + res.factor : ''} + 50), jeder andere am Tisch +${S.DEFENDER_BONUS[n]}.`);
      if (res.won && d !== 0 && s.sitting !== 0) notes.push('Für die Rangliste: Niederlage zählt nur für den Alleinspieler – für dich keine Wertung.');
    }
    if (s.sitting !== null) notes.push(`${nm(s.sitting)} ${s.sitting === 0 ? 'hast' : 'hat'} gegeben und ausgesetzt.`);
    $('res-note').textContent = notes.join(' ');
  }
  const p0 = (p) => (p === 0 ? 'dich' : nm(p));
  const RN = { A: 'Ass', '10': 'Zehn', K: 'König', Q: 'Dame', J: 'Bube', '9': 'Neun', '8': 'Acht', '7': 'Sieben' };
  const cardName = (c) => `${S.SUIT_NAME[S.suitOf(c)]}-${RN[S.rankOf(c)]}`;

  async function matchEnd() {
    const tot = m.totals, best = Math.max(...tot), me = tot[0];
    const won = me === best && tot.filter((x) => x === best).length === 1;
    $('me-title').textContent = won ? 'Serie gewonnen! 🎉' : `${nm(tot.indexOf(best))} gewinnt die Serie`;
    $('me-text').innerHTML = `Endstand <b>${tot.join(' : ')}</b> nach ${S.MATCH_DEALS} Spielen · deine Bilanz: ${m.wins[0]} Siege, ${m.losses[0]} Niederlagen.`;
    show('matchend');
    $('me-new').textContent = 'Neue Serie';
    $('me-new').onclick = () => { show('matchend', false); start(n); };
    if (saving) return; saving = true;
    if (TESTRUN) { $('me-save').textContent = 'Testlauf – nicht gespeichert'; return; }
    $('me-save').textContent = 'Ergebnis wird gespeichert …';
    try {
      const r = await api.result({ game: 'skat', players: n, totals: tot, wins: m.wins[0], losses: m.losses[0], winner: me > Math.max(...tot.slice(1)) ? 'human' : 'computer',
        duration_s: Math.min(86400, Math.round((Date.now() - started) / 1000)), deals: records });
      const gs = (r.stats || []).find((x) => x.game === 'skat');
      $('me-save').textContent = gs ? `Gespeichert · Skat-Bilanz ${gs.wins} Siege / ${gs.losses} Niederlagen · ${gs.best_total} Punkte` : 'Gespeichert';
    } catch (e) { $('me-save').textContent = 'Nicht gespeichert: ' + e.message; }
  }

  window.addEventListener('resize', () => { if (s && ctx.current() === 'skat') { updateHud(); ctx.measureHud(); } });
  return { start, abort, state: () => s };
}
