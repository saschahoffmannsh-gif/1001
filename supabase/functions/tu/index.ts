// Tausendundeins (1001) Edge Function. Berührt nur tu_* Tabellen.
// Service-Role bleibt auf dem Server (env), nie im Spiel-Client.
// Spiel gegen den Computer läuft komplett im Client; hier: Profil, Ergebnisse, Rangliste, Verlauf.
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,authorization,apikey,x-client-info",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8" } });

class HttpErr extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}
const fail = (status: number, msg: string): never => { throw new HttpErr(status, msg); };

const TOKEN_RE = /^[a-f0-9]{64}$/;
const TARGET = 1001;

// ---------- Rate-Limit (wie sc/ofs) ----------
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_PROFILE_MAX = 5;
const RATE_WRITE_MAX = 60;
const RATE_RESULT_MAX = 20;
const RATE_GLOBAL_MAX = 3000;

async function sha256hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sanitizeName(raw: unknown): string {
  let s = typeof raw === "string" ? raw : "";
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff<>]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  s = [...s].slice(0, 20).join("").trim();
  return s.length ? s : "Spieler";
}
function clientIp(req: Request) {
  const xf = req.headers.get("x-forwarded-for") ?? "";
  return (xf.split(",")[0] || req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || "unknown").trim();
}
async function bump(bucket: string, keyHash: string, windowStart: string, max: number, msg: string) {
  const { data, error } = await db.from("tu_rate_limit").select("hits")
    .eq("bucket", bucket).eq("key_hash", keyHash).eq("window_start", windowStart).maybeSingle();
  if (error) fail(500, "Serverfehler (Limit)");
  const hits = (data?.hits ?? 0) + 1;
  if (hits > max) fail(429, msg);
  const { error: upErr } = await db.from("tu_rate_limit")
    .upsert({ bucket, key_hash: keyHash, window_start: windowStart, hits }, { onConflict: "bucket,key_hash,window_start" });
  if (upErr) fail(500, "Serverfehler (Limit)");
}
async function rateLimit(req: Request, kind: "profile" | "write" | "result") {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS).toISOString();
  const ipHash = await sha256hex("tu:" + clientIp(req));
  if (kind === "profile") await bump("profile", ipHash, windowStart, RATE_PROFILE_MAX, "Zu viele neue Profile – bitte in ein paar Minuten nochmal versuchen");
  if (kind === "result") await bump("result", ipHash, windowStart, RATE_RESULT_MAX, "Zu viele Ergebnisse in kurzer Zeit – bitte kurz warten");
  await bump("write", ipHash, windowStart, RATE_WRITE_MAX, "Zu viele Anfragen – bitte kurz warten");
  await bump("global", "all", windowStart, RATE_GLOBAL_MAX, "Gerade ist sehr viel los – bitte später nochmal versuchen");
  if (Math.random() < 0.03) {
    await db.from("tu_rate_limit").delete().lt("window_start", new Date(now - 24 * 3600 * 1000).toISOString());
  }
}

function bearer(req: Request) {
  const raw = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!TOKEN_RE.test(raw)) fail(401, "Kein gültiges Spieler-Token");
  return raw;
}
const PROFILE_COLS = "id,display_name,matches_played,wins,losses,deals_played,best_total,created_at,updated_at";

async function profileByToken(token: string) {
  const { data, error } = await db.from("tu_profiles").select(PROFILE_COLS).eq("token_hash", await sha256hex(token)).maybeSingle();
  if (error) fail(500, "Serverfehler (Profil)");
  return data;
}
function int(v: unknown, label: string, min: number, max: number): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n)) fail(400, `${label} fehlt oder ist keine ganze Zahl`);
  if ((n as number) < min || (n as number) > max) fail(400, `${label} liegt außerhalb des gültigen Bereichs`);
  return n as number;
}

// ---------- Aktionen ----------
async function actProfile(req: Request, body: Record<string, unknown>) {
  const token = bearer(req);
  const existing = await profileByToken(token);
  if (existing) {
    if (body.display_name !== undefined) {
      await rateLimit(req, "write");
      const name = sanitizeName(body.display_name);
      const { data, error } = await db.from("tu_profiles").update({ display_name: name, updated_at: new Date().toISOString() })
        .eq("id", existing.id).select(PROFILE_COLS).single();
      if (error) fail(500, "Serverfehler (Profil)");
      return json({ profile: data });
    }
    return json({ profile: existing });
  }
  await rateLimit(req, "profile");
  const { data, error } = await db.from("tu_profiles")
    .insert({ token_hash: await sha256hex(token), display_name: sanitizeName(body.display_name) })
    .select(PROFILE_COLS).single();
  if (error) fail(500, "Profil konnte nicht angelegt werden");
  return json({ profile: data, created: true });
}

type DealRow = { bidder: number; bid: number; made: boolean; delta: number[]; melds?: number[] };

