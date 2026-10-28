/**
 * Kleros lead matching engine.
 *
 * One file, two homes:
 *   - Browser: loaded by index.html and admin.html (and used for demo mode).
 *   - Google Apps Script: paste this file as "Matching.gs" next to Code.gs.
 *
 * Plain ES5 on purpose so it runs unchanged in both places.
 * Edit KLEROS_USE_CASES / POSITION_WEIGHT to tune how leads are routed.
 *
 * `focus: true` marks the current pipeline priorities. Only focus use cases
 * can produce a Hot lead, and they win ties against the other tracks.
 */

var KLEROS_USE_CASES = [
  // ---- Pipeline focus ----
  {
    id: 'ai',
    focus: true,
    label: 'AI Agents & Agentic Economy',
    short: 'AI agents',
    tagline: 'Dispute resolution for agent deals and payments',
    product: 'Agentic Court, Kleros Dispute Service (MCP), verified-agent registry',
    pitch: 'When an agent deal goes wrong, Kleros gives it a dispute route: recorded mandate and evidence, a jury ruling, and a remedy your team can defend.',
    link: 'https://ai.kleros.io',
    owner: 'AI Partnerships',
    keywords: ['ai', 'agent', 'agents', 'agentic', 'llm', 'autonomous', 'olas', 'autonolas', 'virtuals', 'fetch.ai',
      'bittensor', 'ritual', 'eliza', 'x402', 'erc-8004', '8004', 'a2a', 'mcp', 'agentkit', 'giza', 'nevermined',
      'skyfire', 'payman', 'crossmint', 'inference', 'gpt', 'assistant', 'machine learning', 'ml', 'copilot', 'bot', 'bots',
      'mandate', 'delegat', 'agent payment', 'robot', 'clawbank', 'llms', 'ai model', 'language model', 'frontier', 'agentic commerce', 'triage']
  },
  {
    id: 'prediction',
    focus: true,
    label: 'Prediction Markets & Oracles',
    short: 'Prediction markets',
    tagline: 'Fast, disputable market resolution with an AI oracle',
    product: 'Kleros AI oracle + Court (Reality.eth)',
    pitch: 'How a disputed market outcome or oracle answer can be escalated to a jury, and how an AI oracle can speed up the uncontested ones.',
    link: 'https://docs.kleros.io/products/reality',
    owner: 'Web3 Integrations',
    keywords: ['prediction', 'polymarket', 'seer', 'omen', 'oracle', 'oracles', 'reality.eth', 'forecast', 'betting',
      'futarchy', 'uma', 'chainlink', 'azuro', 'limitless', 'myriad', 'kalshi', 'manifold', 'market resolution', 'resolution source',
      'hedgehog', 'zeitgeist', 'opinion labs', 'truemarkets', 'drift', 'sports', 'bet']
  },
  {
    id: 'enterprise',
    focus: true,
    label: 'Enterprise & Customer Disputes',
    short: 'Enterprise',
    tagline: 'Chargebacks, claims and support escalations, decided by independent jurors',
    product: 'Kleros Enterprise',
    pitch: 'How chargebacks, insurance claims and support escalations can go to an independent jury instead of internal review or a court.',
    link: 'https://docs.kleros.io/enterprise/use-cases',
    owner: 'Enterprise Sales',
    keywords: ['fintech', 'payment', 'payments', 'exchange', 'cex', 'bank', 'neobank', 'card', 'remittance',
      'e-commerce', 'ecommerce', 'marketplace', 'customer', 'support ticket', 'helpdesk', 'insurance', 'insurtech', 'claims', 'chargeback',
      'fraud', 'lemon', 'binance', 'coinbase', 'kraken', 'okx', 'bybit', 'wazirx', 'coindcx', 'coinswitch', 'mudrex',
      'razorpay', 'paytm', 'phonepe', 'upi', 'stripe', 'visa', 'mastercard', 'enterprise', 'saas', 'telecom', 'airline', 'travel',
      'insurer', 'metlife', 'complaint', 'complaints', 'refund', 'refunds']
  },
  {
    id: 'defi',
    focus: true,
    label: 'DeFi Curation',
    short: 'DeFi curation',
    tagline: 'Challengeable token lists, address tags and registries',
    product: 'Kleros Scout & Curate',
    pitch: 'Challengeable registries for token lists, address tags and contract labels, kept honest by jurors. The same registries can back agent reputation claims.',
    link: 'https://docs.kleros.io/products/scout',
    owner: 'Web3 Integrations',
    keywords: ['defi', 'dex', 'swap', 'lending', 'yield', 'vault', 'stablecoin', 'amm', 'perp', 'uniswap', 'aave',
      'curve', 'compound', 'lido', 'token list', 'tokenlist', 'curation', 'curate', 'scout', 'registry', 'address tag',
      'labels', 'wallet', 'explorer', 'registries', 'token metadata', 'snap', 'metamask', 'rabby', 'etherscan', 'blockscout', 'blockaid', 'security', 'scam',
      'restak', 'eigen', 'bridge', 'liquidity', 'aggregator']
  },
  // ---- Other Kleros tracks (each gets its own pipeline, so little lands in "Other") ----
  {
    id: 'identity',
    label: 'Proof of Humanity',
    short: 'Identity & PoH',
    product: 'Proof of Humanity v2',
    pitch: 'How a Sybil-resistant registry of humans supports one-person-one-vote, quadratic funding and bot-resistant communities.',
    link: 'https://docs.kleros.io/products/proof-of-humanity',
    owner: 'PoH Team',
    keywords: ['identity', 'sybil', 'did', 'kyc', 'humanity', 'personhood', 'worldcoin', 'world id', 'passport',
      'airdrop', 'ubi', 'reputation', 'attestation', 'eas', 'zk', 'zupass', 'farcaster', 'lens', 'social', 'soulbound',
      'unique human', 'proof of personhood']
  },
  {
    id: 'dao',
    label: 'DAOs & Governance',
    short: 'DAOs & governance',
    product: 'Governor, SafeSnap, Foresight (futarchy)',
    pitch: 'How Snapshot votes can be executed onchain with a challenge period, and how governance disputes get a neutral ruling.',
    link: 'https://docs.kleros.io/products/governor',
    owner: 'Web3 Integrations',
    keywords: ['dao', 'governance', 'treasury', 'grant', 'grants', 'snapshot', 'multisig', 'gitcoin', 'safe',
      'public goods', 'delegate', 'voting', 'ens', 'optimism', 'collective', 'tally', 'aragon', 'zodiac', 'futarchy', 'metadao']
  },
  {
    id: 'legal',
    label: 'Legal, Arbitration & Government',
    short: 'Legal & government',
    product: 'Hybrid Med-Arb, Arbitration, Consumer Ombudsman',
    pitch: 'How online arbitration and mediation can work for law firms, mediators, courts and public bodies, including court and municipal pilots.',
    link: 'https://docs.kleros.io/enterprise/legal',
    owner: 'Enterprise Sales',
    keywords: ['law', 'legal', 'lawyer', 'attorney', 'advocate', 'arbitration', 'arbitrator', 'mediation', 'mediator', 'justice',
      'government', 'public sector', 'policy', 'regulat', 'compliance', 'odr', 'judge', 'judiciary', 'ministry',
      'ombudsman', 'municipal', 'legaltech', 'wipo', 'intellectual property', 'copyright', 'trademark', 'patent']
  },
  {
    id: 'commerce',
    label: 'Commerce & P2P',
    short: 'Commerce & P2P',
    product: 'Commerce court, Lockler',
    pitch: 'How marketplace, freelance, bounty and P2P disputes can get a neutral ruling, for human and agent buyers alike.',
    link: 'https://docs.kleros.io/products/overview',
    owner: 'Web3 Integrations',
    keywords: ['p2p', 'peer-to-peer', 'freelance', 'freelancer', 'otc', 'nft', 'rwa', 'real estate', 'supply chain',
      'ticketing', 'bounty', 'bounties', 'merchant', 'gig', 'service marketplace']
  },
  {
    id: 'infra',
    label: 'Cross-chain & Infrastructure',
    short: 'Infrastructure',
    product: 'Vea bridge, Kleros Court V2 on Arbitrum',
    pitch: 'Cross-chain messaging for arbitrable apps and the base court any protocol can plug into.',
    link: 'https://docs.kleros.io/developers/overview',
    owner: 'Web3 Integrations',
    keywords: ['bridge', 'cross-chain', 'crosschain', 'interop', 'rollup', 'l2', 'layer 2', 'arbitrum', 'optimism', 'zksync',
      'starknet', 'polygon', 'gnosis', 'chain abstraction', 'rpc', 'infra', 'infrastructure', 'sdk', 'messaging', 'appchain']
  },
  {
    id: 'research',
    label: 'Research & Education',
    short: 'Research & education',
    product: 'Kleros R&D Fellowship, research grants',
    pitch: 'Game theory, mechanism design and decentralized justice research, with fellowships and academic partnerships.',
    link: 'https://docs.kleros.io/research/overview',
    owner: 'Research',
    keywords: ['research', 'researcher', 'phd', 'professor', 'academic', 'thesis', 'paper', 'mechanism design', 'game theory',
      'economics', 'social choice', 'fellowship', 'lab', 'institute', 'journal', 'teaching', 'course']
  },
  {
    id: 'community',
    label: 'Jurors & Community',
    short: 'Jurors & community',
    product: 'Become a Juror or Curator (PNK)',
    pitch: 'How jurors are drawn at random, review evidence and vote, and why the Schelling point keeps rulings honest.',
    link: 'https://docs.kleros.io/concepts/dispute-resolution',
    owner: 'Community',
    keywords: ['student', 'university', 'college', 'iit', 'community', 'ambassador', 'juror', 'curator', 'creator', 'content',
      'kol', 'influencer', 'media', 'journalist', 'hacker', 'hackathon', 'pnk']
  }
];

