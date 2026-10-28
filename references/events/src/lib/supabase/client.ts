"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "missing-anon-key",
    );
  }
  return client;
}

// Signed-in user, or an anonymous guest session so people can ask and upvote without an email.
export async function ensureUser() {
  const sb = supabaseBrowser();
  const { data } = await sb.auth.getUser();
  if (data.user) return data.user;
  const { data: anon, error } = await sb.auth.signInAnonymously();
  if (error || !anon.user) throw error ?? new Error("Couldn't start a guest session");
  return anon.user;
}
