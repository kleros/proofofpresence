"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AnswerText, { normalUrl } from "./AnswerText";

// error and stopped turns are shown but never sent back as history
interface Turn { role: "user" | "assistant"; content: string; sources?: { href: string; label: string }[]; links?: string[]; error?: boolean; stopped?: boolean }
type AskEvent =
  | { t: "status"; text: string } | { t: "delta"; text: string } | { t: "retract" }
  | { t: "sources"; items: { href: string; label: string }[]; links?: string[] } | { t: "error"; text: string } | { t: "done" };

// the projector, host console and phone question pages stay clean
const HIDDEN = /^\/(q\/|events\/[^/]+\/(screen|host|live)(\/|$))/;
const STORE = "kleros-ask";

function suggestions(path: string) {
  if (/^\/talks\/[0-9a-f-]{36}/i.test(path)) return ["Summarize this recording", "List the action items from this recording", "What questions came up?"];
  if (/^\/events\/[^/]+$/.test(path)) return ["What happened at this event?", "Which talks were given here?", "Who from Kleros is going?"];
  return ["Which events are coming up?", "Which talks covered AI agents?", "Where will Kleros be next month?"];
}

/**
 * The floating "Ask" button and its chat panel, on every page. Answers stream from /api/ask,
 * which looks things up with the visitor's own access. The conversation survives moving between
 * pages (and a reload, within the tab), and belongs to one account: signing out or switching
 * accounts starts a new one, so nobody sees answers drawn from someone else's access.
 */
