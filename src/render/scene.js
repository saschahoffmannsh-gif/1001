// 3D-Tisch: Brett, Steine, Stecker – Three.js mit ACES, weichen Schatten und Umgebungslicht.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import L from '../layout.json';

const BASE = import.meta.env.BASE_URL;
const A = (p) => BASE + 'assets/' + p;
const W = L.boardW, D = L.boardD;
const TILE_T = L.tileT;

// Kamera je Format (Grad). Vorher: Desktop 55°/3°/30°, Hochformat 68°/0°/30°.
export const CAM = {
  desktop: { elev: 48, az: -2.5, fov: 42 },
  portrait: { elev: 56, az: -1, fov: 40 },
};

export function cellToWorld(c, r) {
  const x = -L.cols / 2 + c + 0.5;
  const y = -D / 2 + L.marginBottom + r + 0.5;   // Blender-y
  return new THREE.Vector3(x, 0, -y);
}
export function scoreHoleWorld(total) {
  if (total >= 1001) return new THREE.Vector3(L.boxX, 0, -L.holeY);
  const i = Math.floor(Math.max(0, total) / 50) - 1;
  if (i < 0) return new THREE.Vector3(-L.boxX, 0, -L.holeY);
  const n = L.scores.length;
  const x = L.holeX0 + (L.holeX1 - L.holeX0) * Math.min(i, n - 1) / (n - 1);
  return new THREE.Vector3(x, -L.holeDepth, -L.holeY);
}

const ease = {
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};

export class Table {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = Number(new URLSearchParams(location.search).get('exp') || 0.86);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.dirty = 3;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#f2e5d2');
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(env, 0.04).texture;
    this.scene.environmentIntensity = 0.32;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    this.scene.add(this.camera);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minPolarAngle = 0.15; this.controls.maxPolarAngle = 1.12;
    this.controls.minDistance = 6; this.controls.maxDistance = 120;
    this.controls.enablePan = true; this.controls.screenSpacePanning = false;
    this.controls.minAzimuthAngle = -0.6; this.controls.maxAzimuthAngle = 0.6;
    this.controls.addEventListener('change', () => { this.dirty = Math.max(this.dirty, 2); });

