import { describe, expect, it } from "vitest";
import { safeParseAgentPatchProposal } from "./proposalSchema";

const validPolicyProposal = {
  proposalId: "prop-001",
  targetAgentId: "intel-interpreter",
  baseAgentVersion: "1.0.0",
  baseCommitSha: "abc1234",
  changeTier: "policy-update" as const,
  objective: "Reduce attribution errors observed in eval-run-188 grounding failures.",
  evidenceRefs: ["eval-run-188", "grounding-failure-94"],
  changedFiles: [],
  testsAddedOrChanged: [],
  expectedBenefits: ["Fewer unsupported attribution claims"],
  knownRisks: ["May increase conservative monitoring recommendations"],
  requestedRiskClass: "low" as const,
  policyChanges: [
    {
      path: "policies/agents/intel-interpreter/attribution.json",
      operation: "add-rule" as const,
      rule: "Do not infer attribution from a single degraded source.",
    },
  ],
};

describe("agentPatchProposalSchema", () => {
  it("accepts valid Tier A policy proposal", () => {
    const parsed = safeParseAgentPatchProposal(validPolicyProposal);
    expect(parsed.success).toBe(true);
  });

  it("rejects policy-update with changedFiles", () => {
    const parsed = safeParseAgentPatchProposal({
      ...validPolicyProposal,
      changedFiles: [{ path: "src/agents/x.ts", patch: "x", reason: "y" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects agent-module without changedFiles", () => {
    const parsed = safeParseAgentPatchProposal({
      ...validPolicyProposal,
      changeTier: "agent-module",
      policyChanges: undefined,
    });
    expect(parsed.success).toBe(false);
  });
});
