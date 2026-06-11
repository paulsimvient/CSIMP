import { describe, expect, it } from "vitest";
import { AgentEvolutionPipeline } from "./index";
import { join } from "node:path";

const policyProposal = {
  proposalId: "prop-shadow-001",
  targetAgentId: "intel-interpreter",
  baseAgentVersion: "1.0.0",
  baseCommitSha: "abc1234",
  changeTier: "policy-update" as const,
  objective: "Tighten attribution policy after grounding failure cluster eval-run-188.",
  evidenceRefs: ["eval-run-188"],
  changedFiles: [],
  testsAddedOrChanged: [],
  expectedBenefits: ["Improved grounding pass rate"],
  knownRisks: [],
  requestedRiskClass: "low" as const,
  policyChanges: [
    {
      path: "policies/agents/intel-interpreter/attribution.json",
      operation: "add-rule" as const,
      rule: "Do not infer attribution from a single degraded source.",
    },
  ],
};

describe("AgentEvolutionPipeline", () => {
  it("promotes valid policy proposal to shadow release with approval", async () => {
    const repoRoot = join(import.meta.dirname, "../..");
    const pipeline = new AgentEvolutionPipeline({
      repoRoot,
      skipEvaluation: true,
    });

    const results = await pipeline.processProposal({
      rawProposal: policyProposal,
      nextVersion: "1.1.0",
      approvals: [
        {
          reviewerId: "operator-1",
          decision: "approved",
          timestamp: new Date().toISOString(),
        },
      ],
    });

    const promotion = results.find((r) => r.stage === "promotion");
    expect(promotion?.ok).toBe(true);
    if (promotion?.ok) {
      expect(promotion.release.stage).toBe("shadow");
      expect(promotion.release.version).toBe("1.1.0");
    }

    const audit = await pipeline.auditLog.list({ proposalId: "prop-shadow-001" });
    expect(audit.some((e) => e.type === "promoted")).toBe(true);
  });

  it("rejects proposals that touch blocked paths", async () => {
    const pipeline = new AgentEvolutionPipeline({
      repoRoot: join(import.meta.dirname, "../.."),
      skipEvaluation: true,
    });

    const results = await pipeline.processProposal({
      rawProposal: {
        ...policyProposal,
        proposalId: "prop-bad-001",
        changeTier: "agent-module",
        policyChanges: undefined,
        changedFiles: [
          {
            path: "server/llmProxy.ts",
            patch: "// malicious",
            reason: "should fail",
          },
        ],
        testsAddedOrChanged: ["server/llmProxy.test.ts"],
      },
      nextVersion: "9.9.9",
      approvals: [
        {
          reviewerId: "operator-1",
          decision: "approved",
          timestamp: new Date().toISOString(),
        },
      ],
    });

    const policy = results.find((r) => r.stage === "policy");
    expect(policy?.ok).toBe(false);
  });
});
