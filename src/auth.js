// Supabase Auth (email + password) over plain fetch — no dependency.
// The session lives in localStorage on this device only:
//   vs:v1:session  { access_token, refresh_token, expires_at (unix s), user }
// Every request to Supabase (data, versions, photo upload) sends the user's
// access token, so row-level security can require a logged-in user.
// Edit vs view comes from the user's app_metadata.access ('edit' | 'view') —
// app_metadata can only be set by an admin, not by the user (see config.js).
import { SUPABASE } from "./appconfig.js";

const SESSION_KEY = "vs:v1:session";
const base = SUPABASE.url.replace(/\/+$/, "") + "/auth/v1";

export function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    return s && s.access_token && s.refresh_token ? s : null;
  } catch { return null; }
}
function saveSession(s) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event("vs-config"));
}
function fromTokenResponse(j) {
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user: j.user ? { id: j.user.id, email: j.user.email, app_metadata: j.user.app_metadata || {} } : null,
  };
}

async function tokenRequest(grant, body) {
  const r = await fetch(`${base}/token?grant_type=${grant}`, {
    method: "POST",
    headers: { apikey: SUPABASE.key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error_description || j.msg || j.message || "HTTP " + r.status);
    e.status = r.status;
    throw e;
  }
  return j;
}

export async function login(email, password) {
  const j = await tokenRequest("password", { email: email.trim(), password });
  saveSession(fromTokenResponse(j));
}

export async function logout() {
  const s = getSession();
  saveSession(null);
  if (s) {
    try {
      await fetch(`${base}/logout`, {
        method: "POST",
        headers: { apikey: SUPABASE.key, Authorization: "Bearer " + s.access_token },
      });
    } catch { /* offline — local logout is enough */ }
  }
}

// Refresh once at a time (several requests may ask simultaneously).
let refreshing = null;
async function refresh(s) {
  if (!refreshing) {
    refreshing = tokenRequest("refresh_token", { refresh_token: s.refresh_token })
      .then((j) => { const n = fromTokenResponse(j); if (!n.user) n.user = s.user; saveSession(n); return n; })
      .catch((e) => {
        // 400/401 = refresh token revoked/expired → log out. Network errors keep the session.
        if (e.status === 400 || e.status === 401) saveSession(null);
        throw e;
      })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

// A valid access token (refreshed when < 2 min left), or null when logged out.
export async function getToken() {
  let s = getSession();
  if (!s) return null;
  if (s.expires_at - Date.now() / 1000 < 120) s = await refresh(s);
  return s.access_token;
}

// Headers for any Supabase REST/Storage call.
export async function authHeaders() {
  const t = await getToken();
  return { apikey: SUPABASE.key, Authorization: "Bearer " + (t || SUPABASE.key) };
}
