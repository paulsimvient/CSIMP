import { describe, expect, it } from "vitest";
import { reviseProposal } from "./actor";
import type { AgentPatchProposal } from "../../src/types/proposal";
import type { CriticReport } from "../../src/types/actorCritic";

const BASE_PROPOSAL: AgentPatchProposal = {
  proposalId: "prop-test-001",
  targetAgentId: "intel-interpreter",
  baseAgentVersion: "1.0.0",
  baseCommitSha: "7756912aa664",
  changeTier: "policy-update",
  objective: "Strengthen attribution corroboration after grounding failures",
  evidenceRefs: ["eval-run-188"],
  changedFiles: [],
  testsAddedOrChanged: [],
  expectedBenefits: ["Fewer unsupported attribution inferences"],
  knownRisks: ["More conservative recommendations"],
  requestedRiskClass: "low",
  policyChanges: [
    {
      path: "policies/agents/intel-interpreter/attribution.json",
      operation: "add-rule",
      rule: "Do not infer attribution from a single degraded source.",
    },
  ],
};

function criticWith(
  items: Array<{ code: string; rule?: string }>
): CriticReport {
  return {
    round: 1,
    proposalId: BASE_PROPOSAL.proposalId,
    passed: false,
    score: 0.4,
    findings: items.map(({ code, rule }) => ({
      dimension: "policy-coherence",
      severity: "blocker" as const,
      code,
      message: code,
      evidence: rule ? { rule } : undefined,
    })),
    evalRuns: [],
  };
}

describe("deterministic actor revisions", () => {
  it("drops redundant rules and proposes a novel guardrail", async () => {
    const result = await reviseProposal(
      {
        sessionId: "sess-1",
        round: 1,
        objective: BASE_PROPOSAL.objective,
        evidenceRefs: BASE_PROPOSAL.evidenceRefs,
        priorProposal: BASE_PROPOSAL,
        criticReport: criticWith([
          {
            code: "policy.rule-already-present",
            rule: "Do not infer attribution from a single degraded source.",
          },
        ]),
      },
      "deterministic"
    );

    expect(result.revised).toBe(true);
    expect(result.proposal?.policyChanges?.length).toBeGreaterThan(0);
    expect(
      result.proposal?.policyChanges?.some(
        (c) =>
          c.rule !== "Do not infer attribution from a single degraded source."
      )
    ).toBe(true);
    expect(result.proposal?.proposalId).toMatch(/-r2$/);
  });

  it("deduplicates identical add-rule entries", async () => {
    const duplicateProposal: AgentPatchProposal = {
      ...BASE_PROPOSAL,
      policyChanges: [
        {
          path: "policies/agents/intel-interpreter/attribution.json",
          operation: "add-rule",
          rule: "Require corroboration from two independent sources before attribution claims.",
        },
        {
          path: "policies/agents/intel-interpreter/attribution.json",
          operation: "add-rule",
          rule: "Require corroboration from two independent sources before attribution claims.",
        },
      ],
    };

    const result = await reviseProposal(
      {
        sessionId: "sess-2",
        round: 1,
        objective: duplicateProposal.objective,
        evidenceRefs: duplicateProposal.evidenceRefs,
        priorProposal: duplicateProposal,
        criticReport: criticWith([{ code: "policy.duplicate-in-proposal" }]),
      },
      "deterministic"
    );

    expect(result.revised).toBe(true);
    const rules = result.proposal?.policyChanges?.map((c) => c.rule) ?? [];
    expect(rules.filter((r) => r?.includes("corroboration")).length).toBe(1);
  });
});
