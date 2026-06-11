import type { AgentReleaseRecord } from "../../src/types/release";
import type { AuditLog } from "./auditLog";
import { createInMemoryAuditLog } from "./auditLog";
import type { ParsedAgentPatchProposal } from "./proposalSchema";
import { safeParseAgentPatchProposal } from "./proposalSchema";
import { evaluatePathPolicy } from "./policy";
import { runStaticAnalysis } from "./staticAnalysis";
import { allEvaluationsPassed, evaluateProposal } from "./evaluate";
import { createReleaseRecord, type PromotionRequest } from "./promote";
import { assertWorkspaceSafeEnv, createIsolatedWorkspace } from "./workspace";
import { applyChangedFiles } from "./applyPatch";
import { scoreShadowRun } from "./shadow";
import type { ShadowSafetyMetrics } from "../../src/types/shadow";

export type PipelineStageResult =
  | { stage: "schema"; ok: true; proposal: ParsedAgentPatchProposal }
  | { stage: "schema"; ok: false; errors: string[] }
  | { stage: "policy"; ok: boolean; errors: string[]; warnings: string[] }
  | { stage: "static-analysis"; ok: boolean; findings: string[] }
  | { stage: "evaluation"; ok: boolean; runs: AgentReleaseRecord["evaluationRuns"] }
  | { stage: "promotion"; ok: true; release: AgentReleaseRecord }
  | { stage: "promotion"; ok: false; reasons: string[] };

export type EvolutionPipelineOptions = {
  repoRoot: string;
  auditLog?: AuditLog;
  elevated?: boolean;
  skipEvaluation?: boolean;
};

export type ProcessProposalInput = {
  rawProposal: unknown;
  nextVersion: string;
  approvals: PromotionRequest["approvals"];
};

export class AgentEvolutionPipeline {
  private readonly audit: AuditLog;
  private readonly repoRoot: string;
  private readonly elevated: boolean;
  private readonly skipEvaluation: boolean;

  constructor(options: EvolutionPipelineOptions) {
    this.repoRoot = options.repoRoot;
    this.audit = options.auditLog ?? createInMemoryAuditLog();
    this.elevated = options.elevated ?? false;
    this.skipEvaluation = options.skipEvaluation ?? false;
  }

  get auditLog(): AuditLog {
    return this.audit;
  }

  async processProposal(input: ProcessProposalInput): Promise<PipelineStageResult[]> {
    const results: PipelineStageResult[] = [];

    const parsed = safeParseAgentPatchProposal(input.rawProposal);
    if (!parsed.success) {
      const errors = parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`
      );
      results.push({ stage: "schema", ok: false, errors });
      await this.audit.append({
        type: "proposal-rejected",
        detail: { reason: "schema", errors },
      });
      return results;
    }

    const proposal = parsed.data;
    results.push({ stage: "schema", ok: true, proposal });

    await this.audit.append({
      type: "proposal-received",
      proposalId: proposal.proposalId,
      detail: {
        targetAgentId: proposal.targetAgentId,
        changeTier: proposal.changeTier,
        requestedRiskClass: proposal.requestedRiskClass,
      },
    });

    const paths =
      proposal.changeTier === "policy-update"
        ? (proposal.policyChanges ?? []).map((c) => c.path)
        : proposal.changedFiles.map((f) => f.path);

    const policy = evaluatePathPolicy(paths, proposal.changeTier, this.elevated);
    results.push({
      stage: "policy",
      ok: policy.allowed,
      errors: policy.errors,
      warnings: policy.warnings,
    });

    if (!policy.allowed) {
      await this.audit.append({
        type: "policy-denied",
        proposalId: proposal.proposalId,
        detail: { errors: policy.errors, deniedPaths: policy.deniedPaths },
      });
      return results;
    }

    const staticResult = runStaticAnalysis(proposal);
    results.push({
      stage: "static-analysis",
      ok: staticResult.passed,
      findings: staticResult.findings,
    });
    if (!staticResult.passed) {
      await this.audit.append({
        type: "proposal-rejected",
        proposalId: proposal.proposalId,
        detail: { reason: "static-analysis", findings: staticResult.findings },
      });
      return results;
    }

    let evaluationRuns: AgentReleaseRecord["evaluationRuns"] = [];
    if (!this.skipEvaluation && proposal.changeTier === "agent-module") {
      assertWorkspaceSafeEnv();
      const workspace = await createIsolatedWorkspace(this.repoRoot);
      try {
        await this.audit.append({
          type: "evaluation-started",
          proposalId: proposal.proposalId,
          detail: { workspaceId: workspace.id, tier: "agent-module" },
        });
        await applyChangedFiles(workspace.rootDir, this.repoRoot, proposal.changedFiles);
        const evalRoot = workspace.kind === "git-worktree" ? workspace.rootDir : this.repoRoot;
        evaluationRuns = await evaluateProposal(proposal, { repoRoot: evalRoot });
      } finally {
        await workspace.dispose();
      }
      await this.audit.append({
        type: "evaluation-completed",
        proposalId: proposal.proposalId,
        detail: { runs: evaluationRuns },
      });
    } else if (!this.skipEvaluation && proposal.changeTier !== "policy-update") {
      assertWorkspaceSafeEnv();
      const workspace = await createIsolatedWorkspace(this.repoRoot);
      try {
        await this.audit.append({
          type: "evaluation-started",
          proposalId: proposal.proposalId,
          detail: { workspaceId: workspace.id },
        });
        evaluationRuns = await evaluateProposal(proposal, {
          repoRoot: this.repoRoot,
        });
      } finally {
        await workspace.dispose();
      }
      await this.audit.append({
        type: "evaluation-completed",
        proposalId: proposal.proposalId,
        detail: { runs: evaluationRuns },
      });
    } else if (proposal.changeTier === "policy-update") {
      evaluationRuns = [
        {
          suite: "policy-schema",
          passed: true,
          metrics: { durationMs: 0 },
          reportArtifact: "policy-only",
        },
      ];
    }

    const evalOk = allEvaluationsPassed(evaluationRuns) || proposal.changeTier === "policy-update";
    results.push({ stage: "evaluation", ok: evalOk, runs: evaluationRuns });
    if (!evalOk) {
      return results;
    }

    try {
      const release = createReleaseRecord({
        proposal,
        nextVersion: input.nextVersion,
        evaluationRuns,
        approvals: input.approvals,
        stage: "shadow",
        elevated: this.elevated,
      });
      results.push({ stage: "promotion", ok: true, release });
      await this.audit.append({
        type: "promoted",
        proposalId: proposal.proposalId,
        releaseId: release.releaseId,
        detail: { stage: release.stage, version: release.version },
      });
    } catch (err) {
      const reasons = [err instanceof Error ? err.message : String(err)];
      results.push({ stage: "promotion", ok: false, reasons });
    }

    return results;
  }

  async recordShadowComparison(input: {
    releaseId: string;
    productionVersion: string;
    candidateVersion: string;
    scenarioId: string;
    candidate: ShadowSafetyMetrics;
    production: ShadowSafetyMetrics;
    latencyMs: number;
    productionLatencyMs: number;
  }) {
    const comparison = scoreShadowRun(input);
    await this.audit.append({
      type: "shadow-run",
      releaseId: input.releaseId,
      detail: comparison as unknown as Record<string, unknown>,
    });
    return comparison;
  }
}

export { safeParseAgentPatchProposal, parseAgentPatchProposal } from "./proposalSchema";
export * from "./policy";
export * from "./auditLog";
export * from "./promote";
export * from "./shadow";
export * from "./evaluate";
export * from "./workspace";
