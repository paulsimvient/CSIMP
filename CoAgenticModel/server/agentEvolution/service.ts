import { join } from "node:path";
import type { ApprovalRecord, AgentReleaseRecord, PromotionStage } from "../../src/types/release";
import { applyPolicyVersion } from "./applyPolicy";
import { applyChangedFiles, materializeAgentModulePatches } from "./applyPatch";
import type { AuditLog } from "./auditLog";
import { createFileAuditLog, createInMemoryAuditLog } from "./auditLog";
import { runAgentEvalSuites } from "./evalAgents";
import { evaluateProposal } from "./evaluate";
import {
  AgentEvolutionPipeline,
  type PipelineStageResult,
  type ProcessProposalInput,
} from "./index";
import { listAgentIds, listAgentVersions, loadRegistryAgent } from "./registry";
import { loadPolicyBundle } from "./loadPolicyBundle";
import { createFileReleaseStore, createInMemoryReleaseStore, type ReleaseStore } from "./releaseStore";
import { advanceStage, rollbackRelease } from "./promote";
import { assertWorkspaceSafeEnv, createIsolatedWorkspace } from "./workspace";
import { runActorCriticLoop, type ActorCriticInput } from "./actorCriticLoop";

export type AgentEvolutionServiceOptions = {
  coda2Root: string;
  dataDir?: string;
  skipEvaluation?: boolean;
};

export type AgentSummary = {
  id: string;
  versions: string[];
  productionVersion?: string;
};

export class AgentEvolutionService {
  readonly coda2Root: string;
  private readonly pipeline: AgentEvolutionPipeline;
  private readonly releases: ReleaseStore;
  private readonly audit: AuditLog;
  private productionByAgent = new Map<string, string>();
  private productionHydrated = false;

  constructor(options: AgentEvolutionServiceOptions) {
    this.coda2Root = options.coda2Root;
    const dataDir = options.dataDir ?? join(options.coda2Root, "CoAgenticModel", ".data");
    this.audit = createFileAuditLog(dataDir);
    this.releases = createFileReleaseStore(dataDir);
    this.pipeline = new AgentEvolutionPipeline({
      repoRoot: options.coda2Root,
      auditLog: this.audit,
      skipEvaluation: options.skipEvaluation,
    });
  }

  get auditLog(): AuditLog {
    return this.audit;
  }

  private async hydrateProductionFromReleases(): Promise<void> {
    this.productionByAgent.clear();
    const all = await this.releases.list();
    const latestProduction = new Map<string, AgentReleaseRecord>();
    for (const release of all) {
      if (release.stage !== "production" || release.rolledBackAt) continue;
      const existing = latestProduction.get(release.agentId);
      if (!existing || (release.deployedAt ?? "") > (existing.deployedAt ?? "")) {
        latestProduction.set(release.agentId, release);
      }
    }
    for (const [agentId, release] of latestProduction) {
      this.productionByAgent.set(agentId, release.version);
    }
    this.productionHydrated = true;
  }

  private async ensureProductionHydrated(): Promise<void> {
    if (!this.productionHydrated) {
      await this.hydrateProductionFromReleases();
    }
  }

  async resolveProductionVersion(agentId: string): Promise<string | undefined> {
    await this.ensureProductionHydrated();
    if (this.productionByAgent.has(agentId)) {
      return this.productionByAgent.get(agentId);
    }
    const versions = await listAgentVersions(this.coda2Root, agentId);
    return versions.at(-1);
  }

  async getProductionBundle(agentId: string, versionOverride?: string) {
    await this.ensureProductionHydrated();
    const version = versionOverride ?? (await this.resolveProductionVersion(agentId));
    if (!version) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    const releases = await this.releases.list();
    const prodRelease = releases.find(
      (release) =>
        release.agentId === agentId &&
        release.version === version &&
        release.stage === "production" &&
        !release.rolledBackAt
    );
    return loadPolicyBundle(this.coda2Root, agentId, version, prodRelease?.releaseId);
  }

  async listAgents(): Promise<AgentSummary[]> {
    await this.ensureProductionHydrated();
    const ids = await listAgentIds(this.coda2Root);
    const summaries: AgentSummary[] = [];
    for (const id of ids) {
      const versions = await listAgentVersions(this.coda2Root, id);
      summaries.push({
        id,
        versions,
        productionVersion: this.productionByAgent.get(id) ?? versions.at(-1),
      });
    }
    return summaries;
  }

  async getAgent(agentId: string, version: string) {
    return loadRegistryAgent(this.coda2Root, agentId, version);
  }

  async listReleases(): Promise<AgentReleaseRecord[]> {
    return this.releases.list();
  }

  async listAudit(filter?: { proposalId?: string; releaseId?: string }) {
    return this.audit.list(filter);
  }

  async validateProposal(input: ProcessProposalInput): Promise<PipelineStageResult[]> {
    const pipeline = new AgentEvolutionPipeline({
      repoRoot: this.coda2Root,
      auditLog: createInMemoryAuditLog(),
      skipEvaluation: true,
    });
    return pipeline.processProposal(input);
  }

