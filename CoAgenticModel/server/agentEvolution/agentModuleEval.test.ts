import { describe, expect, it } from "vitest";
import { resolveAgentModuleTestFiles } from "./agentModuleEval";

describe("resolveAgentModuleTestFiles", () => {
  it("prefers explicit testsAddedOrChanged paths", () => {
    const files = resolveAgentModuleTestFiles({
      proposalId: "p1",
      targetAgentId: "intel-interpreter",
      baseAgentVersion: "1.0.0",
      baseCommitSha: "abc",
      changeTier: "agent-module",
      objective: "Improve stub module with packet hash suffix",
      evidenceRefs: ["eval-1"],
      changedFiles: [
        {
          path: "CoAgenticModel/src/agents/intelInterpreter/index.ts",
          patch: "// change",
          reason: "test",
        },
      ],
      testsAddedOrChanged: ["CoAgenticModel/src/agents/intelInterpreter/index.test.ts"],
      expectedBenefits: ["Better traceability"],
      knownRisks: [],
      requestedRiskClass: "low",
    });
    expect(files).toContain("CoAgenticModel/src/agents/intelInterpreter/index.test.ts");
  });
});