    this.lights();
    this.tweens = [];
    this.tiles = new Map();      // card -> mesh
    this.players = 2;
    this.hand = [];              // menschliche Hand (Karten)
    this.handGroup = new THREE.Group(); this.camera.add(this.handGroup);
    this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    this.onPick = null; this.pickable = new Set(); this.hover = null;
    this.clock = new THREE.Clock();
    this._bindInput();
    window.addEventListener('resize', () => this.resize());
  }

  lights() {
    const hemi = new THREE.HemisphereLight('#fff1de', '#c9a983', 0.4);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#ffe8cc', 2.1);
    sun.position.set(-9, 16, -7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = sun.shadow.camera; s.left = -11; s.right = 11; s.top = 11; s.bottom = -11; s.near = 1; s.far = 50;
    sun.shadow.radius = 9; sun.shadow.blurSamples = 20; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    this.scene.add(sun); this.scene.add(sun.target);
    this.sun = sun;
    const fill = new THREE.DirectionalLight('#ffe9d6', 0.35); fill.position.set(10, 8, 12); this.scene.add(fill);
  }

  async load(onProgress) {
    const mgr = new THREE.LoadingManager();
    mgr.onProgress = (_u, a, b) => onProgress && onProgress(a / b);
    const gltf = new GLTFLoader(mgr);
    const tl = new THREE.TextureLoader(mgr);
    const loadG = (f) => new Promise((res, rej) => gltf.load(A(f), res, undefined, rej));
    const loadT = (f, srgb = true) => new Promise((res, rej) => tl.load(A(f), (t) => {
      t.flipY = false; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); res(t);
    }, undefined, rej));
    const cards = [];
    for (const s of 'DHSC') for (const r of ['7', '8', '9', 'J', 'Q', 'K', '10', 'A']) cards.push(s + r);
    const [board, tile, pegH, pegC, tnorm, back, ...faces] = await Promise.all([
      loadG('board.glb'), loadG('tile.glb'), loadG('peg_human.glb'), loadG('peg_computer.glb'),
      loadT('tex/tile_normal.jpg', false), loadT('tex/tile_back.png'), ...cards.map((c) => loadT(`tex/tile_${c}.png`)),
    ]);
    // Brett
    this.board = board.scene;
    this.board.traverse((o) => {
      if (o.isMesh) {
        o.receiveShadow = true; o.castShadow = true;
        const m = o.material;
        for (const k of ['map', 'roughnessMap', 'normalMap']) if (m[k]) m[k].anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        if (m.name === 'BoardTop') { m.roughness = 1.0; if (m.normalScale) m.normalScale.set(0.55, 0.55); m.envMapIntensity = 0.8; }
        else { m.roughness = 0.7; }
      }
    });
    this.scene.add(this.board);
    // Tisch
    const tableTex = this._tableTexture();
    const table = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ color: '#f3e4cf', roughness: 0.92, map: tableTex }));
    table.rotation.x = -Math.PI / 2; table.position.y = -L.boardT - 0.002; table.receiveShadow = true;
    this.scene.add(table);
    // Steine
    this.tileGeo = null;
    tile.scene.traverse((o) => { if (o.isMesh && !this.tileGeo) this.tileGeo = o.geometry; });
    tnorm.wrapS = tnorm.wrapT = THREE.RepeatWrapping;
    this.faceMat = {};
    const mk = (map) => new THREE.MeshPhysicalMaterial({
      map, normalMap: tnorm, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.5, metalness: 0,
      clearcoat: 0.22, clearcoatRoughness: 0.42, sheen: 0.08, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ffffff'),
      envMapIntensity: 0.9,
    });
    cards.forEach((c, i) => { this.faceMat[c] = mk(faces[i]); });
    this.backMat = mk(back);
    this.shadowTex = this._shadowTexture();
    // Stecker
    const prep = (g) => { const o = g.scene; o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
    const tint = (o, col) => { const c = o.clone(true); c.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.color = new THREE.Color(col); } }); return c; };
    const pc = prep(pegC);
    this.pegs = [prep(pegH), pc, tint(pc, '#3d7880'), tint(pc, '#e07a3c')];   // Du rot, Computer 1 anthrazit, 2 petrol, 3 orange
    this.pegs.forEach((g, p) => { g.position.copy(this.pegHome(p)); this.scene.add(g); g.visible = p < this.players; });
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  _tableTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(400, 380, 50, 512, 512, 720);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#e9ddcd');
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 1024);
    const img = g.getImageData(0, 0, 1024, 1024);
    for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 6; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  _shadowTexture() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 140;
    const g = c.getContext('2d');
    g.filter = 'blur(9px)'; g.fillStyle = 'rgba(60,40,20,0.75)';
    const r = 18; const x = 22, y = 22, w = 84, h = 96;
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.fill();
    const t = new THREE.CanvasTexture(c); return t;
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h); this.invalidate();
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.layoutHand(false);
    this.resetCamera();
  }
  heroCamera() {
    this._camSet = true; this.heroCam = true;
    this.camera.position.set(1.0, 13.4, 7.9); this.controls.target.set(0.75, 0, -0.55); this.camera.fov = 33; this.camera.updateProjectionMatrix(); this.controls.update(); this.invalidate();
  }
  resetCamera() {
    if (this.heroCam) return this.heroCamera();
    this._camSet = true;
    const aspect = this.camera.aspect;
    const portrait = aspect < 0.8;
    // Spielkamera wie die Blender-Vorschau (tiles_7_8_blender): vom Spielerplatz leicht schräg über das Brett
    // zur Zähleiste. Blender: Kamera (0.9, -8.6, 9.2) -> Ziel (0.7, -0.2, 0), 42 mm, Brett 2.5° gedreht.
    const q = new URLSearchParams(location.search);
    const C = portrait ? CAM.portrait : CAM.desktop;
    const elev = THREE.MathUtils.degToRad(Number(q.get('elev')) || C.elev);
    const az = THREE.MathUtils.degToRad(q.has('az') ? Number(q.get('az')) : C.az);
    const fov = Number(q.get('fov')) || C.fov;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); this.layoutHand(false); }
    const handTop = 1 - 2 * (this.handTopFrac ?? 0.8);          // NDC-Höhe der Handoberkante
    const hudNdc = 1 - 2 * (this.hudPx || (portrait ? 86 : 70)) / this.container.clientHeight;
    const pts = {
      top: new THREE.Vector3(0, 0.2, -(D / 2 + 1.5)),
      fl: new THREE.Vector3(-W / 2, 0, D / 2), fr: new THREE.Vector3(W / 2, 0, D / 2),
      gl: new THREE.Vector3(-L.cols / 2, 0, D / 2 - L.marginBottom), gr: new THREE.Vector3(L.cols / 2, 0, D / 2 - L.marginBottom),
      bl: new THREE.Vector3(-W / 2 - 0.2, 0, -D / 2), br: new THREE.Vector3(W / 2 + 0.6, 0.2, -(D / 2 + 1.5)),
      tl: new THREE.Vector3(this.players > 2 ? -W / 2 - 0.2 : 0, 0.2, -(D / 2 + 1.5)),
    };
    const place = (tz, dist) => {
      const t = new THREE.Vector3(0.1, 0, tz);
      this.camera.position.set(t.x + dist * Math.cos(elev) * Math.sin(az), dist * Math.sin(elev), t.z + dist * Math.cos(elev) * Math.cos(az));
      this.camera.lookAt(t); this.camera.updateMatrixWorld(); this.camera.updateProjectionMatrix();
      return t;
    };
    const ok = () => {
      const p = {}; for (const k in pts) p[k] = pts[k].clone().project(this.camera);
      if (p.top.y > hudNdc || p.br.y > hudNdc || p.tl.y > hudNdc) return false;
      // Raster, Zähleiste und Ablagen bleiben ganz im Bild; der vordere Brettrand darf (wie in der
      // Blender-Vorschau) leicht unter die Hand bzw. über den Bildrand laufen.
      for (const k of ['gl', 'gr', 'bl', 'br', 'tl']) if (Math.abs(p[k].x) > 0.97) return false;
      for (const k of ['fl', 'fr']) if (Math.abs(p[k].x) > (portrait ? 1.04 : 0.99)) return false;
      if (p.gl.y < handTop + 0.01 || p.gr.y < handTop + 0.01) return false;
      return true;
    };
    let best = null;
    for (let tz = -7; tz <= 4.01; tz += 0.25) {
      for (let dist = 8; dist < 90; dist *= 1.03) { place(tz, dist); if (ok()) { if (!best || dist < best.dist) best = { tz, dist }; break; } }
    }
    if (!best) best = { tz: 0.8, dist: 30 };
    // Brett zwischen HUD und Hand mittig setzen (im Hochformat bleibt oben sonst eine Lücke)
    if (portrait) {
      const dist = best.dist * 1.01; let bestOff = Infinity;
      for (let tz = best.tz - 2; tz <= best.tz + 2; tz += 0.05) {
        place(tz, dist); if (!ok()) continue;
        const top = pts.top.clone().project(this.camera).y, bot = pts.gl.clone().project(this.camera).y;
        const off = Math.abs((hudNdc - top) - (bot - handTop));
        if (off < bestOff) { bestOff = off; best = { tz, dist }; }
      }
    }
    const t = place(best.tz, best.dist);
    this.controls.target.copy(t);
    this.controls.update(); this.invalidate();
  }

  // ---------------------------------------------------------- Steine
  makeTile(card, faceUp) {
    const mesh = new THREE.Mesh(this.tileGeo, faceUp ? this.faceMat[card].clone() : this.backMat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.card = card; mesh.userData.faceUp = faceUp;
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(L.tileW * 1.45, L.tileH * 1.45), new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, opacity: 0.55, depthWrite: false, color: '#000000' }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.004; sh.renderOrder = 1;
    sh.material.color.set('#3a2a1a');
    mesh.userData.shadow = sh;
    this.tiles.set(card, mesh);
    return mesh;
  }
  setFace(mesh, faceUp) {
    mesh.userData.faceUp = faceUp;
    mesh.material = faceUp ? this.faceMat[mesh.userData.card].clone() : this.backMat;
  }

  // Ablageplätze. 2 Spieler: Computer-Hand oben, Stock rechts.
  // 3 Spieler: Computer 1 oben links, Computer 2 oben rechts, Talon (2 Steine) in der Mitte.
  // 4 Spieler: Computer 1 links, 2 Mitte, 3 rechts – alle hinter dem Brett.
  setPlayers(n) {
    this.players = n;
    if (this.pegs) this.pegs.forEach((g, p) => { g.visible = p < n; g.position.copy(this.pegHome(p)); });
    this.resetCamera();
  }
  seatLayout(seat) {
    const n = this.players;
    if (n === 2) return { cx: -0.7, sp: 0.98 };
    if (n === 3) return { cx: seat === 1 ? -3.15 : 3.15, sp: 0.5 };
    return { cx: [0, -4.05, 0, 4.05][seat], sp: 0.37 };
  }
  computerSlot(i, count, seat = 1) {
    const { cx, sp } = this.seatLayout(seat);
    const x0 = cx - ((count - 1) * sp) / 2;
    // eng gefächert: Kacheln überlappen leicht, jede minimal höher (kein Flimmern)
    return new THREE.Vector3(x0 + i * sp, -L.boardT + (sp < 0.9 ? i * 0.012 : 0), -(D / 2 + 0.95) - (sp < 0.9 ? i * 0.004 : 0));
  }
  stockSlot(i) {
    const x = this.players === 2 ? W / 2 - 0.6 : 0;
    return new THREE.Vector3(x, -L.boardT + i * (TILE_T + 0.004), -(D / 2 + 0.95));
  }
  pegHome(p) {
    const off = [[-0.36, -0.3], [0.36, -0.3], [-0.36, 0.3], [0.36, 0.3]][p];
    return scoreHoleWorld(0).add(new THREE.Vector3(off[0], 0, off[1]));
  }

  // Hand des Menschen: im Kameraraum, immer lesbar
  layoutHand(animate = true) {
    const n = this.hand.length; if (!this.camera) return;
    const dist = 6;
    const vh = 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const vw = vh * this.camera.aspect;
    const rows = this.camera.aspect < 0.8 && n > 5 ? 2 : 1;
    const perRow = Math.ceil(n / rows) || 1;
    const sp = 1.04;
    let scale = Math.min(0.5, (vw * 0.92) / (perRow * sp), vh * 0.115 / L.tileH);
    this.handScale = scale;
    const bottom = -vh / 2 + (rows === 2 ? 1.75 : 0.62) * scale * L.tileH + vh * 0.03;
    this.handTopFrac = 1 - ((bottom + scale * L.tileH * 0.75) / vh + 0.5);   // Anteil von oben
    this.onHandLayout && this.onHandLayout(this.handTopFrac);
    this.hand.forEach((card, i) => {
      const m = this.tiles.get(card); if (!m) return;
      const row = Math.floor(i / perRow), col = i % perRow;
      const inRow = row === rows - 1 ? n - perRow * (rows - 1) : perRow;
      const x = (col - (inRow - 1) / 2) * sp * scale;
      const y = bottom - row * scale * L.tileH * 1.12 + (m.userData.lift || 0) * scale;
      const pos = new THREE.Vector3(x, y, -dist);
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.42, 0, 0));
      if (m.parent !== this.handGroup) {
        // aus der Welt in die Hand übernehmen
        const wp = m.getWorldPosition(new THREE.Vector3()); const wq = m.getWorldQuaternion(new THREE.Quaternion());
        this.handGroup.add(m);
        this.camera.updateMatrixWorld();
        m.position.copy(this.handGroup.worldToLocal(wp));
        m.quaternion.copy(this.camera.quaternion.clone().invert().multiply(wq));
        this.hideShadow(m);
      }
      m.castShadow = false;
      if (animate) this.tween(m, { pos, quat, scale, dur: 0.45, arc: 0 });
      else { m.position.copy(pos); m.quaternion.copy(quat); m.scale.setScalar(scale); }
    });
  }
  setHand(cards, animate = true) { this.hand = cards.slice(); this.layoutHand(animate); }

  liftHand(card, on) {
    const m = this.tiles.get(card); if (!m) return;
    const base = m.userData.sel ? 0.34 : 0; m.userData.lift = on ? Math.max(0.22, base) : base; this.layoutHand(true);
  }
  setPlayable(cards, legal) {
    this.pickable = new Set(legal);
    for (const c of cards) {
      const m = this.tiles.get(c); if (!m || !m.userData.faceUp) continue;
      const ok = legal.includes(c);
      m.material.color.setScalar(ok ? 1 : 0.5);
      m.material.needsUpdate = false;
    }
  }
  clearPlayable(cards) { this.pickable = new Set(); for (const c of cards) { const m = this.tiles.get(c); if (m && m.userData.faceUp) m.material.color.setScalar(1); } }

  // ---------------------------------------------------------- Animation
  tween(obj, { pos, quat, scale, dur = 0.6, arc = 0, delay = 0, onMid, flip = false }) {
    if (this.instant) { if (pos) obj.position.copy(pos); if (quat) obj.quaternion.copy(quat); if (scale !== undefined) obj.scale.setScalar(scale); onMid && onMid(); this.invalidate(); return Promise.resolve(); }
    return new Promise((resolve) => {
      this.tweens = this.tweens.filter((t) => t.obj !== obj);
      this.tweens.push({ obj, p0: obj.position.clone(), q0: obj.quaternion.clone(), s0: obj.scale.x, pos, quat, scale, dur, arc, flip, t: -delay, resolve, onMid, mid: false });
    });
  }
  wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // Stein von irgendwo in Weltkoordinaten an eine Zielposition fliegen lassen
  async flyToWorld(m, target, { faceUp = true, rotY = 0, dur = 0.75, arc = 1.6 } = {}) {
    if (m.parent !== this.scene) {
      const wp = m.getWorldPosition(new THREE.Vector3()), wq = m.getWorldQuaternion(new THREE.Quaternion()), ws = m.getWorldScale(new THREE.Vector3()).x;
      this.scene.add(m); m.position.copy(wp); m.quaternion.copy(wq); m.scale.setScalar(ws);
    }
    m.castShadow = true;
    this.hideShadow(m);
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0));
    const flip = faceUp !== m.userData.faceUp;
    await this.tween(m, { pos: target, quat, scale: 1, dur, arc, flip, onMid: flip ? () => this.setFace(m, faceUp) : null });
    this.dropShadow(m, target, rotY);
  }
  hideShadow(m) { if (m.userData.shadow) m.userData.shadow.removeFromParent(); }
  dropShadow(m, pos, rotY = 0) {
    const sh = m.userData.shadow; if (!sh) return;
    this.scene.add(sh); sh.position.set(pos.x + 0.07, pos.y + 0.004, pos.z + 0.08); sh.rotation.set(-Math.PI / 2, 0, rotY);
  }

  async placeOnBoard(card, cell, { faceUp = true, rotY = (Math.random() - 0.5) * 0.05 } = {}) {
    const m = this.tiles.get(card);
    const t = cellToWorld(cell[0], cell[1]);
    t.x += (Math.random() - 0.5) * 0.04; t.z += (Math.random() - 0.5) * 0.04;
    await this.flyToWorld(m, t, { faceUp, rotY, dur: 0.7, arc: 1.4 });
    return m;
  }

  pulse(card, color = '#ffcf6b') {
    const m = this.tiles.get(card); if (!m || this.instant) return;
    m.material = m.material.clone();
    m.material.emissive = new THREE.Color(color);
    m.userData.pulse = 1.6;
  }


  async movePeg(p, total) {
    const peg = this.pegs[p];
    const tgt = scoreHoleWorld(total);
    const off = [[-0.36, -0.3], [0.36, -0.3], [-0.36, 0.3], [0.36, 0.3]][p];
    if (total < 50 || total >= 1001) tgt.add(new THREE.Vector3(off[0], 0, off[1]));
    else tgt.add(new THREE.Vector3(off[0] * 0.2, 0, off[1] * 0.2));
    await this.tween(peg, { pos: tgt, quat: peg.quaternion.clone(), scale: peg.scale.x, dur: 0.9, arc: 0.9 });
  }

  clearBoard() {
    for (const [, m] of this.tiles) { m.removeFromParent(); m.userData.shadow && m.userData.shadow.removeFromParent(); if (m.material !== this.backMat) m.material.dispose(); }
    this.tiles.clear(); this.hand = []; this.tweens = [];
  }

  // ---------------------------------------------------------- Eingabe
  _bindInput() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const hit = this._hit(e);
      el.style.cursor = hit ? 'pointer' : 'grab';
      if (hit !== this.hover) {
        if (this.hover) this.liftHand(this.hover, false);
        this.hover = hit; if (hit) this.liftHand(hit, true);
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 8) return;
      const hit = this._hit(e);
      if (hit && this.onPick) this.onPick(hit);
    });
  }
  _hit(e) {
    if (!this.pickable.size) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = this.hand.map((c) => this.tiles.get(c)).filter(Boolean);
    const hits = this.raycaster.intersectObjects(meshes, false);
    for (const h of hits) { const c = h.object.userData.card; if (this.pickable.has(c)) return c; }
    return null;
  }

  // ---------------------------------------------------------- Schleife
  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const done = [];
    for (const tw of this.tweens) {
      tw.t += dt; if (tw.t < 0) continue;
      const k = Math.min(1, tw.t / tw.dur), e = ease.inOutCubic(k);
      tw.obj.position.lerpVectors(tw.p0, tw.pos, e);
      if (tw.arc) tw.obj.position.y += Math.sin(Math.PI * e) * tw.arc;
      if (tw.quat) tw.obj.quaternion.slerpQuaternions(tw.q0, tw.quat, ease.outCubic(k));
      if (tw.flip) tw.obj.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI * (1 - ease.inOutCubic(k))));
      if (tw.scale !== undefined) tw.obj.scale.setScalar(tw.s0 + (tw.scale - tw.s0) * e);
      if (!tw.mid && k >= 0.5) { tw.mid = true; tw.onMid && tw.onMid(); }
      if (k >= 1) done.push(tw);
    }
    if (done.length) { this.tweens = this.tweens.filter((t) => !done.includes(t)); done.forEach((t) => t.resolve()); }
    for (const [, m] of this.tiles) {
      if (m.userData.pulse > 0) {
        m.userData.pulse -= dt;
        const v = Math.max(0, Math.sin(m.userData.pulse * 6)) * 0.35 * Math.min(1, m.userData.pulse);
        m.material.emissiveIntensity = v;
        if (m.userData.pulse <= 0) m.material.emissiveIntensity = 0;
      }
    }
    this.controls.update();
    let anim = this.tweens.length > 0;
    for (const [, m] of this.tiles) if (m.userData.pulse > 0) anim = true;
    if (anim) { this.dirty = 2; this.renderer.shadowMap.needsUpdate = true; }
    if (this.dirty <= 0) return;
    if (this.dirty >= 3) this.renderer.shadowMap.needsUpdate = true;
    this.dirty--;
    this.renderer.render(this.scene, this.camera);
  }
  invalidate() { this.dirty = 3; }
}
