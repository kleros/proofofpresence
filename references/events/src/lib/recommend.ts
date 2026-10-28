import type { EventRow, Profile } from "./types";
import { KLEROS_HOSTED } from "./kleros";

// Simple, explainable scoring: shared topics, region, format fit for the visitor's role.
export function scoreEvent(e: EventRow, p: Pick<Profile, "interests" | "region" | "visitor_role" | "include_online">) {
  let s = 0;
  const why: string[] = [];
  const hits = e.topics.filter((t) => p.interests.includes(t));
  if (hits.length) { s += 3 * hits.length; why.push(hits.slice(0, 2).join(" & ")); }
  if (p.region && e.region === p.region) { s += 2; why.push("near you"); }
  if (!e.city) { if (p.include_online) { s += 1; if (!why.length) why.push("online"); } else s -= 5; }
  const r = p.visitor_role ?? "";
  if (/Builder/.test(r) && /Hackathon|Workshop/.test(e.event_type)) { s += 2; why.push(`${e.event_type.toLowerCase()}s suit builders`); }
  if (/Juror/.test(r) && (e.event_type === "Juror training" || e.topics.includes("Jurors"))) { s += 3; why.push("for jurors"); }
  if (/Research|Legal/.test(r) && /Academic|Panel|Conference/.test(e.event_type)) s += 1;
  if (/Founder|Investor/.test(r) && ["sponsor", "booth", "host"].includes(e.kleros_role)) { s += 1; why.push("the team will be there to meet"); }
  if (KLEROS_HOSTED.includes(e.kleros_role)) s += 1;
  return { score: s, why: why.length ? "Because: " + why.join(", ") : "" };
}
