// Supabase Edge Function "tu" – nur Publishable Key im Client.
const FN = 'https://wlujgkbtpjxuekwsgnmg.supabase.co/functions/v1/tu';
const KEY = 'sb_publishable__YfnUKq2YmpK_t4muHQ6Iw_R1i96s1P';
const LS = 'tu_player_token';

export function token() {
  let t = localStorage.getItem(LS);
  if (!t || !/^[a-f0-9]{64}$/.test(t)) {
    const b = new Uint8Array(32); crypto.getRandomValues(b);
    t = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(LS, t);
  }
  return t;
}
async function call(method, params, body) {
  const url = method === 'GET' ? FN + '?' + new URLSearchParams(params) : FN;
  const res = await fetch(url, {
    method,
    headers: { apikey: KEY, authorization: 'Bearer ' + token(), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Server nicht erreichbar');
  return data;
}
export const api = {
  profile: (display_name) => call('POST', null, { action: 'profile', display_name }),
  result: (r) => call('POST', null, { action: 'result', ...r }),
  leaderboard: () => call('GET', { action: 'leaderboard' }),
  history: () => call('GET', { action: 'history' }),
};
