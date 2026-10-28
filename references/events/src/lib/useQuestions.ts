"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "./supabase/client";
import type { Question } from "./types";

// Realtime changes are gathered before reloading: the first change starts a timer and every change
// until it fires rides along, so a burst of questions or votes costs each open page one reload. The
// random spread keeps a room full of phones from reloading in the same instant. The host console and
// the big screen wait less; the viewer's own question or vote reloads at once (reload()).
const WAIT_MS = { quick: [300, 700], relaxed: [1500, 3500] } as const;

// Live questions for one event, kept current over realtime, plus the viewer's own votes.
// `live` is false while the realtime channel is down; a slow poll keeps lists honest anyway.
// Votes reach the page through their question: since 0014 a vote touches questions.votes_changed_at,
// and realtime on questions is filtered to this event.
// `poll: false` for pages that are not used live (the event page), which skip the 15 s poll.
export function useQuestions(eventId: string, { quick = false, poll = true }: { quick?: boolean; poll?: boolean } = {}) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [myVotes, setMyVotes] = useState<Set<string>>(new Set());
  const [uid, setUid] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState(true);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const again = useRef(false);

  const load = useCallback(async () => {
    // coalesce bursts into at most one request in flight plus one queued
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    try {
      const sb = supabaseBrowser();
      const { data, error: e } = await sb.from("question_scores").select("*").eq("event_id", eventId);
      if (e) throw e;
      setQuestions((data ?? []) as Question[]);
      setError("");
      // the session kept in the browser: no request to the auth server on every reload
      const { data: s } = await sb.auth.getSession();
      const me = s.session?.user.id ?? null;
      setUid(me);
      if (me) {
        const { data: v } = await sb.from("question_votes").select("question_id").eq("user_id", me);
        setMyVotes(new Set((v ?? []).map((r: { question_id: string }) => r.question_id)));
      }
    } catch (e) {
      setError((e as Error).message || "Could not load questions");
    } finally {
      busy.current = false;
      setLoaded(true);
      if (again.current) { again.current = false; load(); }
    }
  }, [eventId]);

  useEffect(() => {
    load();
    const sb = supabaseBrowser();
    const [min, max] = WAIT_MS[quick ? "quick" : "relaxed"];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      if (timer !== undefined) return;
      timer = setTimeout(() => { timer = undefined; load(); }, min + Math.random() * (max - min));
    };
    const ch = sb.channel(`q-${eventId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "questions", filter: `event_id=eq.${eventId}` }, soon)
      // realtime reports a subscription it could not set up only as a system message, after SUBSCRIBED
      .on("system", {}, (m: { extension?: string; status?: string }) => {
        if (m.extension === "postgres_changes" && m.status === "error") setLive(false);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { setLive(true); load(); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setLive(false);
      });
    // realtime can drop on flaky venue wifi; a slow poll keeps the screen honest
    const t = poll ? setInterval(load, 15000) : undefined;
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    return () => { sb.removeChannel(ch); clearInterval(t); clearTimeout(timer); document.removeEventListener("visibilitychange", onFocus); };
  }, [eventId, load, quick, poll]);

  return { questions, myVotes, uid, loaded, live, error, reload: load };
}

export const byTop = (a: Question, b: Question) =>
  Number(a.status === "answered") - Number(b.status === "answered") || b.votes - a.votes || b.created_at.localeCompare(a.created_at);

export const byNew = (a: Question, b: Question) => b.created_at.localeCompare(a.created_at);

/**
 * The name to show. The database marks guests (no account) and team accounts, so a typed name
 * cannot pass as an account's, and only the team's own questions carry the team mark.
 */
export const authorOf = (q: Question) =>
  q.anonymous || !q.author_name ? "Anonymous"
    : q.guest ? `${q.author_name} (guest)`
      : q.team ? `${q.author_name} (Kleros team)` : q.author_name;

/** The big screen may show it (when open): approved, featured, or the event does not ask for approval. Always true before 0014. */
export const screenOk = (q: Question) => q.screen_ok !== false;

/** The host must approve it before the big screen shows it. */
export const awaitingApproval = (q: Question) => q.status === "open" && q.screen_ok === false;

export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
