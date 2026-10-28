import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMaterial } from "@/lib/data";
import { fmtDur, fmtRange } from "@/lib/format";
import TalkPlayer from "@/components/TalkPlayer";
import { driveId, fileUrl, linkUrl, youtubeId } from "@/components/MaterialRow";
import PromoStrip from "@/components/PromoStrip";
import EventChip from "@/components/studio/EventChip";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import RecordingSlides from "@/components/studio/RecordingSlides";
import { getTranscript, transcriptSetup } from "@/lib/transcript/data";
import TranscriptArea from "@/components/transcript/TranscriptArea";
import { MediaPlayer, YouTubePlayer } from "@/components/transcript/MediaPlayers";
import StartAt from "@/components/transcript/StartAt";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const [m, t] = await Promise.all([getMaterial(id), getTranscript(id)]);
  // a signed-out visitor gets a sign-in page here rather than a 404, which search engines must not keep
  if (!m) return { title: "Talk not found", robots: { index: false } };
  const fallback = `${m.speaker ? m.speaker + (m.events ? " at " : "") : ""}${m.events?.title ?? ""}. ${m.kind === "audio" ? "Recording" : "Slides and recording"}.`.replace(/^\. /, "");
  return { title: m.title, description: t?.summary?.tldr?.slice(0, 300) || fallback };
}

export default async function TalkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [m, { user, profile }, transcript] = await Promise.all([getMaterial(id), currentUser(), getTranscript(id)]);
  if (!m && !user) return (
    <div className="wrap page con-gate">
      <div className="eyebrow">Talk</div>
      <h1>Sign in to open this talk</h1>
      <p className="muted">This talk was not found. If it belongs to a private event that was shared with you, sign in with the email address it was shared with.</p>
      <div className="row-flex">
        <Link className="btn primary" href={`/login?next=${encodeURIComponent(`/talks/${id}`)}`}>Sign in</Link>
        <Link className="btn" href="/events">All events</Link>
      </div>
    </div>
  );
  if (!m || !(m.kind === "talk" || m.kind === "slides" || m.kind === "video" || (m.kind === "audio" && m.file_path))) notFound();
  const pdf = fileUrl(m.kind === "talk" ? m.pdf_path : m.file_path);
  const drive = driveId(m.url);
  const yt = youtubeId(m.url);
  const isTeam = !!(profile?.is_team || profile?.is_admin);
  // editors of the item (the team, or a private event's members) manage the slides of a recording
  const canEdit = !!user && (m.kind === "talk" || m.kind === "audio")
    && !!(await (await supabaseServer()).rpc("material_editable", { p_material: m.id })).data;

  let player: React.ReactNode;
  let canSeek = false;
  if (m.kind === "video") {
    if (drive) player = <div className="video" data-player><iframe src={`https://drive.google.com/file/d/${drive}/preview`} allow="autoplay; fullscreen" allowFullScreen title={m.title} /></div>;
    else if (yt) { player = <YouTubePlayer id={yt} title={m.title} />; canSeek = true; }
    else if (m.file_path) { player = <MediaPlayer kind="video" src={fileUrl(m.file_path)} title={m.title} />; canSeek = true; }
    else if (m.url) player = <a className="btn" href={linkUrl(m.url)} target="_blank" rel="noopener">Open video ↗</a>;
  } else if (m.kind === "audio") {
    player = <MediaPlayer kind="audio" src={fileUrl(m.file_path)} title={m.title} />;
    canSeek = true;
  } else {
    player = <TalkPlayer materialId={m.id} pdfUrl={pdf} audioUrl={m.kind === "talk" ? fileUrl(m.audio_path) : undefined} marks={m.marks} notes={m.notes} signedIn={!!user} />;
    canSeek = m.kind === "talk" && !!m.audio_path;
  }

  const recorded = m.kind === "talk" || m.kind === "audio" || m.kind === "video";
  const canTranscribe = (m.kind === "talk" && !!m.audio_path) || ((m.kind === "audio" || m.kind === "video") && !!m.file_path);
  const detail = [m.speaker, m.kind === "audio" ? (m.url ? "Recording with slides" : "Audio recording") : m.pages ? `${m.pages} slides` : "", m.duration_seconds ? fmtDur(m.duration_seconds) : ""].filter(Boolean).join(" · ");

  return (
    <div className="wrap page stack">
      <div>
        {m.events
          ? <Link href={`/events/${m.events.slug}`} className="back">← {m.events.title} · {fmtRange(m.events.starts_on)}</Link>
          : <Link href="/admin/recordings" className="back">← Recordings library</Link>}
        <h1 className="talk-title">{m.title}</h1>
        <div className="muted small">{detail}</div>
        {m.linkedEvents.length > 1 && (
          <div className="talk-events">
            <span className="muted small">Presented at</span>
            {m.linkedEvents.map((e) => <EventChip key={e.id} e={e} />)}
          </div>
        )}
        {!m.events && isTeam && (
          <div className="note talk-unlinked">Not linked to any event yet, so only the Kleros team can see it. <Link href="/admin/recordings">Link it to events</Link></div>
        )}
      </div>
      {(m.kind === "talk" || m.kind === "audio") && <RecordingSlides m={m} canEdit={canEdit} />}
      {canSeek && <Suspense><StartAt /></Suspense>}
      {recorded && (transcript || isTeam) ? (
        <TranscriptArea materialId={m.id} title={m.title} speaker={m.speaker} initial={transcript} isTeam={isTeam}
          canSeek={canSeek} canTranscribe={canTranscribe} setup={transcriptSetup()} durationHint={m.duration_seconds}>
          {player}
        </TranscriptArea>
      ) : player}
      <PromoStrip lead="Liked this talk?" />
    </div>
  );
}
