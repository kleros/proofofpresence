import type { Turn } from "./agent";

const MAX_TURNS = 16;
const MAX_QUESTION = 2000;
const MAX_ANSWER = 6000;
// all of it together: the visitor sends the history, so it is also a cost to cap
const MAX_TOTAL = 40_000;

/** Visitor-supplied history, checked: alternating turns that end with the question. */
export function cleanHistory(raw: unknown): Turn[] | string {
  if (!Array.isArray(raw) || !raw.length) return "Ask a question first.";
  const turns: Turn[] = [];
  for (const r of raw.slice(-MAX_TURNS)) {
    if (!r || typeof r !== "object") return "The conversation could not be read.";
    const { role, content } = r as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return "The conversation could not be read.";
    const text = content.trim();
    if (!text) continue;
    if (role === "user" && text.length > MAX_QUESTION) return `Keep questions under ${MAX_QUESTION} characters.`;
    const prev = turns[turns.length - 1];
    // turns must alternate: of two questions in a row only the later one counts (the earlier got
    // no answer), and two answers in a row are joined
    if (prev?.role === "user" && role === "user") prev.content = text;
    else if (prev?.role === role) prev.content = `${prev.content}\n\n${text}`.slice(-MAX_ANSWER);
    else turns.push({ role, content: text.slice(0, MAX_ANSWER) });
  }
  let total = turns.reduce((n, t) => n + t.content.length, 0);
  while (total > MAX_TOTAL && turns.length > 1) total -= turns.shift()!.content.length;
  while (turns[0]?.role === "assistant") turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== "user") return "Ask a question first.";
  return turns;
}
