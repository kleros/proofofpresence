"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { screenOk, useQuestions } from "@/lib/useQuestions";
import ScreenView, { useQr } from "./ScreenView";
import { useScreenMode } from "./useScreenMode";

/** Track which question ids arrived after the first load, for a brief highlight. */
export function useFresh(ids: string[] | null, ms = 8000) {
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);
  const key = ids ? ids.join(",") : null;
  useEffect(() => {
    if (!ids) return; // not loaded yet: the first real list is the baseline, not "new"
    const now = new Set(ids);
    if (seen.current) {
      const added = [...now].filter((id) => !seen.current!.has(id));
      if (added.length) {
        setFresh((f) => new Set([...f, ...added]));
        setTimeout(() => setFresh((f) => { const n = new Set(f); added.forEach((id) => n.delete(id)); return n; }), ms);
      }
    }
    seen.current = now;
  }, [key, ms]);
  return fresh;
}

// The projector window: no controls. Double-click toggles full screen; the cursor hides when still.
export default function ScreenPage({ eventId, title, joinUrl }: { eventId: string; title: string; joinUrl: string }) {
  const { questions, reload, loaded } = useQuestions(eventId, { quick: true });
  const { mode } = useScreenMode(eventId, reload);
  const qr = useQr(joinUrl);
  // "new" means new to the screen: a question the host just approved counts too
  const fresh = useFresh(loaded ? questions.filter(screenOk).map((q) => q.id) : null);
  const [still, setStill] = useState(false);
  const [hint, setHint] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const poke = useCallback(() => {
    setStill(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStill(true), 2500);
  }, []);

  useEffect(() => {
    poke();
    const h = setTimeout(() => setHint(false), 4000);
    window.addEventListener("mousemove", poke);
    return () => { window.removeEventListener("mousemove", poke); clearTimeout(h); clearTimeout(timer.current); };
  }, [poke]);

  // keep the projector laptop awake
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const take = () => { if (document.visibilityState === "visible") navigator.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {}); };
    take();
    document.addEventListener("visibilitychange", take);
    return () => { document.removeEventListener("visibilitychange", take); lock?.release().catch(() => {}); };
  }, []);

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  return (
    <div className={`scr-page ${still ? "still" : ""}`} onDoubleClick={fullscreen}>
      <ScreenView title={title} joinUrl={joinUrl} qr={qr} mode={mode} questions={questions} fresh={fresh} />
      <div className={`scr-hint ${hint ? "" : "gone"}`} aria-hidden="true">Double-click for full screen</div>
    </div>
  );
}
