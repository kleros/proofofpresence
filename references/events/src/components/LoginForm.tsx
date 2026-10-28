"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setState("sending"); setErr("");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) { setErr(error.message); setState("idle"); return; }
    setState("sent");
  }
  if (state === "sent") return <div className="ok">Check {email} for your sign-in link.</div>;
  return (
    <form className="panel" onSubmit={submit}>
      <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      {err && <div className="note">{err}</div>}
      <button className="btn primary" type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Email me a sign-in link"}</button>
    </form>
  );
}
