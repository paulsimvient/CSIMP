export type EvaluationRunRecord = {
  suite: string;
  passed: boolean;
  metrics: Record<string, number>;
  reportArtifact: string;
};

export type ReviewDecision = "approved" | "rejected";

export type ApprovalRecord = {
  reviewerId: string;
  decision: ReviewDecision;
  timestamp: string;
  justification?: string;
};

export type PromotionStage = "shadow" | "canary" | "production";

export type AgentReleaseRecord = {
  releaseId: string;
  agentId: string;
  version: string;
  baseCommitSha: string;
  patchSha256: string;
  proposalId: string;
  evidenceRefs: string[];
  evaluationRuns: EvaluationRunRecord[];
  approvals: ApprovalRecord[];
  stage: PromotionStage;
  deployedAt?: string;
  rolledBackAt?: string;
};
