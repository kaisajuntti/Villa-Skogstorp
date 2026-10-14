// Small password screens: "Byt lösenord" (logged in) and the page a reset link lands on.
import { useEffect, useState } from "react";
import { setPassword, consumeRecoveryHash } from "../auth.js";

function PasswordForm({ onDone, title, intro }) {
  const [a, setA] = useState(""), [b, setB] = useState("");
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (a.length < 8) return setMsg("Minst 8 tecken.");
    if (a !== b) return setMsg("Lösenorden är inte lika.");
    setBusy(true); setMsg("");
    try { await setPassword(a); setMsg("Klart – lösenordet är bytt."); setA(""); setB(""); onDone?.(); }
    catch (e2) { setMsg("Gick inte: " + e2.message); }
    setBusy(false);
  };
  return (
    <form onSubmit={submit} style={{ maxWidth: 340 }}>
      <h2>{title}</h2>
      {intro && <p className="sub">{intro}</p>}
      <input type="password" autoComplete="new-password" placeholder="Nytt lösenord (minst 8 tecken)" value={a} onChange={(e) => setA(e.target.value)} style={{ marginBottom: 8 }} />
      <input type="password" autoComplete="new-password" placeholder="Upprepa" value={b} onChange={(e) => setB(e.target.value)} style={{ marginBottom: 10 }} />
      <button className="btn primary" disabled={busy || !a || !b} style={{ width: "100%" }}>{busy ? "Sparar …" : "Spara nytt lösenord"}</button>
      {msg && <p className="sub" style={{ marginTop: 8 }}>{msg}</p>}
    </form>
  );
}

export function ChangePassword() {
  return (
    <div className="page">
      <h1>KONTO</h1>
      <PasswordForm title="Byt lösenord" intro="Välj ett nytt lösenord för det här kontot. Tips: spara det i iPhonens/iPadens lösenordshanterare när den frågar." />
    </div>
  );
}

// Landing page for the e-mailed reset link.
export function RecoverPassword({ onDone }) {
  const [state, setState] = useState("loading"); // loading | form | error
  const [err, setErr] = useState("");
  useEffect(() => { consumeRecoveryHash().then(() => setState("form")).catch((e) => { setErr(e.message); setState("error"); }); }, []);
  return (
    <div style={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      {state === "loading" && <p className="sub">Öppnar länken …</p>}
      {state === "error" && <p className="sub" style={{ color: "var(--red)" }}>{err} <a href="#/">Till inloggningen</a></p>}
      {state === "form" && <PasswordForm title="Välj nytt lösenord" onDone={() => setTimeout(() => onDone?.(), 900)} />}
    </div>
  );
}