export default function AskWidget({ enabled, signedIn, account, note }: {
  enabled: boolean; signedIn: boolean; account: string;
  /** for the team, while only the team can ask: what is missing */
  note?: string;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  // what screen readers hear: the status while answering, then one line when the answer is in
  const [said, setSaid] = useState("");
  const abort = useRef<AbortController | null>(null);
  const fab = useRef<HTMLButtonElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
  const stopper = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const key = `${STORE}:${account}`;
  const current = useRef(key);
  const [loaded, setLoaded] = useState("");

  // keep this account's conversation for the tab, and drop any other account's
  useEffect(() => {
    current.current = key;
    abort.current?.abort();
    let saved: Turn[] = [];
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(STORE) && k !== key) sessionStorage.removeItem(k);
      }
      const s = sessionStorage.getItem(key);
      if (s) saved = JSON.parse(s) as Turn[];
    } catch { /* storage off */ }
    setTurns(Array.isArray(saved) ? saved : []); setDraft(""); setStatus(""); setBusy(false);
    setLoaded(key);
  }, [key]);
  useEffect(() => {
    if (loaded !== key) return;
    try { sessionStorage.setItem(key, JSON.stringify(turns.slice(-30))); } catch { /* storage off */ }
  }, [turns, loaded, key]);
  // external addresses the site's data gave during this conversation
  const links = useMemo(() => new Set(turns.flatMap((t) => (t.links ?? []).map(normalUrl).filter((u): u is string => !!u))), [turns]);
  // focus moves into the panel when it opens and back to the button when it closes
  useEffect(() => {
    if (open) { const id = setTimeout(() => (box.current && !box.current.disabled ? box.current : closer.current)?.focus(), 30); return () => clearTimeout(id); }
    if (returnFocus.current) {
      returnFocus.current = false;
      // the button is hidden while the recorder's action bar is up: go to that bar instead
      const f = fab.current;
      if (f?.getClientRects().length) f.focus();
      else document.querySelector<HTMLElement>(".rec-actions button:not(:disabled)")?.focus();
    }
  }, [open]);
  // a reopened panel starts at the latest message too
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [turns, draft, status, open]);
  const close = () => { returnFocus.current = true; setOpen(false); };

  if (HIDDEN.test(path)) return null;

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy || !enabled) return;
    // a question goes back only with the answer it got; a stopped or failed one is left out
    const kept = (a?: Turn) => a?.role === "assistant" && !a.error && !a.stopped;
    const history = [...turns.filter((t, i) => (t.role === "assistant" ? kept(t) : kept(turns[i + 1]))), { role: "user" as const, content: question }];
    setTurns((t) => [...t, { role: "user", content: question }]);
    // a suggestion chip leaves what was typed in the box
    if (q === input) setInput("");
    setDraft(""); setStatus("Thinking…"); setSaid(""); setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    const mine = key;
    let text = "", sources: Turn["sources"] = [], links: string[] = [], error = "", ended = false, complete = false;
    try {
      const res = await fetch("/api/ask", {
        method: "POST", headers: { "content-type": "application/json" }, signal: ctl.signal,
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })), page: path }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        error = j.error || "The assistant could not answer. Try again in a moment.";
        ended = true;
      }
      const reader = ended ? null : res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (reader) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          let e: AskEvent;
          try { e = JSON.parse(line) as AskEvent; } catch { continue; }
          if (e.t === "delta") { text += e.text; setDraft(text); setStatus(""); }
          else if (e.t === "retract") { text = ""; setDraft(""); }
          else if (e.t === "status") setStatus(e.text);
          else if (e.t === "sources") { sources = e.items; links = e.links ?? []; }
          else if (e.t === "error") { error = e.text; ended = true; }
          else if (e.t === "done") { ended = true; complete = true; }
        }
      }
    } catch {
      if (!ctl.signal.aborted && !ended) { error = "The connection dropped before the answer was finished. Try again."; ended = true; }
    }
    // the stream stopped without saying it was finished (the host cut it off)
    if (!ended && !ctl.signal.aborted) error = "The answer was interrupted before it finished. Try again.";
    // the account changed while this was answering: the answer belongs to the old one
    if (current.current !== mine) return;
    const answer = text.trim();
    const stopped = ctl.signal.aborted;
    setTurns((t) => [
      ...t,
      // an answer that never reached "done" (stopped, cut off or dropped) is marked, so it is not sent back as history
      ...(answer ? [{ role: "assistant" as const, content: answer, sources, links, ...(!complete ? { stopped: true } : {}) }] : []),
      ...(error ? [{ role: "assistant" as const, content: error, error: true }] : []),
      ...(!answer && !error && ctl.signal.aborted ? [{ role: "assistant" as const, content: "Stopped.", error: true }] : []),
    ]);
    // Stop turns back into the disabled Ask button: keep keyboard focus in the panel
    if (document.activeElement === stopper.current) box.current?.focus();
    setDraft(""); setStatus(""); setBusy(false);
    setSaid(error || (stopped ? "Stopped." : "Answer ready."));
    abort.current = null;
  }

  return (
    <>
      {!open && (
        <button type="button" ref={fab} className="ask-fab" onClick={() => setOpen(true)} aria-label="Ask about Kleros events">
          <span aria-hidden>✦</span> Ask
        </button>
      )}
      {open && (
        <section className="ask-panel" role="dialog" aria-label="Ask about Kleros events"
          onKeyDown={(e) => {
            // Escape closes the panel only while focus is in it, and not while typing with an IME
            if (e.key !== "Escape" || e.defaultPrevented || e.nativeEvent.isComposing || e.keyCode === 229) return;
            e.stopPropagation(); close();
          }}>
          <header className="ask-head">
            <div>
              <b>Ask Kleros Events</b>
              <span className="muted small">Answers come from this site</span>
            </div>
            <div className="row-flex">
              {turns.length > 0 && !busy && <button type="button" className="btn sm ghost" onClick={() => { setTurns([]); setDraft(""); box.current?.focus(); }}>New</button>}
              <button type="button" ref={closer} className="btn sm ghost" onClick={close} aria-label="Close">✕</button>
            </div>
          </header>

          <p className="ask-sr" role="status">{busy ? status : said}</p>
          <div className="ask-log" ref={log} onClick={(e) => {
            // on a phone the panel covers the page: close it when a link in it was followed
            if (e.defaultPrevented && (e.target as Element).closest("a") && window.matchMedia("(max-width: 560px)").matches) close();
          }}>
            {!enabled ? (
              <div className="note small">
                The assistant is not switched on yet. An admin adds an Anthropic key as ANTHROPIC_API_KEY to the site&apos;s environment variables (on Vercel or Netlify) and redeploys. Only the team sees this button until then. To open it to everyone else, the site also needs SUPABASE_SERVICE_ROLE_KEY and migration 0014_security.sql (see the README, under Site assistant).
              </div>
            ) : turns.length === 0 && !busy ? (
              <div className="ask-empty">
                {note && <div className="note small">{note}</div>}
                <p className="muted small">Ask about Kleros events, talks and recordings. {signedIn ? "Answers include everything your account can see." : "Answers cover what is public on this site."}</p>
                <div className="ask-chips">
                  {suggestions(path).map((s) => <button key={s} type="button" className="ask-chip" onClick={(e) => {
                    // keep keyboard focus in the panel, but don't pop up a phone's keyboard over the answer
                    if (e.detail === 0 || !window.matchMedia("(pointer: coarse)").matches) box.current?.focus();
                    send(s);
                  }}>{s}</button>)}
                </div>
              </div>
            ) : null}
            {turns.map((t, i) => (
              <div key={i} className={`ask-msg ${t.role}${t.error ? " err" : ""}`}>
                {t.role === "assistant" && !t.error ? <AnswerText text={t.content} links={links} /> : <p>{t.content}</p>}
                {t.stopped && <p className="muted small">This answer did not finish.</p>}
                {t.sources && t.sources.length > 0 && (
                  <div className="ask-sources">
                    {t.sources.map((s) => <Link key={s.href} href={s.href} className="ask-source">{s.label}</Link>)}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              // the half-written answer is not read out or focusable; the status line above is read
              <div className="ask-msg assistant" inert>
                {draft ? <AnswerText text={draft} links={links} /> : null}
                {status && <p className="ask-status muted small"><span className="ask-dots" aria-hidden />{status}</p>}
              </div>
            )}
          </div>

          <form className="ask-form" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <textarea ref={box} value={input} rows={1} maxLength={2000} disabled={!enabled}
              placeholder={enabled ? "Ask a question" : "Not switched on yet"} aria-label="Your question"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); send(input); } }} />
            {busy
              ? <button type="button" ref={stopper} className="btn sm" onClick={(e) => {
                // the second click of a double-click on Ask lands here: ignore it
                if (e.detail > 1) return;
                abort.current?.abort();
              }}>Stop</button>
              : <button type="submit" className="btn sm primary" disabled={!enabled || !input.trim()}>Ask</button>}
          </form>
          <p className="ask-foot muted">Answers can be wrong. Check the linked pages. Not legal or financial advice.</p>
        </section>
      )}
    </>
  );
}
