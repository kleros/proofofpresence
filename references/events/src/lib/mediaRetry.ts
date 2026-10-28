// Players read files through /f/, which answers with a signed address that lasts 6 hours. A player
// left open longer than that gets a network error on its next range request; it asks /f/ again.

/** Remembers whether the player was meant to be playing: Chromium reports paused by the time "error" fires. */
export function trackPlaying(m: HTMLMediaElement) {
  if (m.dataset.tracked) return;
  m.dataset.tracked = "1";
  m.addEventListener("play", () => { m.dataset.playing = "1"; });
  m.addEventListener("pause", () => { delete m.dataset.playing; });
  m.addEventListener("ended", () => { delete m.dataset.playing; });
}

/**
 * On a network error (what an expired signed address gives), loads the file again, at most once a
 * minute, and goes back to the same moment. A WebM recording gets its duration first, so the
 * players' own duration fix finishes before the jump back.
 */
export function retryMedia(m: HTMLMediaElement) {
  const src = m.getAttribute("src") ?? "";
  if (!src.startsWith("/f/") || m.error?.code !== MediaError.MEDIA_ERR_NETWORK) return;
  if (Date.now() - Number(m.dataset.retriedAt || 0) < 60_000) return;
  m.dataset.retriedAt = String(Date.now());
  const at = m.currentTime;
  const playing = !m.paused || m.dataset.playing === "1";
  const resume = () => {
    if (at) m.currentTime = at;
    if (playing) m.play().catch(() => {});
  };
  m.addEventListener("loadedmetadata", () => {
    if (isFinite(m.duration)) { resume(); return; }
    const once = () => { if (!isFinite(m.duration)) return; m.removeEventListener("durationchange", once); resume(); };
    m.addEventListener("durationchange", once);
  }, { once: true });
  m.src = `${src.split("?")[0]}?r=${Date.now()}`;
}
