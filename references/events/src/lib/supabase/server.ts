import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

export const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "missing-anon-key",
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // called from a server component; middleware refreshes the session instead
          }
        },
      },
    },
  );
}

/**
 * The signed-in user and their profile (select * includes is_team and is_admin).
 * Anonymous sessions (QR guests asking a question) count as signed out.
 * Cached per request, so the header, admin layout and page share one lookup.
 */
export const currentUser = cache(async () => {
  if (!supabaseConfigured) return { user: null, profile: null };
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  // Guests who scanned a QR to ask a question get an anonymous session; they aren't "signed in".
  if (!data.user || data.user.is_anonymous) return { user: null, profile: null };
  const { data: profile } = await sb.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  return { user: data.user, profile };
});
