"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export type ScreenMode = "questions" | "join" | "blank";
export const SCREEN_MODES: { id: ScreenMode; label: string }[] = [
  { id: "questions", label: "Questions" },
  { id: "join", label: "Join code only" },
  { id: "blank", label: "Blank (logo)" },
];

type Msg = { type: "mode"; mode: ScreenMode } | { type: "questions" };

// Same-laptop fast path: the host console and the big screen window usually run in the
// same browser, so a BroadcastChannel updates the projector instantly even without wifi.
function channel(eventId: string) {
  return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(`kleros-live-${eventId}`);
}

export function nudgeScreen(eventId: string, msg: Msg) {
  const c = channel(eventId);
  if (!c) return;
  c.postMessage(msg);
  c.close();
}

type LiveRow = { screen_mode?: ScreenMode; screen_needs_approval?: boolean };

/**
 * The big screen mode for one event, stored in live_state and kept in sync over realtime,
 * a BroadcastChannel and a 15 s poll. `setMode` is for the host console (team only by RLS).
 * `approval`: the screen shows only questions a host approved (live_state.screen_needs_approval,
 * 0014). An event with no live_state row yet gets the column default, true. Switching it changes
 * which questions question_scores lets on the screen, so the questions reload too.
 * `approvalSupported` is false until migration 0014 has run; the console then hides the switch.
 */
export function useScreenMode(eventId: string, onQuestionsNudge?: () => void) {
  const [mode, setLocal] = useState<ScreenMode>("questions");
  const [approval, setApprovalState] = useState(true);
  const [approvalSupported, setApprovalSupported] = useState(false);
  const approvalNow = useRef(true);
  const setApprovalLocal = useCallback((on: boolean) => { approvalNow.current = on; setApprovalState(on); }, []);
  const [live, setLive] = useState(true);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const nudge = useRef(onQuestionsNudge);
  nudge.current = onQuestionsNudge;

  const load = useCallback(async () => {
    if (pending.current) return;
    const sb = supabaseBrowser();
    let supported = true;
    let res = await sb.from("live_state").select("screen_mode, screen_needs_approval").eq("event_id", eventId).maybeSingle();
    // 42703: no such column, migration 0014 has not run (the answer is the same with no row yet)
    if (res.error?.code === "42703") {
      supported = false;
      res = await sb.from("live_state").select("screen_mode").eq("event_id", eventId).maybeSingle();
    }
    if (res.error) { setError(res.error.message); return; }
    setError("");
    const row = res.data as LiveRow | null;
    if (pending.current) return;
    if (row?.screen_mode) setLocal(row.screen_mode);
    setApprovalSupported(supported);
    setApprovalLocal(supported ? row?.screen_needs_approval ?? true : false);
  }, [eventId, setApprovalLocal]);

  useEffect(() => {
    load();
    const sb = supabaseBrowser();
    const ch = sb.channel(`live-${eventId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_state", filter: `event_id=eq.${eventId}` }, (p) => {
        const row = p.new as LiveRow | null;
        if (!row || pending.current) return;
        if (row.screen_mode) setLocal(row.screen_mode);
        if (typeof row.screen_needs_approval === "boolean" && row.screen_needs_approval !== approvalNow.current) {
          setApprovalLocal(row.screen_needs_approval);
          nudge.current?.();
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { setLive(true); load(); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setLive(false);
      });
    const bc = channel(eventId);
    if (bc) bc.onmessage = (e: MessageEvent<Msg>) => {
      if (e.data?.type === "mode") setLocal(e.data.mode);
      if (e.data?.type === "questions") nudge.current?.();
    };
    const t = setInterval(load, 15000);
    return () => { sb.removeChannel(ch); bc?.close(); clearInterval(t); };
  }, [eventId, load]);

  const setMode = useCallback(async (m: ScreenMode) => {
    setLocal(m);
    nudgeScreen(eventId, { type: "mode", mode: m });
    pending.current = true;
    const { error: e } = await supabaseBrowser().from("live_state")
      .upsert({ event_id: eventId, screen_mode: m, updated_at: new Date().toISOString() }, { onConflict: "event_id" });
    pending.current = false;
    if (e) {
      setError(/live_state/.test(e.message) && /exist|schema cache/i.test(e.message)
        ? "The database is missing the live_state table (migration 0004_live.sql). The screen on this laptop still follows the toggle; other devices will not."
        : `Could not save the screen mode: ${e.message}`);
    } else setError("");
  }, [eventId]);

  const setApproval = useCallback(async (on: boolean) => {
    setApprovalLocal(on);
    pending.current = true;
    const { error: e } = await supabaseBrowser().from("live_state")
      .upsert({ event_id: eventId, screen_needs_approval: on, updated_at: new Date().toISOString() }, { onConflict: "event_id" });
    pending.current = false;
    if (e) {
      setApprovalLocal(!on);
      setError(/screen_needs_approval/.test(e.message)
        ? "The database is missing the approval setting (migration 0014_security.sql)."
        : `Could not save the approval setting: ${e.message}`);
      return;
    }
    setError("");
    nudge.current?.();
    nudgeScreen(eventId, { type: "questions" });
  }, [eventId, setApprovalLocal]);

  return { mode, setMode, approval, approvalSupported, setApproval, live, error };
}