  async evolveProposal(input: ActorCriticInput & {
    autoProcessOnConverge?: boolean;
    nextVersion?: string;
    approvals?: ProcessProposalInput["approvals"];
  }) {
    const session = await runActorCriticLoop(input, {
      repoRoot: this.coda2Root,
      auditLog: this.audit,
    });

    let processResult: Awaited<ReturnType<AgentEvolutionService["processProposal"]>> | undefined;
    if (
      input.autoProcessOnConverge &&
      session.status === "converged" &&
      session.finalProposal &&
      input.nextVersion
    ) {
      processResult = await this.processProposal({
        rawProposal: session.finalProposal,
        nextVersion: input.nextVersion,
        approvals: input.approvals ?? [],
      });
    }

    return { session, processResult };
  }

  async processProposal(input: ProcessProposalInput): Promise<{
    stages: PipelineStageResult[];
    release?: AgentReleaseRecord;
  }> {
    const stages = await this.pipeline.processProposal(input);
    const promotionStage = stages.find(
      (stage): stage is Extract<PipelineStageResult, { stage: "promotion"; ok: true }> =>
        stage.stage === "promotion" && stage.ok
    );
    if (!promotionStage) {
      return { stages };
    }

    const proposalStage = stages.find(
      (stage): stage is Extract<PipelineStageResult, { stage: "schema"; ok: true }> =>
        stage.stage === "schema" && stage.ok
    );
    if (!proposalStage) {
      return { stages, release: promotionStage.release };
    }

    const proposal = proposalStage.proposal;
    let writtenFiles: string[] = [];
    let release = promotionStage.release;

    if (proposal.changeTier === "policy-update" && proposal.policyChanges) {
      writtenFiles = await applyPolicyVersion(
        this.coda2Root,
        proposal.targetAgentId,
        proposal.baseAgentVersion,
        input.nextVersion,
        proposal.policyChanges
      );

      const evalRuns = await runAgentEvalSuites(
        this.coda2Root,
        proposal.targetAgentId,
        ["regression"]
      );
      release = { ...release, evaluationRuns: [...release.evaluationRuns, ...evalRuns] };
      if (evalRuns.some((run) => !run.passed)) {
        return {
          stages: [
            ...stages.filter((s) => s.stage !== "promotion"),
            { stage: "evaluation", ok: false, runs: evalRuns },
          ],
        };
      }
    } else if (proposal.changedFiles.length > 0) {
      assertWorkspaceSafeEnv();
      const workspace = await createIsolatedWorkspace(this.coda2Root);
      try {
        await applyChangedFiles(workspace.rootDir, this.coda2Root, proposal.changedFiles);
        const evalRoot = workspace.kind === "git-worktree" ? workspace.rootDir : this.coda2Root;
        const evalRuns = await evaluateProposal(proposal, { repoRoot: evalRoot });
        release = { ...release, evaluationRuns: evalRuns };
        if (evalRuns.some((run) => !run.passed)) {
          return {
            stages: [
              ...stages.filter((s) => s.stage !== "promotion"),
              { stage: "evaluation", ok: false, runs: evalRuns },
            ],
          };
        }
        writtenFiles = await materializeAgentModulePatches(
          this.coda2Root,
          proposal.changedFiles
        );
      } finally {
        await workspace.dispose();
      }
    }

    await this.releases.save(release);
    await this.audit.append({
      type: "promoted",
      proposalId: proposal.proposalId,
      releaseId: release.releaseId,
      detail: { writtenFiles, stage: release.stage },
    });

    return { stages, release };
  }

  async advanceRelease(input: {
    releaseId: string;
    targetStage: PromotionStage;
    approval: ApprovalRecord;
  }): Promise<AgentReleaseRecord> {
    const updated = await this.releases.update(input.releaseId, (current) =>
      advanceStage(current, input.targetStage, [input.approval])
    );

    if (input.targetStage === "production") {
      this.productionByAgent.set(updated.agentId, updated.version);
    }

    await this.audit.append({
      type: "promoted",
      releaseId: updated.releaseId,
      actorId: input.approval.reviewerId,
      detail: { stage: updated.stage },
    });

    return updated;
  }

  async rollbackRelease(input: {
    releaseId: string;
    approval: ApprovalRecord;
  }): Promise<AgentReleaseRecord> {
    const updated = await this.releases.update(input.releaseId, (current) => {
      const rolled = rollbackRelease(current);
      return {
        ...rolled,
        approvals: [...rolled.approvals, input.approval],
      };
    });

    if (this.productionByAgent.get(updated.agentId) === updated.version) {
      this.productionByAgent.delete(updated.agentId);
      this.productionHydrated = false;
      await this.hydrateProductionFromReleases();
    }

    await this.audit.append({
      type: "rolled-back",
      releaseId: updated.releaseId,
      actorId: input.approval.reviewerId,
      detail: { version: updated.version },
    });

    return updated;
  }
}
