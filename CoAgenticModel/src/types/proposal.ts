import type { ChangeTier } from "./agent";

export type RiskClass = "low" | "medium" | "high";

export type PolicyChangeOperation =
  | "add-rule"
  | "remove-rule"
  | "replace-rule"
  | "set-threshold";

export type PolicyChange = {
  path: string;
  operation: PolicyChangeOperation;
  rule?: string;
  key?: string;
  value?: unknown;
};

export type TierAProposal = {
  changeType: "policy-update";
  agentId: string;
  baseVersion: string;
  changes: PolicyChange[];
  evidenceRefs: string[];
};

export type ChangedFile = {
  path: string;
  patch: string;
  reason: string;
};

/**
 * Structured patch proposal — never applied directly by the proposing agent.
 */
export type AgentPatchProposal = {
  proposalId: string;
  targetAgentId: string;
  baseAgentVersion: string;
  baseCommitSha: string;
  changeTier: ChangeTier;
  objective: string;
  evidenceRefs: string[];
  changedFiles: ChangedFile[];
  testsAddedOrChanged: string[];
  expectedBenefits: string[];
  knownRisks: string[];
  requestedRiskClass: RiskClass;
  /** Tier A only — declarative policy/prompt edits without TS source changes. */
  policyChanges?: PolicyChange[];
};

export type ProposalValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};