async function actResult(req: Request, body: Record<string, unknown>) {
  const token = bearer(req);
  const prof = await profileByToken(token);
  if (!prof) fail(404, "Profil nicht gefunden – bitte Seite neu laden");
  await rateLimit(req, "result");
  const players = body.players === undefined ? 2 : int(body.players, "Spielerzahl", 2, 4);
  const humanTotal = int(body.human_total, "Punkte (Du)", -5000, 5000);
  const cpuTotal = int(body.computer_total, "Punkte (Computer)", -5000, 5000);
  const winner = body.winner === "human" || body.winner === "computer" ? body.winner : fail(400, "Sieger fehlt");
  const dealsRaw = Array.isArray(body.deals) ? body.deals as DealRow[] : fail(400, "Rundenliste fehlt");
  if (dealsRaw.length < 1 || dealsRaw.length > 300) fail(400, "Ungültige Rundenzahl");
  // Plausibilität: Summen der Runden ergeben den Endstand (je Spieler), Sieger hat 1001 erreicht
  const tot = new Array(players).fill(0);
  let bidsWon = 0, bidsMade = 0, highest = 0, melds = 0;
  const log = dealsRaw.map((d, i) => {
    const bidder = int(d.bidder, `Runde ${i + 1}: Reizgewinner`, 0, players - 1);
    const bid = int(d.bid, `Runde ${i + 1}: Reiz`, 40, 400);
    if (bid % 10 !== 0) fail(400, "Reiz muss in 10er-Schritten sein");
    if (!Array.isArray(d.delta) || d.delta.length !== players) fail(400, `Runde ${i + 1}: Punkte fehlen`);
    const delta = d.delta.map((x, p) => int(x, `Runde ${i + 1}: Punkte Spieler ${p + 1}`, -400, 400));
    const ml = Array.isArray(d.melds) ? d.melds.map((x) => int(x, "Meldung", 0, 280)) : new Array(players).fill(0);
    if (ml.length !== players) fail(400, "Meldungen unplausibel");
    if (delta.reduce((a, x) => a + Math.max(0, x), 0) > 400) fail(400, "Rundenpunkte unplausibel");
    delta.forEach((x, p) => { tot[p] += x; });
    highest = Math.max(highest, bid); melds += ml[0];
    if (bidder === 0) { bidsWon++; if (d.made) bidsMade++; }
    return { bidder, bid, made: !!d.made, delta, melds: ml };
  });
  const h = tot[0], c = Math.max(...tot.slice(1));
  if (h !== humanTotal || c !== cpuTotal) fail(400, "Endstand passt nicht zu den Runden");
  if (Array.isArray(body.totals) && (body.totals.length !== players || body.totals.some((x, p) => Number(x) !== tot[p]))) fail(400, "Endstand passt nicht zu den Runden");
  const winTotal = winner === "human" ? h : c;
  if (winTotal < TARGET) fail(400, "Sieger hat 1001 nicht erreicht");
  const durationS = body.duration_s === undefined ? 0 : int(body.duration_s, "Dauer", 0, 86400);
  const { data: m, error } = await db.from("tu_matches").insert({
    profile_id: prof!.id, human_total: h, computer_total: c, winner, deals: log.length, players, totals: tot,
    bids_won: bidsWon, bids_made: bidsMade, highest_bid: highest, melds, deal_log: log, duration_s: durationS,
  }).select("id,created_at").single();
  if (error) fail(500, "Ergebnis konnte nicht gespeichert werden");
  const won = winner === "human";
  const { data: p2, error: e2 } = await db.from("tu_profiles").update({
    matches_played: prof!.matches_played + 1, wins: prof!.wins + (won ? 1 : 0), losses: prof!.losses + (won ? 0 : 1),
    deals_played: prof!.deals_played + log.length, best_total: Math.max(prof!.best_total, h), updated_at: new Date().toISOString(),
  }).eq("id", prof!.id).select(PROFILE_COLS).single();
  if (e2) fail(500, "Serverfehler (Profil)");
  return json({ match: m, profile: p2 });
}

async function actLeaderboard() {
  const { data, error } = await db.from("tu_profiles").select("display_name,wins,losses,matches_played,best_total")
    .gt("matches_played", 0).order("wins", { ascending: false }).order("best_total", { ascending: false }).limit(20);
  if (error) fail(500, "Serverfehler (Rangliste)");
  return json({ leaderboard: data });
}
async function actHistory(req: Request) {
  const prof = await profileByToken(bearer(req));
  if (!prof) fail(404, "Profil nicht gefunden");
  const { data, error } = await db.from("tu_matches").select("id,human_total,computer_total,winner,deals,players,highest_bid,bids_won,bids_made,created_at")
    .eq("profile_id", prof!.id).order("created_at", { ascending: false }).limit(15);
  if (error) fail(500, "Serverfehler (Verlauf)");
  return json({ history: data, profile: prof });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      const action = url.searchParams.get("action") ?? "health";
      if (action === "leaderboard") return await actLeaderboard();
      if (action === "history") return await actHistory(req);
      if (action === "health") return json({ ok: true, game: "tausendundeins" });
      return fail(400, "Unbekannte Aktion");
    }
    if (req.method === "POST") {
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return fail(400, "Ungültige Anfrage (JSON)"); }
      if (JSON.stringify(body).length > 30000) fail(413, "Anfrage zu groß");
      const action = body.action;
      if (action === "profile") return await actProfile(req, body);
      if (action === "result") return await actResult(req, body);
      return fail(400, "Unbekannte Aktion");
    }
    return fail(405, "Methode nicht erlaubt");
  } catch (e) {
    if (e instanceof HttpErr) return json({ error: e.message }, e.status);
    console.error(e instanceof Error ? e.message : "unknown error");
    return json({ error: "Unerwarteter Serverfehler" }, 500);
  }
});
