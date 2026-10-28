"use client";
// Browser-side helpers for materials: uploads, kinds, and links to events (0006 material_events).
import { supabaseBrowser } from "./supabase/client";
import type { EventRow, MaterialKind } from "./types";

/** Uploads a file to the materials bucket (private, served at /f/<path>), under the event's folder (or "standalone"). */
export async function uploadToStorage(eventId: string | null, file: Blob, name: string) {
  const safe = name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(-60);
  const path = `${eventId ?? "standalone"}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabaseBrowser().storage.from("materials").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return path;
}

/**
 * Deletes files from the materials bucket, 100 at a time, trying a batch twice. Returns false when
 * storage could not be reached or answered with an error. Files the database rules do not let the
 * caller delete (still used by an item they cannot edit) are skipped without an error.
 */
export async function removeFiles(paths: (string | null | undefined)[]): Promise<boolean> {
  const files = [...new Set(paths.filter((x): x is string => !!x && !/^https?:\/\//.test(x)))];
  let ok = true;
  for (let i = 0; i < files.length; i += 100) {
    const part = files.slice(i, i + 100);
    let failed = true;
    for (let attempt = 0; attempt < 2 && failed; attempt++) {
      try { failed = !!(await supabaseBrowser().storage.from("materials").remove(part)).error; } catch { failed = true; }
    }
    if (failed) ok = false;
  }
  return ok;
}

export function kindOf(f: File): MaterialKind {
  if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) return "slides";
  if (f.type.startsWith("audio/") || /\.(m4a|mp3|wav|ogg)$/i.test(f.name)) return "audio";
  if (f.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(f.name)) return "video";
  if (f.type.startsWith("image/")) return "image";
  return "doc";
}

/** Links a material to events (already linked ones are skipped). */
export async function linkMaterial(materialId: string, eventIds: string[]) {
  if (!eventIds.length) return;
  const { error } = await supabaseBrowser().from("material_events")
    .upsert(eventIds.map((event_id) => ({ material_id: materialId, event_id })), { onConflict: "material_id,event_id", ignoreDuplicates: true });
  if (error) throw new Error(linkError(error.message));
}

export async function unlinkMaterial(materialId: string, eventId: string) {
  const { error } = await supabaseBrowser().from("material_events").delete().eq("material_id", materialId).eq("event_id", eventId);
  if (error) throw new Error(linkError(error.message));
}

function linkError(msg: string) {
  if (/material_events/.test(msg) && /does not exist|schema cache/i.test(msg))
    return "Linking to several events needs the database update in supabase/migrations/0006_material_links.sql.";
  // 0010: a private event only takes items that already belong to private events alone
  if (/row-level security/i.test(msg) && /material_events/.test(msg))
    return "This item can't be added to that event. Items from the recordings library or from a public event stay with the team: to show one in a private event, add it there as a new link or upload.";
  return msg;
}

/** The fields the event pickers show. */
export type PickEvent = Pick<EventRow, "id" | "slug" | "title" | "starts_on" | "ends_on" | "city" | "country" | "status" | "visibility" | "event_type">;

/** Every event the team can see, drafts included, newest first. */
export async function loadPickEvents(): Promise<PickEvent[]> {
  const { data, error } = await supabaseBrowser().from("events")
    .select("id, slug, title, starts_on, ends_on, city, country, status, visibility, event_type").order("starts_on", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PickEvent[];
}
