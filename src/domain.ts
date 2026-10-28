/** Stable IDs are independent of display slugs and off-chain content status. */
export type DeploymentVersion = "truth-pays-v7";
export interface Deployment {
  eventId: string;
  chainId: number;
  contract: string;
  deploymentBlock: number;
  contractVersion: DeploymentVersion;
  abiVersion: DeploymentVersion;
  depositWei: string;
  eventStart: number;
  claimDeadline: number;
  depositOpensAt: number;
  depositDeadline: number;
  owner: string;
  resolver: string;
  arbitrator: string;
  policyURI: string;
  templateHash: string;
  codeHash: string;
  sourceCommit: string;
}
export interface EventDefinition {
  id: string;
  slug: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  location: string;
  visibility: "public" | "private";
  editorialStatus: "draft" | "published";
  registrationStatus: "open" | "closed";
  organizers: string[];
  staff: string[];
  lumaEventId?: string;
  contentEventId?: string;
  lumaUrl?: string;
  contentUrl?: string;
  deployment?: Deployment;
}
