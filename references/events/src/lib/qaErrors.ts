// Plain words for what can go wrong when asking or voting in the live Q&A.
export function qaError(e: unknown) {
  const m = (e as Error)?.message || "";
  // the database's own refusals (too many questions or votes, a reserved name) are written to be shown as they are
  const code = (e as { code?: string })?.code;
  if (code === "PT429" || code === "PT422") return m;
  if (/anonymous/i.test(m) && /disabled|not enabled/i.test(m)) return "Guest questions are switched off for this site right now. Sign in to ask.";
  // Supabase allows a set number of guest sessions per IP address per hour; venue wifi shares one address
  if (/rate limit/i.test(m)) return "Too many guests have joined from this network in the last hour. Try again later, or sign in to ask.";
  if (/fetch|network/i.test(m)) return "No connection. Check the wifi and try again.";
  return m || "Something went wrong. Try again.";
}
