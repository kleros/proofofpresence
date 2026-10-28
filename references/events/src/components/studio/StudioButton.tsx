"use client";

export type StudioMode = "record" | "files" | "slides";
export const STUDIO_EVENT = "kleros-studio";

/** Opens the team tools on the event page (EventStudio) on one of its tabs. */
export default function StudioButton({ mode, className = "btn", children }: { mode: StudioMode; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new CustomEvent<StudioMode>(STUDIO_EVENT, { detail: mode }))}>
      {children}
    </button>
  );
}
