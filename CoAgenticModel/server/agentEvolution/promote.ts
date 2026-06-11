import type { ApprovalRecord, AgentReleaseRecord, PromotionStage } from "../../src/types/release";
import type { ParsedAgentPatchProposal } from "./proposalSchema";
import { requiredApprovals } from "./policy";
import { hashPatchContent } from "./auditLog";

export class PromotionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromotionError";
  }
}

export type PromotionRequest = {
  proposal: ParsedAgentPatchProposal;
  nextVersion: string;
  evaluationRuns: AgentReleaseRecord["evaluationRuns"];
  approvals: ApprovalRecord[];
  stage?: PromotionStage;
  elevated?: boolean;
};

export function canPromote(request: PromotionRequest): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const need = requiredApprovals(
    request.proposal.changeTier,
    request.proposal.requestedRiskClass
  );

  const approved = request.approvals.filter((a) => a.decision === "approved");
  if (approved.length < need) {
    reasons.push(`Need ${need} approval(s), have ${approved.length}`);
  }

  if (request.proposal.requestedRiskClass === "high") {
    const withJustification = approved.filter((a) => (a.justification?.length ?? 0) >= 20);
    if (withJustification.length < need) {
      reasons.push("High-risk promotion requires typed justification (≥20 chars) per approver");
    }
  }

  const evalFailed = request.evaluationRuns.filter((run) => !run.passed);
  if (evalFailed.length > 0) {
    reasons.push(`Failed suites: ${evalFailed.map((r) => r.suite).join(", ")}`);
  }

  return { ok: reasons.length === 0, reasons };
}

export function createReleaseRecord(request: PromotionRequest): AgentReleaseRecord {
  const gate = canPromote(request);
  if (!gate.ok) {
    throw new PromotionError(gate.reasons.join("; "));
  }

  const releaseId = `release-${new Date().toISOString().slice(0, 10)}-${request.proposal.proposalId.slice(-4)}`;

  return {
    releaseId,
    agentId: request.proposal.targetAgentId,
    version: request.nextVersion,
    baseCommitSha: request.proposal.baseCommitSha,
    patchSha256: hashPatchContent(request.proposal.changedFiles),
    proposalId: request.proposal.proposalId,
    evidenceRefs: request.proposal.evidenceRefs,
    evaluationRuns: request.evaluationRuns,
    approvals: request.approvals,
    stage: request.stage ?? "shadow",
    deployedAt: new Date().toISOString(),
  };
}

export function advanceStage(
  release: AgentReleaseRecord,
  target: PromotionStage,
  approvals: ApprovalRecord[]
): AgentReleaseRecord {
  const order: PromotionStage[] = ["shadow", "canary", "production"];
  const currentIdx = order.indexOf(release.stage);
  const targetIdx = order.indexOf(target);
  if (targetIdx <= currentIdx) {
    throw new PromotionError(`Cannot advance from ${release.stage} to ${target}`);
  }
  if (targetIdx - currentIdx > 1) {
    throw new PromotionError("Promotion must advance one stage at a time");
  }

  const gate = canPromote({
    proposal: {
      proposalId: release.proposalId,
      targetAgentId: release.agentId,
      baseAgentVersion: release.version,
      baseCommitSha: release.baseCommitSha,
      changeTier: "policy-update",
      objective: "stage-advance",
      evidenceRefs: release.evidenceRefs,
      changedFiles: [],
      testsAddedOrChanged: [],
      expectedBenefits: [],
      knownRisks: [],
      requestedRiskClass: target === "production" ? "medium" : "low",
    },
    nextVersion: release.version,
    evaluationRuns: release.evaluationRuns,
    approvals,
  });

  if (!gate.ok) {
    throw new PromotionError(gate.reasons.join("; "));
  }

  return {
    ...release,
    stage: target,
    approvals: [...release.approvals, ...approvals],
    deployedAt: new Date().toISOString(),
  };
}

export function rollbackRelease(release: AgentReleaseRecord): AgentReleaseRecord {
  return {
    ...release,
    rolledBackAt: new Date().toISOString(),
  };
}