// Keywords are matched against company + free text. Avoid everyday words ("chain" matches "blockchain",
// "model", "support", "dispute", "protocol"): they pull visitors into the wrong pipeline.

// Visitor-facing interest options on the form map 1:1 to use case ids.
// The first four are shown as large cards, the rest as small chips.
var INTEREST_TO_USE_CASE = {
  'Disputes for AI Agents': 'ai',
  'Prediction Market Resolution': 'prediction',
  'Enterprise & Customer Disputes': 'enterprise',
  'DeFi Curation & Token Lists': 'defi',
  'Running an AI Juror Agent': 'ai',
  'Becoming a Juror': 'community',
  'Legal & Arbitration': 'legal',
  'DAOs & Governance': 'dao',
  'Proof of Humanity': 'identity',
  'Research & Academia': 'research'
};

// Labels are matched ignoring case, so rows saved before a wording change still route the same way.
function interestId_(label) {
  if (INTEREST_TO_USE_CASE.hasOwnProperty(label)) return INTEREST_TO_USE_CASE[label];
  var l = String(label).toLowerCase();
  for (var k in INTEREST_TO_USE_CASE) if (INTEREST_TO_USE_CASE.hasOwnProperty(k) && k.toLowerCase() === l) return INTEREST_TO_USE_CASE[k];
  return null;
}

