import { useState } from "react";
import { login, requestPasswordReset } from "../auth.js";
import { syncPull } from "../storage.js";

function errorText(e) {
  if (e.status === 400 || e.status === 401) return "Fel e-post eller lösenord.";
  if (e.status === 429) return "För många försök — vänta en stund.";
  if (!e.status) return "Ingen kontakt med servern — kontrollera nätet.";
  return "Inloggningen misslyckades (" + e.message + ").";
}

export default function Login({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await login(email, pw);
      await syncPull();
      onLoggedIn?.();
      return;
    } catch (e2) {
      setErr(errorText(e2));
    }
    setBusy(false);
  };

  return (
    <div style={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 340, textAlign: "center" }}>
        <div style={{ fontSize: 22, letterSpacing: 2, fontWeight: 600, marginBottom: 4 }}>VILLA SKOGSTORP</div>
        <p className="sub" style={{ marginBottom: 16 }}>Logga in för att öppna.</p>
        <input type="email" autoFocus autoComplete="username" autoCapitalize="none" value={email}
          onChange={(e) => setEmail(e.target.value)} placeholder="E-post"
          style={{ textAlign: "center", marginBottom: 10 }} />
        <input type="password" autoComplete="current-password" value={pw}
          onChange={(e) => setPw(e.target.value)} placeholder="Lösenord"
          style={{ textAlign: "center", marginBottom: 12 }} />
        <button className="btn primary" type="submit" disabled={busy || !email || !pw} style={{ width: "100%" }}>
          {busy ? "Loggar in …" : "Logga in"}
        </button>
        {err && <p className="sub" style={{ color: "var(--red)", marginTop: 10 }}>{err}</p>}
        <button type="button" className="btn small" style={{ marginTop: 14, border: "none", color: "var(--muted)" }}
          onClick={async () => {
            if (!email) { setErr("Skriv din e-post först, tryck sedan på Glömt lösenord."); return; }
            try { await requestPasswordReset(email); setErr("Om kontot finns har en länk skickats till " + email + ". Öppna den på den här enheten."); }
            catch (e2) { setErr("Kunde inte skicka länk: " + e2.message); }
          }}>Glömt lösenord?</button>
      </form>
    </div>
  );
}
