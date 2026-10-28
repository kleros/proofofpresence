"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ago, authorOf, awaitingApproval, byNew, byTop } from "@/lib/useQuestions";
import type { Question } from "@/lib/types";
import { nudgeScreen } from "./useScreenMode";

type View = "open" | "answered" | "hidden";

export default function QuestionsPanel({ eventId, questions, loaded, live, error, reload, onFeatured, approval }: {
  eventId: string; questions: Question[]; loaded: boolean; live: boolean; error: string;
  reload: () => void; onFeatured: () => void;
  /** the big screen shows only approved questions */
  approval: boolean;
}) {
  const [view, setView] = useState<View>("open");
  const [sort, setSort] = useState<"top" | "new">("top");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const count = (v: View) => questions.filter((q) => q.status === v).length;
  const waiting = questions.filter(awaitingApproval).length;
  const featured = questions.find((q) => q.featured && q.status === "open") ?? null;
  const list = questions
    .filter((q) => q.status === view && !(view === "open" && q === featured))
    .sort(sort === "top" ? byTop : byNew);

  async function moderate(q: Question, patch: Partial<Pick<Question, "status" | "featured" | "approved">>) {
    setErr(""); setBusy(q.id);
    const sb = supabaseBrowser();
    try {
      if (patch.approved !== undefined) {
        // lets it into the big screen list (or out of it); the database works out what the screen may show
        const { error: e } = await sb.from("questions").update({ approved_at: patch.approved ? new Date().toISOString() : null }).eq("id", q.id);
        if (e) throw e;
      } else if (patch.featured !== undefined && patch.status === undefined) {
        // one atomic call: takes any other question off the big screen in the same transaction
        const { error: e } = await sb.rpc("feature_question", { p_question: q.id, p_on: patch.featured });
        if (e) throw e;
      } else {
        if (patch.status && patch.status !== "open") patch = { ...patch, featured: false };
        const { error: e } = await sb.from("questions").update(patch).eq("id", q.id);
        if (e) throw e;
      }
      if (patch.featured) onFeatured();
      nudgeScreen(eventId, { type: "questions" });
    } catch (e) { setErr(`That change did not go through: ${(e as Error).message}`); }
    setBusy("");
    reload();
  }

  const empty = {
    open: { b: "No open questions yet", t: "Questions sent from phones appear here as they arrive." },
    answered: { b: "Nothing marked answered", t: "Questions marked answered move here and leave the big screen." },
    hidden: { b: "Nothing hidden", t: "Hidden questions are kept here, out of public view, and can be restored." },
  }[view];

  return (
    <section className="con-panel qp" aria-labelledby="qp-h">
      <div className="con-panel-h">
        <h2 id="qp-h">Questions</h2>
        <span className={`con-live ${live ? "" : "off"}`} title={live ? "Updates arrive instantly" : "Live updates paused; refreshing every 15 seconds"}>
          <span className="pip" />{live ? "Live" : "Reconnecting"}
        </span>
      </div>

      <div className="qp-tools">
        <div className="seg" role="group" aria-label="Which questions">
          {(["open", "answered", "hidden"] as View[]).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
              {v[0].toUpperCase() + v.slice(1)} <span className="qp-n">{count(v)}</span>
            </button>
          ))}
        </div>
        <div className="seg sm" role="group" aria-label="Sort">
          <button aria-pressed={sort === "top"} onClick={() => setSort("top")}>Top</button>
          <button aria-pressed={sort === "new"} onClick={() => setSort("new")}>New</button>
        </div>
      </div>

      {(err || error) && <div className="note" role="alert">{err || `Questions could not be loaded: ${error}`}</div>}
      {approval && waiting > 0 && (
        <p className="muted small qp-wait" role="status">{waiting} {waiting === 1 ? "question is" : "questions are"} waiting for approval before the big screen can show {waiting === 1 ? "it" : "them"}.</p>
      )}

      <div className="qp-list">
        {view === "open" && featured && (
          <article className="qp-item is-feat">
            <div className="qp-feat-label"><span className="pip" /> On the big screen</div>
            <div className="qp-row">
              <span className="qp-votes" aria-label={`${featured.votes} votes`}>{featured.votes}</span>
              <div className="qp-body">
                <p>{featured.body}</p>
                <div className="qp-meta">{authorOf(featured)} · {ago(featured.created_at, now)}</div>
              </div>
            </div>
            <div className="qp-acts">
              <button className="btn sm primary" disabled={busy === featured.id} onClick={() => moderate(featured, { featured: false })}>Take off screen</button>
              <button className="btn sm" disabled={busy === featured.id} onClick={() => moderate(featured, { status: "answered" })}>Mark answered</button>
            </div>
          </article>
        )}

        {list.map((q) => {
          const wait = awaitingApproval(q);
          return (
          <article key={q.id} className={`qp-item ${wait ? "is-waiting" : ""}`}>
            <div className="qp-row">
              <span className="qp-votes" aria-label={`${q.votes} votes`}>{q.votes}</span>
              <div className="qp-body">
                <p>{q.body}</p>
                <div className="qp-meta">{authorOf(q)} · {ago(q.created_at, now)}{wait && <span className="qp-wait"> · waiting for approval</span>}</div>
              </div>
            </div>
            <div className="qp-acts">
              {view === "open" && (
                <>
                  {wait && <button className="btn sm primary" disabled={busy === q.id} onClick={() => moderate(q, { approved: true })}
                    title="Lets the big screen list show it">Approve</button>}
                  {approval && !wait && q.approved && <button className="btn sm ghost" disabled={busy === q.id} onClick={() => moderate(q, { approved: false })}
                    title="Takes it out of the big screen list">Unapprove</button>}
                  <button className="btn sm" disabled={busy === q.id} onClick={() => moderate(q, { featured: true })}>Show on big screen</button>
                  <button className="btn sm" disabled={busy === q.id} onClick={() => moderate(q, { status: "answered" })}>Mark answered</button>
                  <button className="btn sm ghost" disabled={busy === q.id} onClick={() => moderate(q, { status: "hidden" })}>Hide</button>
                </>
              )}
              {view === "answered" && (
                <>
                  <button className="btn sm" disabled={busy === q.id} onClick={() => moderate(q, { status: "open" })}>Reopen</button>
                  <button className="btn sm ghost" disabled={busy === q.id} onClick={() => moderate(q, { status: "hidden" })}>Hide</button>
                </>
              )}
              {view === "hidden" && <button className="btn sm" disabled={busy === q.id} onClick={() => moderate(q, { status: "open" })}>Restore</button>}
            </div>
          </article>
          );
        })}

        {loaded && !list.length && !(view === "open" && featured) && (
          <div className="empty con-empty"><b>{empty.b}</b>{empty.t}</div>
        )}
        {!loaded && <div className="muted small qp-loading">Loading questions…</div>}
      </div>
    </section>
  );
}
