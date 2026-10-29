/** Stable IDs are independent of display slugs and off-chain content status. */
export type DeploymentVersion =
  | "truth-pays-v7"
  | "kleros-event-v8"
  | "kleros-event-v8-test15m";
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
  /** v8 factory provenance; absent for the immutable historical v7 deployment. */
  deploymentTxHash?: string;
  eventName?: string;
  creator?: string;
  factory?: string;
  factoryCodeHash?: string;
  /** Required for the separate Chiado-only test profile's constructor provenance. */
  factoryDeploymentTxHash?: string;
  factoryDeploymentBlock?: number;
  factoryEventId?: string;
  eventKey?: string;
  configurationHash?: string;
  creationCodeHash?: string;
  arbitratorExtraData?: string;
  compiler?: string;
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
