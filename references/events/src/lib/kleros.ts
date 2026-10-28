import type { KlerosRole } from "./types";

/** Address used in share links, QR codes and calendar files: set explicitly, else the host's own. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NETLIFY_SITE_URL ||
  (process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const ROLE_LABEL: Record<KlerosRole, string> = {
  host: "Hosted by Kleros",
  co_host: "Co-hosted by Kleros",
  speaking: "Kleros speaking",
  sponsor: "Kleros sponsoring",
  booth: "Kleros booth",
  judging: "Kleros bounty & judging",
  attending: "Kleros attending",
};
export const ROLE_SHORT: Record<KlerosRole, string> = {
  host: "Host", co_host: "Co-host", speaking: "Speaking", sponsor: "Sponsor", booth: "Booth", judging: "Judging", attending: "Attending",
};
export const KLEROS_HOSTED: KlerosRole[] = ["host", "co_host"];

export const EVENT_TYPES = ["Conference", "Side event", "Meetup", "Hackathon", "Workshop", "Panel", "Online talk / Space", "Academic", "Juror training", "Other"];
export const TOPICS = ["Arbitration", "Jurors", "AI agents", "Prediction markets", "Oracles", "DeFi", "Smart contracts", "Governance", "Legal tech", "Content moderation", "Research", "Community"];
export const REGIONS = ["Europe", "North America", "Latin America", "Asia", "Africa", "Middle East", "Oceania", "Online"];
export const VISITOR_ROLES = ["Builder / developer", "Juror", "Researcher / academic", "Legal professional", "Founder / BD partner", "Investor", "Community member"];

export interface Product {
  name: string;
  pitch: string;
  url: string;
  cta: string;
  topics: string[];
}

// Shown on each event page, picked by the event's topics.
export const PRODUCTS: Product[] = [
  { name: "Kleros Court", pitch: "Decentralized arbitration with randomly drawn, incentivized jurors.", url: "https://court.kleros.io", cta: "Become a juror", topics: ["Arbitration", "Jurors", "Legal tech", "Governance"] },
  { name: "Arbitration for AI agents", pitch: "When autonomous agents transact, Kleros resolves the disputes they can't.", url: "https://kleros.io", cta: "See how it works", topics: ["AI agents", "Research"] },
  { name: "Reality.eth + Kleros", pitch: "Optimistic oracle answers backed by Kleros arbitration, used by prediction markets.", url: "https://reality.eth.limo", cta: "Explore the oracle", topics: ["Prediction markets", "Oracles", "DeFi"] },
  { name: "Kleros Escrow", pitch: "Pay for work and goods with a court behind the deal.", url: "https://escrow.kleros.io", cta: "Open an escrow", topics: ["DeFi", "Smart contracts"] },
  { name: "Kleros Curate", pitch: "Community-curated lists and registries with disputes settled by Kleros.", url: "https://curate.kleros.io", cta: "Browse registries", topics: ["Content moderation", "Governance", "Community"] },
  { name: "Integrate Kleros", pitch: "Add dispute resolution to your protocol with a few contract calls.", url: "https://docs.kleros.io", cta: "Read the docs", topics: ["Smart contracts", "Oracles", "DeFi"] },
];

export function productsFor(topics: string[], n = 2): Product[] {
  const scored = PRODUCTS.map((p) => ({ p, s: p.topics.filter((t) => topics.includes(t)).length }));
  const hits = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.p);
  return (hits.length ? hits : [PRODUCTS[0], PRODUCTS[5]]).slice(0, n);
}

// The Kleros | Events profile on Luma, where every Kleros-run event takes RSVPs.
export const LUMA_URL = "https://luma.com/user/kleros_io";

export const SOCIALS = [
  { label: "Luma", url: LUMA_URL },
  { label: "X", url: "https://x.com/kleros_io" },
  { label: "Telegram", url: "https://t.me/kleros" },
  { label: "LinkedIn", url: "https://www.linkedin.com/company/kleros" },
  { label: "Reddit", url: "https://www.reddit.com/r/Kleros/" },
  { label: "GitHub", url: "https://github.com/kleros" },
  { label: "Blog", url: "https://blog.kleros.io" },
];

export const MEETING_INTERESTS = ["Integrating Kleros", "Becoming a juror", "Partnership", "Research collaboration", "Press / media", "Speaking invite", "Other"];
