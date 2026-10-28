"use client";
import Link from "next/link";
import { seekTo } from "@/lib/transcript/client";

/**
 * The few bits of Markdown the assistant writes (paragraphs, bullet and numbered lists, short
 * headings, bold, links), rendered as elements: nothing it writes is ever injected as HTML.
 * A link to a moment of the talk already open (/talks/id?t=754) seeks the player instead of
 * reloading the page. An external address becomes a link only when the site's own data gave it
 * (`links`), and shows its host, so words read from a transcript cannot dress up an outside link.
 */
export default function AnswerText({ text, links }: { text: string; links: ReadonlySet<string> }) {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => { if (para.length) blocks.push(<p key={blocks.length}>{para.map((l, i) => <span key={i}>{i > 0 && <br />}<Inline text={l} links={links} /></span>)}</p>); para = []; };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}><Inline text={it} links={links} /></li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const head = line.match(/^\s*#{1,4}\s+(.*)$/);
    if (bullet || num) {
      flushPara();
      const ordered = !!num;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? num)![1]);
    } else if (head) {
      flushPara(); flushList();
      blocks.push(<h4 key={blocks.length}><Inline text={head[1].replace(/\*\*/g, "")} links={links} /></h4>);
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else if (list && /^\s{2,}\S/.test(raw)) {
      // a wrapped list item
      list.items[list.items.length - 1] += " " + line.trim();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara(); flushList();
  return <div className="ask-md">{blocks}</div>;
}

const TOKEN = /(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s)<>\]]+)/g;

function Inline({ text, links }: { text: string; links: ReadonlySet<string> }) {
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > at) out.push(text.slice(at, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<b key={m.index}>{tok.slice(2, -2)}</b>);
    else if (tok.startsWith("[")) {
      const [, label, href] = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      out.push(<SafeLink key={m.index} href={href} links={links} labelled>{label}</SafeLink>);
    } else out.push(<SafeLink key={m.index} href={tok} links={links}>{tok.replace(/^https?:\/\/(www\.)?/, "")}</SafeLink>);
    at = m.index! + tok.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

/** the form an address is compared in, or null when it is not a web address */
export function normalUrl(href: string) {
  try { const u = new URL(href); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; }
}

function SafeLink({ href, links, labelled, children }: { href: string; links: ReadonlySet<string>; labelled?: boolean; children: React.ReactNode }) {
  // site paths only: "//host" and "/\host" would leave the site
  if (/^\/(?![/\\])/.test(href) && !href.includes("\\")) {
    const u = new URL(href, "https://x.invalid");
    const t = Number(u.searchParams.get("t"));
    const seekable = u.pathname.startsWith("/talks/") && u.searchParams.has("t") && Number.isFinite(t) && t >= 0;
    // decided on click (the address bar is only current by then); a new-tab click, or a page whose
    // player cannot jump, follows the link as usual
    return (
      <Link href={href} onClick={(e) => {
        if (!seekable || u.pathname !== window.location.pathname) return;
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (seekTo(t)) e.preventDefault();
      }}>{children}</Link>
    );
  }
  const url = normalUrl(href);
  if (url && links.has(url)) {
    const host = new URL(url).host.replace(/^www\./, "");
    return <><a href={url} target="_blank" rel="noopener noreferrer nofollow">{children}</a>{labelled && <span className="muted"> ({host})</span>}</>;
  }
  return <>{children}</>;
}
