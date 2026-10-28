"use client";
import { useState } from "react";
import Link from "next/link";
import { ensureUser, supabaseBrowser } from "@/lib/supabase/client";
import { authorOf, byNew, byTop, useQuestions } from "@/lib/useQuestions";
import { qaError } from "@/lib/qaErrors";
import type { Question } from "@/lib/types";

export default function AskTheSpeaker({ eventId, signedIn, isTeam, displayName, slug }: { eventId: string; signedIn: boolean; isTeam: boolean; displayName: string; slug: string }) {
  // the same live list as the phone page: realtime filtered to this event, reloads gathered and spread out
  const { questions, myVotes, uid, reload } = useQuestions(eventId, { poll: false });
  const [body, setBody] = useState("");
  const [anon, setAnon] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [sort, setSort] = useState<"top" | "new">("top");
  const [err, setErr] = useState("");

  async function ask(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const sb = supabaseBrowser();
    let me: string;
    try { me = (await ensureUser()).id; } catch (x) { setErr(qaError(x)); return; }
    const named = !anon && (signedIn ? displayName : guestName).trim().slice(0, 60);
    // no automatic upvote of one's own question: the list counts other people's votes
    const { error } = await sb.from("questions").insert({ event_id: eventId, body: body.trim(), anonymous: !named, author_id: me, author_name: named || null });
    if (error) {
      // a signed-in account asks under its display name, so the fix is there, not in a name field
      setErr(error.code === "PT422" && signedIn && named
        ? "Your display name is reserved on this site. Change it on My events, or tick Ask anonymously."
        : qaError(error));
      return;
    }
    setBody(""); reload();
  }
  async function vote(q: Question) {
    let me = uid;
    if (!me) { try { me = (await ensureUser()).id; } catch (x) { setErr(qaError(x)); return; } }
    const sb = supabaseBrowser();
    const { error } = myVotes.has(q.id)
      ? await sb.from("question_votes").delete().eq("question_id", q.id).eq("user_id", me)
      : await sb.from("question_votes").insert({ question_id: q.id, user_id: me });
    setErr(error ? qaError(error) : "");
    reload();
  }
  const list = questions.filter((q) => q.status !== "hidden").sort(sort === "new" ? byNew : byTop);

  return (
    <div className="stack">
      <form className="row-flex" onSubmit={ask}>
        <input className="search" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Ask the Kleros speakers a question" maxLength={280} minLength={3} required aria-label="Your question" />
        {signedIn
          ? <label className="muted small"><input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} /> Ask anonymously</label>
          : <input className="search" style={{ flex: "0 1 160px" }} value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Your name (optional)" maxLength={40} aria-label="Your name" />}
        <button className="btn primary sm" type="submit">Ask</button>
      </form>
      {err && <div className="note">{err}</div>}
      <div className="row-flex">
        <div className="seg" role="group" aria-label="Sort"><button aria-pressed={sort === "top"} onClick={() => setSort("top")}>Top</button><button aria-pressed={sort === "new"} onClick={() => setSort("new")}>Newest</button></div>
        <Link className="btn sm ghost" href={`/q/${slug}`}>Ask from your phone</Link>
        {isTeam && <Link className="btn sm" href={`/events/${slug}/host`} style={{ marginLeft: "auto" }}>Moderate in host console</Link>}
      </div>
      {list.map((q) => (
        <div key={q.id} className={`q ${q.featured ? "feat" : ""} ${q.status === "answered" ? "done" : ""}`}>
          <button className={`vote ${myVotes.has(q.id) ? "on" : ""}`} onClick={() => vote(q)} aria-label="Upvote">▲<span>{q.votes}</span></button>
          <div style={{ minWidth: 0 }}>
            <div style={{ overflowWrap: "anywhere" }}>{q.body}</div>
            <div className="by">{authorOf(q)}{q.featured ? " · on screen" : ""}{q.status === "answered" ? " · answered" : ""}</div>
          </div>
        </div>
      ))}
      {!list.length && <p className="quiet-empty">No questions yet. Questions work during the talk and after it, and the speakers see them all.</p>}
    </div>
  );
}
