import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";

/**
 * GET /f/<path>: a file from the private materials bucket.
 *
 * Asks storage for a signed address with the visitor's own session and redirects to it. Storage
 * signs only a file the select policy on storage.objects lets this visitor see (0010, 0012, 0014), so
 * a private event's files stay with its members and a removed item's file stops opening. The bytes
 * come from the storage address, never from this site, so range requests (audio and video seeking,
 * pdf.js) are answered by storage, and an uploaded HTML or SVG file never runs on the site's origin.
 */
export const dynamic = "force-dynamic";

// How long a signed address works. A recording that is playing keeps reading from the signed
// address (Chrome does not come back to /f/ for the next part), so this covers a long talk that is
// paused and resumed. The redirect itself is kept for a few minutes, by this browser only.
const SIGNED_FOR = 6 * 60 * 60;
const REDIRECT_KEPT = 5 * 60;

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const name = path.join("/");
  // Check the joined name, not Next's segments: a segment can hold a decoded "/" (from %2F), and
  // storage-js puts the name into the storage URL unencoded, where "..", "%2e%2e" and the like
  // would climb out of /object/sign/ to any endpoint of the Supabase project, sent with the
  // visitor's own token. Paths made by uploadToStorage never contain "%".
  if (!supabaseConfigured || !name || name.length > 1024
      || name.split("/").some((s) => !s.trim() || s.trim() === "." || s.trim() === ".." || /[\x00-\x1f\x7f\\?#%]/.test(s))) {
    return notFound(req, name);
  }
  let signed: string | undefined;
  try {
    const sb = await supabaseServer();
    const { data, error } = await sb.storage.from("materials").createSignedUrl(name, SIGNED_FOR);
    // storage answers 400 for a file that does not exist or that this visitor may not see, and
    // 5xx (or nothing, a network error) when it is down: only the first is a "not found"
    if (error) return error.status && error.status < 500 ? notFound(req, name) : unavailable();
    signed = data.signedUrl;
  } catch {
    return unavailable();
  }
  if (!signed) return notFound(req, name);
  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: signed,
      "Cache-Control": `private, max-age=${REDIRECT_KEPT}`,
      // signing in or out (or a refreshed session) changes the cookies, so the browser asks again
      Vary: "Cookie",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}

const NO_STORE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

function unavailable() {
  return new NextResponse("The file store is not answering. Try again in a minute.", {
    status: 503, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8", "Retry-After": "30" },
  });
}

/** The same answer for a missing file and for one the visitor may not see. A page for someone who opened the link, plain text for images, players and pdf.js. */
function notFound(req: Request, name: string) {
  if (req.headers.get("sec-fetch-dest") !== "document") {
    return new NextResponse("Not found", { status: 404, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
  }
  const back = `/login?next=${encodeURIComponent(`/f/${name.split("/").map(encodeURIComponent).join("/")}`)}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>File not found</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 16px;color:#1a1a1a;background:#fff}a{color:inherit}@media (prefers-color-scheme:dark){body{color:#eee;background:#111}}</style></head>
<body><h1>File not found</h1><p>This file was not found. If it belongs to a private event that was shared with you, sign in with the email address it was shared with.</p>
<p><a href="${back.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">Sign in</a> · <a href="/events">All events</a></p></body></html>`;
  return new NextResponse(html, { status: 404, headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8" } });
}
