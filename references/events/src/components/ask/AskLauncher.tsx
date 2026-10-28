import { currentUser } from "@/lib/supabase/server";
import { sharedLimits, visitorsOff, type Shared } from "@/lib/ask/limit";
import AskWidget from "./AskWidget";

// what the team reads in the panel while only the team can ask
const TEAM_ONLY: Record<Exclude<Shared, "ok">, string> = {
  "no-key": "Only the team sees this button for now. To open it to everyone, an admin adds SUPABASE_SERVICE_ROLE_KEY to the site's environment variables (on Vercel or Netlify), runs migration 0014_security.sql in Supabase if it has not been run, and redeploys.",
  "not-set-up": "Only the team sees this button for now: the database has no question counter or refused the key. An admin checks that migration 0014_security.sql has been run in Supabase and that SUPABASE_SERVICE_ROLE_KEY holds the service role key.",
  down: "Only the team sees this button for now: the database that keeps the question counts did not answer. Once it answers, everyone else gets the button on their next page load.",
};

/**
 * The assistant's button, once the deployment has an Anthropic key. Before that only the team
 * sees it, with a note on how to switch it on. Anyone outside the team (visitors, QR guests and
 * other accounts) sees it only while their question counts can be kept in the database
 * (SUPABASE_SERVICE_ROLE_KEY, and ask_take from migration 0013 or 0014); until then the team sees
 * a note on what is missing. ASK_PUBLIC=off keeps it to signed-in accounts.
 */
export default async function AskLauncher() {
  const enabled = !!(process.env.ASK_ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim());
  const { user, profile } = await currentUser();
  const isTeam = !!(profile?.is_team || profile?.is_admin);
  if (!enabled && !isTeam) return null;
  if (!user && visitorsOff()) return null;
  const shared = enabled ? await sharedLimits() : "ok";
  if (shared !== "ok" && !isTeam) return null;
  return <AskWidget enabled={enabled} signedIn={!!user} account={user?.id ?? "visitor"} note={shared === "ok" ? undefined : TEAM_ONLY[shared]} />;
}