// How much a role tends to drive an integration decision (0 to 3).
var POSITION_WEIGHT = {
  'Founder / C-level': 3,
  'Business Development / Partnerships': 3,
  'Product Manager': 2,
  'Engineer / Developer': 2,
  'Legal / Compliance': 2,
  'Investor / VC': 2,
  'Government / Public Sector': 2,
  'Researcher / Academic': 1,
  'Marketing / Community': 1,
  'Designer': 1,
  'Student': 0,
  'Other': 1
};

// Seniority the visitor picked (0 to 3). Combined with the role weight into "decision power".
var SENIORITY_WEIGHT = {
  'Founder / C-suite': 3,
  'VP / Head / Director': 3,
  'Manager / Team lead': 2,
  'Individual contributor': 1,
  'Student / Early career': 0,
  'Other': 1
};

// Decision power 0 to 3 mapped to the level shown in the database.
var LEVELS = ['Community', 'Practitioner', 'Influencer', 'Decision-maker'];

function decisionPower_(position, seniority) {
  var pw = POSITION_WEIGHT.hasOwnProperty(position) ? POSITION_WEIGHT[position] : 1;
  if (!SENIORITY_WEIGHT.hasOwnProperty(seniority)) return pw;
  // Seniority counts double: a Head of Marketing outranks a junior BD hire.
  return Math.round((SENIORITY_WEIGHT[seniority] * 2 + pw) / 3);
}

