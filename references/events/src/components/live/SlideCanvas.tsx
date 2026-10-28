"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PdfDoc } from "@/lib/pdf";

/** One PDF page, drawn to fit its box at device resolution. */
export default function SlideCanvas({ pdf, page, className = "" }: { pdf: PdfDoc; page: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const seq = useRef(0);
  const [err, setErr] = useState(false);

  const draw = useCallback(async () => {
    if (!box.current || !canvas.current) return;
    const n = ++seq.current;
    try {
      const pg = await pdf.getPage(page);
      if (n !== seq.current || !box.current || !canvas.current) return;
      const dpr = window.devicePixelRatio || 1;
      const v0 = pg.getViewport({ scale: 1 });
      const w = box.current.clientWidth, h = box.current.clientHeight;
      const scale = Math.min(w / v0.width, h / v0.height) * dpr;
      const vp = pg.getViewport({ scale });
      const off = document.createElement("canvas");
      off.width = Math.floor(vp.width); off.height = Math.floor(vp.height);
      await pg.render({ canvasContext: off.getContext("2d")!, viewport: vp }).promise;
      if (n !== seq.current || !canvas.current) return;
      // draw off-screen first, then swap, so clicking fast through slides never flashes blank
      const c = canvas.current;
      c.width = off.width; c.height = off.height;
      c.style.width = `${off.width / dpr}px`; c.style.height = `${off.height / dpr}px`;
      c.getContext("2d")!.drawImage(off, 0, 0);
      setErr(false);
    } catch { if (n === seq.current) setErr(true); }
  }, [pdf, page]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    if (!box.current || typeof ResizeObserver === "undefined") return;
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(draw, 120); });
    ro.observe(box.current);
    return () => { ro.disconnect(); clearTimeout(t); };
  }, [draw]);

  return (
    <div className={`slide-box ${className}`} ref={box}>
      <canvas ref={canvas} aria-label={`Slide ${page}`} />
      {err && <div className="slide-err">Slide {page} could not be drawn.</div>}
    </div>
  );
}
