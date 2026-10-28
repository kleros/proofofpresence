"use client";
// Players that report their time to the transcript and accept seek requests from it.
import { useEffect, useRef } from "react";
import { emitTime, onSeek } from "@/lib/transcript/client";
import { retryMedia, trackPlaying } from "@/lib/mediaRetry";

/** Native audio or video element, wired to the transcript. Fixes the missing duration of MediaRecorder WebM. */
export function MediaPlayer({ src, kind, title }: { src: string; kind: "audio" | "video"; title: string }) {
  const el = useRef<HTMLMediaElement | null>(null);
  const fixing = useRef<(() => void) | null>(null);
  // the moment a transcript line asked for, which the fix goes back to if the jump came before it
  const sought = useRef<number | null>(null);
  // WebM from MediaRecorder has no duration until the browser has seen its end once
  const fixDuration = (m: HTMLMediaElement) => {
    if (fixing.current || isFinite(m.duration)) return;
    const at = m.currentTime;
    const fix = () => { if (!isFinite(m.duration)) return; endFix(m); m.currentTime = sought.current ?? at; };
    fixing.current = fix;
    m.addEventListener("durationchange", fix);
    m.currentTime = 1e101;
  };
  const endFix = (m: HTMLMediaElement) => {
    if (fixing.current) m.removeEventListener("durationchange", fixing.current);
    fixing.current = null;
  };
  // a server-rendered element can load its metadata before React listens for it; one already
  // playing (started before the page's script loaded) is left alone
  useEffect(() => { const m = el.current; if (m && m.readyState >= HTMLMediaElement.HAVE_METADATA && m.paused) fixDuration(m); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onSeek((t) => {
    const m = el.current; if (!m) return false;
    // a jump asked for now wins over the duration fix still running
    sought.current = t;
    endFix(m);
    m.currentTime = t;
    m.play().catch(() => {});
  }), []);
  const common = {
    src, preload: "metadata" as const, controls: true, "aria-label": title,
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => fixDuration(e.currentTarget),
    // the signed file address expired (a long pause): fetch a fresh one
    onError: (e: React.SyntheticEvent<HTMLMediaElement>) => retryMedia(e.currentTarget),
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => { if (!fixing.current) emitTime(e.currentTarget.currentTime, !e.currentTarget.paused); },
    onPlay: (e: React.SyntheticEvent<HTMLMediaElement>) => emitTime(e.currentTarget.currentTime, true),
    onPause: (e: React.SyntheticEvent<HTMLMediaElement>) => emitTime(e.currentTarget.currentTime, false),
  };
  return kind === "video"
    ? <div className="video" data-player><video ref={(n) => { el.current = n; if (n) trackPlaying(n); }} {...common} /></div>
    : <div className="tx-audio" data-player><audio ref={(n) => { el.current = n; if (n) trackPlaying(n); }} {...common} /></div>;
}

// ---------------------------------------------------------------- YouTube

interface YTPlayer { seekTo(t: number, allow: boolean): void; playVideo(): void; getCurrentTime(): number; getPlayerState(): number; destroy(): void }
declare global {
  interface Window { YT?: { Player: new (el: HTMLElement | string, opts: unknown) => YTPlayer }; onYouTubeIframeAPIReady?: () => void }
}

let apiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => { apiPromise = null; reject(new Error("YouTube player API did not load")); };
    document.head.appendChild(s);
  });
  return apiPromise;
}

/**
 * YouTube embed controlled through the IFrame API, so transcript lines can seek it. If the
 * API cannot load (blocked by an extension, offline), the plain embed still plays.
 */
export function YouTubePlayer({ id, title }: { id: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const player = useRef<YTPlayer | null>(null);
  // a seek asked for before the player is ready (the API loads after the page), applied on ready
  const ready = useRef(false);
  const failed = useRef(false);
  const wanted = useRef<number | null>(null);
  useEffect(() => {
    let alive = true;
    let poll: ReturnType<typeof setInterval> | undefined;
    loadYouTubeApi().then(() => {
      if (!alive || !frame.current || !window.YT) return;
      player.current = new window.YT.Player(frame.current, {
        events: {
          onReady: () => {
            ready.current = true;
            const t = wanted.current; wanted.current = null;
            if (t !== null && player.current) { player.current.seekTo(t, true); player.current.playVideo(); }
          },
          onStateChange: (e: { data: number }) => {
            const p = player.current; if (!p) return;
            emitTime(p.getCurrentTime(), e.data === 1);
            clearInterval(poll);
            if (e.data === 1) poll = setInterval(() => player.current && emitTime(player.current.getCurrentTime(), true), 500);
          },
        },
      });
    }).catch(() => { failed.current = true; /* plain embed keeps working, but cannot be told to jump */ });
    const off = onSeek((t) => {
      if (failed.current) return false;
      const p = player.current;
      if (!p || !ready.current) { wanted.current = t; return; }
      p.seekTo(t, true); p.playVideo();
    });
    return () => { alive = false; off(); clearInterval(poll); };
  }, []);
  return (
    <div className="video" data-player>
      <iframe ref={frame} src={`https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&rel=0`} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen title={title} />
    </div>
  );
}
