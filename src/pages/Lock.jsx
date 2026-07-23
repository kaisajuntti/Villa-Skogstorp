import { useState } from "react";
import { VIEW_HASH, EDIT_HASH } from "../appconfig.js";
import { setAccess } from "../config.js";
import { syncPull } from "../storage.js";

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function Lock({ onUnlocked }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const h = (await sha256hex(pw)).toLowerCase();
      const level = h === EDIT_HASH.toLowerCase() ? "edit" : h === VIEW_HASH.toLowerCase() ? "view" : null;
      if (level) {
        setAccess(level);
        await syncPull();
        onUnlocked?.();
        return;
      }
      setErr("Fel lösenord.");
    } catch {
      setErr("Något gick fel — försök igen.");
    }
    setBusy(false);
  };

  return (
    <div style={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 340, textAlign: "center" }}>
        <div style={{ fontSize: 22, letterSpacing: 2, fontWeight: 600, marginBottom: 4 }}>VILLA SKOGSTORP</div>
        <p className="sub" style={{ marginBottom: 16 }}>Ange lösenord för att öppna.</p>
        <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)}
          placeholder="Lösenord" style={{ textAlign: "center", marginBottom: 12 }} />
        <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Öppnar …" : "Öppna"}
        </button>
        {err && <p className="sub" style={{ color: "var(--red)", marginTop: 10 }}>{err}</p>}
      </form>
    </div>
  );
}