// Role-specific follow-up, appended to the use case.
function nextStepFor_(position, useCase, wantsCall, aiJuror) {
  if (aiJuror && useCase.id === 'ai') {
    return 'Invite to the AI juror operators Telegram group and share Agentic Court staking docs';
  }
  if (useCase.id === 'community') {
    return 'Send juror onboarding guide (kleros.io/earn-become-a-juror) and invite to t.me/kleros';
  }
  if (wantsCall) return 'Asked for a call: book within 48h on ' + useCase.label;
  switch (position) {
    case 'Engineer / Developer':
      return 'Send integration docs (docs.kleros.io) for ' + useCase.product + ', offer a dev call';
    case 'Founder / C-level':
    case 'Business Development / Partnerships':
    case 'Government / Public Sector':
      return 'Book a partnership call on ' + useCase.label;
    case 'Product Manager':
      return 'Share ' + useCase.product + ' case study, propose product walkthrough';
    case 'Legal / Compliance':
      return 'Share enforceability material (Med-Arb MSA, court rulings), book call';
    case 'Investor / VC':
      return 'Connect with founders, share portfolio-fit angle: ' + useCase.label;
    case 'Researcher / Academic':
      return 'Share Kleros research (game theory, dispute kits), invite to research calls';
    case 'Student':
      return 'Invite to juror onboarding and community calls';
    default:
      return 'Send intro email on ' + useCase.label;
  }
}

