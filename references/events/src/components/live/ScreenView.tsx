"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { authorOf, byTop, screenOk } from "@/lib/useQuestions";
import type { Question } from "@/lib/types";
import type { ScreenMode } from "./useScreenMode";

export function useQr(url: string) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#17131F", light: "#FFFFFF" } })
      .then(setSvg).catch(() => setSvg(""));
  }, [url]);
  return svg;
}

export const shortUrl = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** The join link split into host and path, so it breaks cleanly on two lines. */
function Url({ url }: { url: string }) {
  const s = shortUrl(url);
  const i = s.indexOf("/");
  return <div className="scr-url">{i > 0 ? <><span>{s.slice(0, i)}</span><span>{s.slice(i)}</span></> : s}</div>;
}

const MAX = 5;

/**
 * What the projector shows: the featured question alone, or the top open ones (a fresh arrival always
 * gets a slot). Only questions the screen may show count: when the event asks for approval, the ones a
 * host approved (the database decides, in question_scores.screen_ok).
 */
export function pickForScreen(questions: Question[], fresh: Set<string>) {
  const open = questions.filter((q) => q.status === "open" && screenOk(q)).sort(byTop);
  const featured = open.find((q) => q.featured) ?? null;
  let list = open.slice(0, MAX);
  const newest = open.filter((q) => fresh.has(q.id) && !list.includes(q));
  if (newest.length) list = [...list.slice(0, MAX - Math.min(newest.length, 2)), ...newest.slice(0, 2)];
  return { featured, list, total: open.length };
}

/**
 * Projector layout. Sizes are in container units, so the same component renders the real
 * big screen and the small preview in the host console identically.
 */
export default function ScreenView({ title, joinUrl, qr, mode, questions, fresh, preview = false }: {
  title: string; joinUrl: string; qr: string; mode: ScreenMode; questions: Question[]; fresh: Set<string>; preview?: boolean;
}) {
  const { featured, list, total } = pickForScreen(questions, fresh);
  const join = shortUrl(joinUrl);

  if (mode === "blank") {
    return (
      <div className={`scr ${preview ? "scr-preview" : ""}`}>
        <div className="scr-in scr-blank">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/kleros-logo.svg" alt="Kleros" />
        </div>
      </div>
    );
  }

  if (mode === "join") {
    return (
      <div className={`scr ${preview ? "scr-preview" : ""}`}>
        <div className="scr-in scr-join">
          <div className="scr-join-text">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="scr-logo" src="/kleros-logo.svg" alt="Kleros" />
            <h1 className="scr-title">{title}</h1>
            <p className="scr-lead">Scan the code to ask the speakers a question and upvote the ones you want answered.</p>
            <Url url={joinUrl} />
          </div>
          <div className="scr-qr scr-qr-lg" dangerouslySetInnerHTML={{ __html: qr }} aria-label={`QR code for ${join}`} role="img" />
        </div>
      </div>
    );
  }

  const long = (s: string) => (s.length > 200 ? "xl" : s.length > 110 ? "l" : "");
  return (
    <div className={`scr ${preview ? "scr-preview" : ""}`}>
      <div className="scr-in scr-q">
        <div className="scr-main">
          <header className="scr-head">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="scr-logo" src="/kleros-logo.svg" alt="Kleros" />
            <h1 className="scr-title sm">{title}</h1>
          </header>

          {featured ? (
            <section className="scr-feat" key={featured.id}>
              <div className="scr-feat-in">
                <div className="scr-eyebrow">Question from the audience</div>
                <p className={`scr-big ${long(featured.body)}`}>{featured.body}</p>
                <div className="scr-by">{authorOf(featured)} · {featured.votes} {featured.votes === 1 ? "vote" : "votes"}</div>
              </div>
            </section>
          ) : list.length ? (
            <section className="scr-list-wrap">
              <div className="scr-eyebrow">Top questions{total > list.length ? ` · ${list.length} of ${total}` : ""}</div>
              <ol className="scr-list">
                {list.map((q) => (
                  <li key={q.id} className={fresh.has(q.id) ? "fresh" : ""}>
                    <span className="scr-votes"><b>{q.votes}</b><small>{q.votes === 1 ? "vote" : "votes"}</small></span>
                    <span className="scr-body">
                      <span className="scr-text">{q.body}</span>
                      <span className="scr-by">{authorOf(q)}{fresh.has(q.id) ? " · new" : ""}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : (
            <section className="scr-empty">
              <div className="scr-eyebrow">Questions for the speakers</div>
              <p>Scan the code to ask a question.</p>
            </section>
          )}
        </div>

        <aside className="scr-side">
          <div className="scr-qr" dangerouslySetInnerHTML={{ __html: qr }} aria-label={`QR code for ${join}`} role="img" />
          <div className="scr-side-t">Scan to ask and upvote</div>
          <Url url={joinUrl} />
        </aside>
      </div>
    </div>
  );
}
