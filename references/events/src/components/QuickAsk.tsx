"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ensureUser, supabaseBrowser } from "@/lib/supabase/client";
import { ago, authorOf, awaitingApproval, byNew, byTop, useQuestions } from "@/lib/useQuestions";
import { qaError } from "@/lib/qaErrors";
import type { Question } from "@/lib/types";

const MAX = 280;

// What people land on after scanning the QR on the big screen: ask in one tap, no account.
export default function QuickAsk({ eventId, title, slug }: { eventId: string; title: string; slug: string }) {
  const { questions, myVotes, uid, loaded, reload } = useQuestions(eventId);
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [sort, setSort] = useState<"top" | "new">("top");
  const [voting, setVoting] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { try { setName(localStorage.getItem("ke-ask-name") ?? ""); } catch { /* storage blocked */ } }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (text.length < 3) return;
    setErr(""); setBusy(true);
    try {
      const me = await ensureUser();
      const sb = supabaseBrowser();
      // no automatic upvote of one's own question: the list counts other people's votes
      const { error } = await sb.from("questions")
        .insert({ event_id: eventId, body: text, anonymous: !name.trim(), author_id: me.id, author_name: name.trim().slice(0, 60) || null });
      if (error) throw error;
      try { localStorage.setItem("ke-ask-name", name.trim()); } catch { /* storage blocked */ }
      setBody(""); setSent(true); setTimeout(() => setSent(false), 5000);
      reload();
    } catch (x) { setErr(qaError(x)); }
    setBusy(false);
  }

  async function vote(q: Question) {
    setErr(""); setVoting(q.id);
    try {
      const me = await ensureUser();
      const sb = supabaseBrowser();
      const { error } = myVotes.has(q.id)
        ? await sb.from("question_votes").delete().eq("question_id", q.id).eq("user_id", me.id)
        : await sb.from("question_votes").insert({ question_id: q.id, user_id: me.id });
      if (error) throw error;
      reload();
    } catch (x) { setErr(qaError(x)); }
    setVoting("");
  }

  const visible = questions.filter((q) => q.status !== "hidden");
  const list = visible.sort(sort === "top" ? byTop : byNew);
  const left = MAX - body.length;

  return (
    <div className="wrap qa qa-page">
      <header className="qa-head">
        <div className="eyebrow">Ask the speakers</div>
        <h1>{title}</h1>
      </header>

      <form className="qa-form" onSubmit={ask}>
        <label className="lbl" htmlFor="qa-body">Your question</label>
        <textarea id="qa-body" className="qa-box" value={body} onChange={(e) => setBody(e.target.value.slice(0, MAX))}
          placeholder="Type a question for the speakers" maxLength={MAX} rows={4} required />
        <span className={`qa-count ${left < 30 ? "low" : ""}`} aria-live="polite">{left} {left === 1 ? "character" : "characters"} left</span>
        <input className="qa-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" maxLength={40} aria-label="Your name, optional" autoComplete="name" />
        <button className="btn primary qa-send" type="submit" disabled={busy || body.trim().length < 3}>{busy ? "Sending…" : "Send question"}</button>
        <p className="muted small qa-fine">No account needed. Leave the name empty to ask anonymously.{
          // the guest mark comes with 0014; before that questions have no guest field
          (!questions.length || questions.some((q) => q.guest !== undefined)) && " Without an account, the name shows with “(guest)” after it."}</p>
        {sent && <div className="ok" role="status">Sent. It is in the list below.</div>}
        {err && <div className="note" role="alert">{err}</div>}
      </form>

      <section className="qa-list-wrap" aria-labelledby="qa-list-h">
        <div className="qa-list-h">
          <h2 id="qa-list-h">Questions <span className="muted">{visible.length || ""}</span></h2>
          <div className="seg" role="group" aria-label="Sort questions">
            <button aria-pressed={sort === "top"} onClick={() => setSort("top")}>Top</button>
            <button aria-pressed={sort === "new"} onClick={() => setSort("new")}>New</button>
          </div>
        </div>
        <p className="muted small">Tap the arrow on the questions that should be answered first.</p>
        <div className="qa-list">
          {list.map((q) => {
            const mine = q.mine ?? (!!uid && q.author_id === uid);
            return (
              <article key={q.id} className={`qa-item ${q.featured ? "is-feat" : ""} ${q.status === "answered" ? "is-done" : ""}`}>
                <button className={`qa-vote ${myVotes.has(q.id) ? "on" : ""}`} onClick={() => vote(q)} disabled={voting === q.id}
                  aria-pressed={myVotes.has(q.id)} aria-label={`${myVotes.has(q.id) ? "Remove upvote" : "Upvote"}, ${q.votes} votes`}>
                  <span aria-hidden="true">▲</span><span>{q.votes}</span>
                </button>
                <div className="qa-body">
                  <p>{q.body}</p>
                  <div className="qa-meta">
                    {authorOf(q)}{mine ? " (you)" : ""} · {ago(q.created_at, now)}
                    {q.featured && <span className="pill host">On screen now</span>}
                    {q.status === "answered" && <span className="pill plain">Answered</span>}
                    {mine && awaitingApproval(q) && <span className="pill plain">Not on the big screen yet</span>}
                  </div>
                </div>
              </article>
            );
          })}
          {loaded && !list.length && <div className="empty"><b>No questions yet</b>New questions show up here within a few seconds.</div>}
          {!loaded && <div className="muted small">Loading questions…</div>}
        </div>
      </section>

      <p className="muted small qa-foot"><Link href={`/events/${slug}`}>About this event</Link> · Recordings and slides are published on Kleros Events after the event.</p>
    </div>
  );
}
