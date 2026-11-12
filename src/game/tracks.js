// Spuren auf dem Raster: jeder Stich wird in einer sichtbaren Reihe weitergelegt.
export const COLS = 11, ROWS = 8;
const DIRS = [[1, 0], [0, -1], [-1, 0], [0, 1]]; // rechts, runter (zum Spieler), links, hoch

export function newBoard() { return { tracks: [], occ: {} }; }
const key = (c, r) => c + ',' + r;
const inside = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;

function freeWithClearance(b, c, r, ownId) {
  if (!inside(c, r) || b.occ[key(c, r)] !== undefined) return false;
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const o = b.occ[key(c + dc, r + dr)];
    if (o !== undefined && o !== ownId) return false;
  }
  return true;
}

function rowEmpty(b, r) {
  if (r < 0 || r >= ROWS) return true;
  for (let c = 0; c < COLS; c++) if (b.occ[key(c, r)] !== undefined) return false;
  return true;
}
function findStart(b) {
  // bevorzugt: eine eigene, freie Reihe (mit Abstand), wie Rommé-Reihen untereinander
  for (let r = ROWS - 1; r >= 0; r--) {
    if (rowEmpty(b, r) && rowEmpty(b, r + 1) && rowEmpty(b, r - 1)) return [r % 4 === 3 ? 1 : 2, r];
  }
  // Reihen von oben nach unten, mit Abstand; bevorzugt Platz für 4 Steine nach rechts
  for (const need of [4, 3, 2, 1]) {
    for (let r = ROWS - 1; r >= 0; r--) {
      for (let c = 0; c + need <= COLS; c++) {
        let ok = true;
        for (let k = 0; k < need && ok; k++) {
          const cc = c + k;
          if (b.occ[key(cc, r)] !== undefined) ok = false;
          for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (b.occ[key(cc + dc, r + dr)] !== undefined) ok = false;
        }
        if (ok) return [c, r];
      }
    }
  }
  for (let r = ROWS - 1; r >= 0; r--) for (let c = 0; c < COLS; c++) if (b.occ[key(c, r)] === undefined) return [c, r];
  return null;
}

export function openTrack(b0, owner) {
  const b = { tracks: b0.tracks.map((t) => ({ ...t, cells: t.cells.slice() })), occ: { ...b0.occ } };
  b.tracks.push({ id: b.tracks.length, owner, cells: [], dir: 0 });
  return b;
}

// legt einen Stein an die aktuelle (letzte) Spur; liefert {board, cell:[c,r]}
export function addTile(b0, card) {
  const b = { tracks: b0.tracks.map((t) => ({ ...t, cells: t.cells.slice() })), occ: { ...b0.occ } };
  const t = b.tracks[b.tracks.length - 1];
  let cell = null;
  if (t.cells.length === 0) {
    cell = findStart(b);
  } else {
    const [lc, lr] = t.cells[t.cells.length - 1];
    const order = [t.dir, (t.dir + 1) % 4, (t.dir + 3) % 4, 3];
    for (const strict of [true, false]) {
      for (const d of order) {
        const [dc, dr] = DIRS[d];
        const c = lc + dc, r = lr + dr;
        if (strict ? freeWithClearance(b, c, r, t.id) : (inside(c, r) && b.occ[key(c, r)] === undefined)) { cell = [c, r]; t.dir = d; break; }
      }
      if (cell) break;
    }
    if (!cell) cell = findStart(b);
  }
  t.cells.push(cell);
  b.occ[key(cell[0], cell[1])] = t.id;
  (t.cards ||= []).push(card);
  return { board: b, cell };
}