function escapeRegex_(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordHits_(text, keywords) {
  var hits = [];
  for (var i = 0; i < keywords.length; i++) {
    var k = keywords[i];
    // Short keywords ("ai", "dao", "zk") need word boundaries so "rain" or "shadow" don't match.
    var re = k.length <= 4
      ? new RegExp('(^|[^a-z0-9])' + escapeRegex_(k) + '($|[^a-z0-9])')
      : new RegExp(escapeRegex_(k));
    if (re.test(text)) hits.push(k);
  }
  return hits;
}

function useCaseById(id) {
  for (var i = 0; i < KLEROS_USE_CASES.length; i++) if (KLEROS_USE_CASES[i].id === id) return KLEROS_USE_CASES[i];
  return null;
}

/**
 * lead: { company, position, seniority, interests: [labels] | "a, b", building, otherInterest, klerosUse, wantsCall }
 * returns { primary, primaryId, secondary, pipeline, level, levelRank, fitScore, priority, priorityRank, product, pitch, link, owner, nextStep, reasons }
 */
function matchLead(lead) {
  var interests = lead.interests || [];
  if (typeof interests === 'string') {
    interests = interests ? interests.split(/\s*[,;]\s*/) : [];
  }
  var wantsCall = lead.wantsCall === true || lead.wantsCall === 'Yes';
  var aiJuror = false;
  var text = [lead.company, lead.building, lead.otherInterest, lead.klerosUse].join(' ').toLowerCase();
  var picked = {};
  for (var i = 0; i < interests.length; i++) {
    var id = interestId_(interests[i]);
    if (id) picked[id] = true;
    if (String(interests[i]).toLowerCase() === 'running an ai juror agent') aiJuror = true;
  }

  var ranked = [];
  var reasons = {};
  for (var j = 0; j < KLEROS_USE_CASES.length; j++) {
    var uc = KLEROS_USE_CASES[j];
    var score = 0;
    var why = [];
    if (picked[uc.id]) { score += 4; why.push('picked interest'); }
    var hits = keywordHits_(text, uc.keywords);
    if (hits.length) { score += Math.min(hits.length, 3) * 2; why.push('mentions ' + hits.slice(0, 3).join(', ')); }
    if (uc.id === 'community' && (lead.position === 'Student' || lead.position === 'Marketing / Community')) { score += 2; why.push('role'); }
    if (uc.id === 'legal' && (lead.position === 'Legal / Compliance' || lead.position === 'Government / Public Sector')) { score += 3; why.push('role'); }
    if (uc.id === 'research' && lead.position === 'Researcher / Academic') { score += 2; why.push('role'); }
    // Pipeline focus wins ties and gets a small nudge whenever there is any signal for it.
    if (uc.focus && score > 0) score += 1;
    ranked.push({ uc: uc, score: score, order: j });
    reasons[uc.id] = why;
  }
  ranked.sort(function (a, b) { return b.score - a.score || a.order - b.order; });

  // Nothing to go on: route by role, default to the juror/community track.
  var top = ranked[0];
  if (top.score === 0) {
    var fallbackId = { 'Legal / Compliance': 'legal', 'Government / Public Sector': 'legal', 'Researcher / Academic': 'research' }[lead.position] || 'community';
    for (var k = 0; k < ranked.length; k++) if (ranked[k].uc.id === fallbackId) top = ranked[k];
    reasons[top.uc.id] = ['no signal, routed by role'];
  }
  var second = null;
  for (var m = 0; m < ranked.length; m++) {
    if (ranked[m] !== top && ranked[m].score > 0) { second = ranked[m]; break; }
  }

  var roleWeight = decisionPower_(lead.position, lead.seniority);
  // 0 to 100: topic fit (max ~10), decision power (max 3), and asking for a call.
  var fitScore = Math.round(Math.min(100, (Math.min(top.score, 10) / 10) * 55 + (roleWeight / 3) * 30 + (wantsCall ? 15 : 0)));
  var priority = 'Nurture';
  if (top.uc.focus && (wantsCall || (top.score >= 5 && roleWeight >= 3) || (top.score >= 7 && roleWeight >= 2))) priority = 'Hot';
  else if (top.score >= 4 || roleWeight >= 2 || wantsCall) priority = 'Warm';

  var why = reasons[top.uc.id].slice();
  if (wantsCall) why.push('asked for a call');
  if (aiJuror) why.push('wants to run an AI juror');

  return {
    primary: top.uc.label,
    primaryId: top.uc.id,
    secondary: second ? second.uc.label : '',
    pipeline: top.score === 0 ? 'Other' : top.uc.short,
    level: LEVELS[roleWeight],
    levelRank: 4 - roleWeight,  // 1 = Decision-maker ... 4 = Community, for sorting
    fitScore: fitScore,
    priority: priority,
    priorityRank: { Hot: 1, Warm: 2, Nurture: 3 }[priority],
    product: top.uc.product,
    pitch: top.uc.pitch,
    link: top.uc.link,
    owner: top.uc.owner,
    nextStep: nextStepFor_(lead.position, top.uc, wantsCall, aiJuror),
    reasons: why.join('; ')
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { matchLead: matchLead, useCaseById: useCaseById, SENIORITY_WEIGHT: SENIORITY_WEIGHT, LEVELS: LEVELS, KLEROS_USE_CASES: KLEROS_USE_CASES, INTEREST_TO_USE_CASE: INTEREST_TO_USE_CASE, POSITION_WEIGHT: POSITION_WEIGHT };
}
