import { describe, expect, it } from "vitest";
import type { CriticReport } from "../../src/types/actorCritic";
import type { AgentPatchProposal } from "../../src/types/proposal";
import { reviseProposal } from "./actor";

function agentModuleProposal(overrides: Partial<AgentPatchProposal> = {}): AgentPatchProposal {
  return {
    proposalId: "prop-agent-001",
    targetAgentId: "intel-interpreter",
    baseAgentVersion: "1.0.0",
    baseCommitSha: "abc123",
    changeTier: "agent-module",
    objective: "Improve stub traceability",
    evidenceRefs: ["ev-1"],
    changedFiles: [
      {
        path: "src/agents/intelInterpreter/index.ts",
        patch: "export const x = 1;\n",
        reason: "wrong path prefix",
      },
    ],
    testsAddedOrChanged: [],
    expectedBenefits: ["Better refs"],
    knownRisks: ["Format change"],
    requestedRiskClass: "low",
    ...overrides,
  };
}

function criticWith(codes: string[]): CriticReport {
  return {
    round: 1,
    proposalId: "prop-agent-001",
    passed: false,
    score: 0.4,
    findings: codes.map((code) => ({
      dimension: "policy-path",
      severity: "blocker" as const,
      code,
      message: code,
      remediation:
        code === "static.other"
          ? "Include testsAddedOrChanged referencing new or updated test files."
          : "Move changes under CoAgenticModel/src/agents/",
    })),
    evalRuns: [],
  };
}

describe("actor agent-module revisions", () => {
  it("corrects src/agents paths to CoAgenticModel scope", async () => {
    const result = await reviseProposal(
      {
        sessionId: "sess-1",
        round: 1,
        objective: "Improve stub",
        evidenceRefs: ["ev-1"],
        priorProposal: agentModuleProposal(),
        criticReport: criticWith(["policy.path-denied"]),
      },
      "deterministic"
    );

    expect(result.revised).toBe(true);
    expect(result.proposal?.changedFiles[0]?.path).toBe(
      "CoAgenticModel/src/agents/intelInterpreter/index.ts"
    );
  });

  it("adds testsAddedOrChanged when static analysis requires tests", async () => {
    const result = await reviseProposal(
      {
        sessionId: "sess-1",
        round: 1,
        objective: "Improve stub",
        evidenceRefs: ["ev-1"],
        priorProposal: agentModuleProposal(),
        criticReport: criticWith(["static.other"]),
      },
      "deterministic"
    );

    expect(result.revised).toBe(true);
    expect(result.proposal?.testsAddedOrChanged.length).toBeGreaterThan(0);
    expect(result.proposal?.testsAddedOrChanged[0]).toContain("intelInterpreter");
  });

  it("stalls on dangerous-pattern blockers", async () => {
    const result = await reviseProposal(
      {
        sessionId: "sess-1",
        round: 1,
        objective: "Improve stub",
        evidenceRefs: ["ev-1"],
        priorProposal: agentModuleProposal(),
        criticReport: {
          round: 1,
          proposalId: "prop-agent-001",
          passed: false,
          score: 0.1,
          findings: [
            {
              dimension: "static-analysis",
              severity: "blocker",
              code: "static.dangerous-pattern",
              message: "Dangerous pattern",
            },
          ],
          evalRuns: [],
        },
      },
      "deterministic"
    );

    expect(result.revised).toBe(false);
    expect(result.stallReason).toContain("human");
  });
});
