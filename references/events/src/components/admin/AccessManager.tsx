"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export type AccessRow = {
  email: string;
  user_id: string | null;
  display_name: string | null;
  is_team: boolean;
  is_admin: boolean;
  kleros_email: boolean;
  granted: boolean;
  blocked: boolean;
  note: string | null;
  granted_at: string | null;
  last_sign_in: string | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AccessManager({ rows, myId }: { rows: AccessRow[]; myId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState("");
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(confirmTimer.current), []);
  /** First press arms the button for 4 seconds; a second press within that time acts. */
  function arm(email: string) {
    setConfirm(email);
    clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirm((c) => (c === email ? "" : c)), 4000);
  }

  const members = rows.filter((r) => r.is_team && r.user_id && !r.blocked);
  const invited = rows.filter((r) => r.granted && !r.user_id);
  const blocked = rows.filter((r) => r.blocked);

  async function run(key: string, done: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(key); setMsg(null); setConfirm("");
    const { error } = await fn();
    setBusy("");
    if (error) { setMsg({ ok: false, text: "Could not save: " + error.message }); return false; }
    setMsg({ ok: true, text: done });
    router.refresh();
    return true;
  }

  async function grant(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const email = String(f.get("email") ?? "").trim().toLowerCase();
    const note = String(f.get("note") ?? "").trim() || null;
    if (!EMAIL.test(email)) { setMsg({ ok: false, text: "That does not look like an email address." }); return; }
    const ok = await run("grant", `${email} can now use the team desk.`, () =>
      supabaseBrowser().from("team_access").upsert({ email, note, blocked: false }, { onConflict: "email" }));
    if (ok) form.reset();
  }
  const remove = (r: AccessRow) =>
    run(r.email, `${r.email} no longer has access.`, () => supabaseBrowser().from("team_access").delete().eq("email", r.email));
  const block = (r: AccessRow) =>
    run(r.email, `${r.email} is blocked.`, () =>
      supabaseBrowser().from("team_access").upsert({ email: r.email, blocked: true, note: r.note }, { onConflict: "email" }));
  const unblock = (r: AccessRow) =>
    run(r.email, `${r.email} is unblocked.`, () => supabaseBrowser().from("team_access").delete().eq("email", r.email));

  function action(r: AccessRow) {
    if (r.is_admin) return <span className="muted small">Always has access</span>;
    if (r.blocked) return <button className="btn sm" disabled={busy === r.email} onClick={() => unblock(r)}>Unblock</button>;
    const isRemove = r.granted && !r.kleros_email;
    const armed = confirm === r.email;
    return (
      <button className={`btn sm ${armed ? "danger-armed" : ""}`} disabled={busy === r.email}
        onClick={() => (armed ? (isRemove ? remove(r) : block(r)) : arm(r.email))}>
        {armed ? (isRemove ? "Remove?" : "Block?") : isRemove ? "Remove" : "Block"}
      </button>
    );
  }

  /** The display name, unless it is missing or just the part of the email before the @. */
  const nameOf = (r: AccessRow) => {
    const n = r.display_name?.trim();
    return n && n.toLowerCase() !== r.email.split("@")[0].toLowerCase() ? n : null;
  };

  function source(r: AccessRow) {
    if (r.is_admin) return <span className="pill host">{r.email === "weiwei@kleros.io" ? "Master admin" : "Admin"}</span>;
    if (r.blocked) return <span className="pill ex">Blocked</span>;
    if (r.kleros_email) return <span className="pill plain">@kleros.io</span>;
    if (r.granted) return <span className="pill part">Added by email</span>;
    return <span className="pill plain">Set in database</span>;
  }

  const list = (items: AccessRow[]) => (
    <ul className="acc-list">
      {items.map((r) => (
        <li key={r.email} className="acc-row">
          <div className="acc-who">
            <b className="acc-email">{nameOf(r) ?? r.email}{r.user_id === myId && <span className="muted small"> (you)</span>}</b>
            {nameOf(r) && <span className="small muted acc-email">{r.email}</span>}
            {r.note && <span className="small muted">{r.note}</span>}
          </div>
          <div className="acc-src">{source(r)}</div>
          <div className="acc-act">{action(r)}</div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="stack" style={{ gap: 28 }}>
      <form className="panel" onSubmit={grant}>
        <h2>Add someone</h2>
        <div className="acc-form">
          <div className="field"><label htmlFor="acc-email">Email</label><input id="acc-email" name="email" type="email" required placeholder="name@example.com" autoComplete="off" /></div>
          <div className="field"><label htmlFor="acc-note">Note (optional)</label><input id="acc-note" name="note" placeholder="Speaker coordinator, Devconnect" /></div>
          <button className="btn primary" type="submit" disabled={busy === "grant"}>{busy === "grant" ? "Adding…" : "Give access"}</button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Access starts the next time they sign in with that email. Blocking an @kleros.io address removes its access too.</p>
        {msg && <div className={msg.ok ? "ok" : "note"} role="status">{msg.text}</div>}
      </form>

      <section className="stack">
        <div className="acc-h"><h2>Team members</h2><span className="muted small">{members.length}</span></div>
        {members.length ? list(members) : <div className="empty"><b>Nobody yet</b>People appear here after their first sign-in.</div>}
      </section>

      {invited.length > 0 && (
        <section className="stack">
          <div className="acc-h"><h2>Added, not signed in yet</h2><span className="muted small">{invited.length}</span></div>
          {list(invited)}
        </section>
      )}

      {blocked.length > 0 && (
        <section className="stack">
          <div className="acc-h"><h2>Blocked</h2><span className="muted small">{blocked.length}</span></div>
          {list(blocked)}
        </section>
      )}
    </div>
  );
}
