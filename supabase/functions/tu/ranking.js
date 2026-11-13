// Card Master – Spielkatalog und Ranglisten-Logik (reines ES-Modul; Edge Function + Node-Tests).
//
// Gesamtrangliste „Card Master“: Summe der Siege über alle Spiele.
//   Gleichstand: 1. weniger Niederlagen, 2. zuletzt gespielt (neuer zuerst), 3. Name (A–Z).
// Rangliste je Spiel: Siege; Gleichstand: 1. beste Punktzahl, 2. weniger Niederlagen, 3. zuletzt gespielt, 4. Name.

export const GAMES = {
  "1001": { name: "1001", results: true },
  romme: { name: "Rommé", results: false },
  skat: { name: "Skat", results: true },
  bridge: { name: "Bridge", results: false },
};
export const GAME_IDS = Object.keys(GAMES);

export function normGame(g) {
  if (g === undefined || g === null || g === "") return "1001";
  return typeof g === "string" ? g.trim().toLowerCase() : String(g);
}
export function isKnownGame(g) { return Object.prototype.hasOwnProperty.call(GAMES, normGame(g)); }
export function acceptsResults(g) { const id = normGame(g); return isKnownGame(id) && GAMES[id].results === true; }

const ts = (v) => (v ? Date.parse(v) || 0 : 0);
const byName = (a, b) => String(a.display_name ?? "").localeCompare(String(b.display_name ?? ""), "de");

// rows: [{ profile_id, display_name, game, wins, losses, matches_played, best_total, last_played_at }]
export function aggregateOverall(rows, limit = 50) {
  const by = new Map();
  for (const r of rows || []) {
    if (!r || !r.profile_id || !isKnownGame(r.game)) continue;
    let a = by.get(r.profile_id);
    if (!a) {
      a = { profile_id: r.profile_id, display_name: r.display_name ?? "", wins: 0, losses: 0, matches_played: 0, last_played_at: null, games: {} };
      by.set(r.profile_id, a);
    }
    const w = r.wins | 0, l = r.losses | 0, m = r.matches_played | 0;
    a.wins += w; a.losses += l; a.matches_played += m;
    a.games[normGame(r.game)] = { wins: w, losses: l, matches_played: m, best_total: r.best_total | 0 };
    if (ts(r.last_played_at) > ts(a.last_played_at)) a.last_played_at = r.last_played_at;
  }
  const list = [...by.values()].filter((a) => a.matches_played > 0);
  list.sort((a, b) => b.wins - a.wins || a.losses - b.losses || ts(b.last_played_at) - ts(a.last_played_at) || byName(a, b));
  return list.slice(0, limit).map((a, i) => ({ rank: i + 1, ...a }));
}

export function rankGame(rows, game, limit = 50) {
  const id = normGame(game);
  const list = (rows || []).filter((r) => r && normGame(r.game) === id && (r.matches_played | 0) > 0)
    .map((r) => ({ profile_id: r.profile_id, display_name: r.display_name ?? "", wins: r.wins | 0, losses: r.losses | 0,
      matches_played: r.matches_played | 0, best_total: r.best_total | 0, last_played_at: r.last_played_at ?? null }));
  list.sort((a, b) => b.wins - a.wins || b.best_total - a.best_total || a.losses - b.losses
    || ts(b.last_played_at) - ts(a.last_played_at) || byName(a, b));
  return list.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r }));
}

// Neuer Zählerstand eines Spiels nach einer Partie
export function applyResult(stat, { won, deals, total, at }) {
  const s = stat || { matches_played: 0, wins: 0, losses: 0, deals_played: 0, best_total: 0, last_played_at: null };
  return {
    matches_played: s.matches_played + 1, wins: s.wins + (won ? 1 : 0), losses: s.losses + (won ? 0 : 1),
    deals_played: s.deals_played + (deals | 0), best_total: Math.max(s.best_total | 0, total | 0), last_played_at: at,
  };
}
