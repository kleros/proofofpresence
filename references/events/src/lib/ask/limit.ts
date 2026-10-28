// How often people may ask. Outside the team, questions are taken only while the counts live in
// the database (SUPABASE_SERVICE_ROLE_KEY set and ask_take from migration 0013 or 0014), so the limits
// hold across every server instance. Counts kept in each instance's memory would stop one person
// but not a script that spreads its requests over many instances. The team, whose accounts are
// known, falls back to counting in memory. The hard ceiling on spend is the limit on the key's
// Anthropic workspace (README, "Site assistant").
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env = (k: string, d: number) => Number(process.env[k]) > 0 ? Number(process.env[k]) : d;

export type Tier = "team" | "signed-in" | "visitor";

/** ASK_PUBLIC=off: visitors who are not signed in cannot ask. */
export const visitorsOff = () => process.env.ASK_PUBLIC?.trim().toLowerCase() === "off";

/** Questions per 10 minutes and per day, by tier, and in all for everyone outside the team per day. */
const limits = (tier: Tier) => tier === "team"
  ? { burst: env("ASK_LIMIT_TEAM", 60), daily: 0, overall: 0 }
  : tier === "signed-in"
    ? { burst: env("ASK_LIMIT_SIGNED_IN", 20), daily: env("ASK_LIMIT_SIGNED_IN_DAILY", 60), overall: env("ASK_LIMIT_DAILY_TOTAL", 600) }
    : { burst: env("ASK_LIMIT_VISITOR", 8), daily: env("ASK_LIMIT_VISITOR_DAILY", 30), overall: env("ASK_LIMIT_DAILY_TOTAL", 600) };
type Limits = ReturnType<typeof limits>;

const MESSAGES = {
  burst: "That is a lot of questions in a short time. Try again in a few minutes.",
  daily: (tier: Tier) => tier === "visitor"
    ? "That is the limit of questions for today without signing in. Sign in to ask more."
    : "That is the limit of questions for one account today. Try again tomorrow.",
  overall: "The assistant has answered as many questions as it can today. Try again tomorrow.",
  teamOnly: "The assistant is only open to the Kleros team for now.",
  down: "The assistant cannot take questions right now. Try again in a few minutes.",
};

/** A question that is not taken: 429 over a limit, 503 while the shared counts are missing or down. */
export interface Refusal { status: 429 | 503; error: string }

/**
 * Whether the shared counts work, so that people outside the team may ask:
 * "no-key"     SUPABASE_SERVICE_ROLE_KEY is not set
 * "not-set-up" the database answered but has no ask_take (neither 0013 nor 0014 run) or refused the key
 * "down"       the database did not answer in time
 */
export type Shared = "ok" | "no-key" | "not-set-up" | "down";
type Found = Exclude<Shared, "no-key">;

let service: SupabaseClient | null | undefined;
function serviceDb() {
  if (service !== undefined) return service;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  service = key && process.env.NEXT_PUBLIC_SUPABASE_URL
    ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  return service;
}

// what the last call to ask_take found on this server instance, and until when to trust it
let found: { state: Found; until: number } | null = null;
let checking: Promise<Shared> | null = null;
function remember(state: Found) {
  found = { state, until: Date.now() + (state === "ok" ? 10 * 60_000 : 60_000) };
}

/** One call to ask_take. Never throws: a failure comes back as what it says about the set-up. */
async function callTake(db: SupabaseClient, key: string, l: Limits, timeoutMs: number):
  Promise<{ ok: true; over: unknown } | { ok: false; state: Exclude<Found, "ok"> }> {
  try {
    const { data, error, status } = await db
      .rpc("ask_take", { p_key: key, p_burst: l.burst, p_daily: l.daily, p_overall: l.overall })
      .abortSignal(AbortSignal.timeout(timeoutMs));
    if (!error) { remember("ok"); return { ok: true, over: data }; }
    // 404: no ask_take (PGRST202); 401 or 403: the key was refused. Anything else (no answer,
    // a timeout, 5xx) is the database being unreachable for now.
    const state = status === 401 || status === 403 || status === 404 ? "not-set-up" : "down";
    console.warn(`ask_take failed (${status} ${error.code || ""}):`, error.message);
    remember(state);
    return { ok: false, state };
  } catch (e) {
    console.warn("ask_take failed:", e instanceof Error ? e.message : e);
    remember("down");
    return { ok: false, state: "down" };
  }
}

/**
 * Whether people outside the team may ask now; the page shows them the button only then. The
 * answer is kept for 10 minutes (1 minute while it is not "ok") on each server instance, and a
 * question taken on the same instance refreshes it. The check calls ask_take under the key
 * "check" with no limits, so it holds nobody back.
 */
export async function sharedLimits(): Promise<Shared> {
  const db = serviceDb();
  if (!db) return "no-key";
  if (found && Date.now() < found.until) return found.state;
  checking ??= callTake(db, "check", { burst: 0, daily: 0, overall: 0 }, 2_000)
    .then((r) => (r.ok ? "ok" as const : r.state))
    .finally(() => { checking = null; });
  return checking;
}

/** Records one question for `key`; returns why it is refused, or null when it may go ahead. */
export async function take(key: string, tier: Tier): Promise<Refusal | null> {
  const l = limits(tier);
  const db = serviceDb();
  if (db) {
    const r = await callTake(db, key, l, 5_000);
    if (r.ok) {
      const reason = r.over === "burst" ? MESSAGES.burst : r.over === "daily" ? MESSAGES.daily(tier) : r.over === "overall" ? MESSAGES.overall : null;
      return reason ? { status: 429, error: reason } : null;
    }
    if (tier !== "team") return { status: 503, error: r.state === "not-set-up" ? MESSAGES.teamOnly : MESSAGES.down };
  } else if (tier !== "team") {
    return { status: 503, error: MESSAGES.teamOnly };
  }
  // the team only: counted in this instance's memory
  const reason = takeHere(key, l);
  return reason ? { status: 429, error: reason } : null;
}

// ---------------------------------------------------------------- in-memory fallback (team only)
const recent = new Map<string, number[]>();

function takeHere(key: string, l: Limits): string | null {
  const now = Date.now();
  const list = (recent.get(key) ?? []).filter((t) => now - t < 10 * 60_000);
  if (list.length >= l.burst) return MESSAGES.burst;
  list.push(now);
  recent.delete(key);
  recent.set(key, list);
  // keep memory bounded: the least recently active keys go first
  while (recent.size > 5000) recent.delete(recent.keys().next().value!);
  return null;
}
