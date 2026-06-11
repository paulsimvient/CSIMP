import { describe, expect, it } from "vitest";
import {
  evaluateProposalAgainstBudget,
  mutationBudgetForTrust,
  trustTierFromLineage,
} from "./mutationBudget";
import type { AgentPatchProposal } from "../../src/types/proposal";

describe("mutationBudget", () => {
  it("blocks agent-module patches at unproven tier", () => {
    const budget = mutationBudgetForTrust("intel-interpreter", "unproven");
    const proposal: AgentPatchProposal = {
      proposalId: "p1",
      targetAgentId: "intel-interpreter",
      baseAgentVersion: "1.0.0",
      baseCommitSha: "abc",
      changeTier: "agent-module",
      objective: "test",
      evidenceRefs: [],
      changedFiles: [{ path: "CoAgenticModel/src/agents/x/index.ts", patch: "x", reason: "r" }],
      testsAddedOrChanged: [],
      expectedBenefits: [],
      knownRisks: [],
      requestedRiskClass: "low",
    };
    const result = evaluateProposalAgainstBudget(proposal, budget);
    expect(result.allowed).toBe(false);
  });

  it("allows policy-only at unproven tier", () => {
    const budget = mutationBudgetForTrust("intel-interpreter", "unproven");
    const proposal: AgentPatchProposal = {
      proposalId: "p1",
      targetAgentId: "intel-interpreter",
      baseAgentVersion: "1.0.0",
      baseCommitSha: "abc",
      changeTier: "policy-update",
      objective: "test",
      evidenceRefs: [],
      changedFiles: [],
      testsAddedOrChanged: [],
      expectedBenefits: [],
      knownRisks: [],
      requestedRiskClass: "low",
      policyChanges: [
        {
          path: "policies/agents/intel-interpreter/attribution.json",
          operation: "add-rule",
          rule: "test rule",
        },
      ],
    };
    expect(evaluateProposalAgainstBudget(proposal, budget).allowed).toBe(true);
  });

  it("upgrades trust tier with production releases and passports", () => {
    expect(
      trustTierFromLineage({
        agentId: "intel-interpreter",
        lineageId: "l",
        generation: 2,
        trustTier: "unproven",
        productionReleases: 2,
        passportsIssued: 2,
        shadowDaysSurvived: 15,
      })
    ).toBe("highly-trusted");
  });
});
