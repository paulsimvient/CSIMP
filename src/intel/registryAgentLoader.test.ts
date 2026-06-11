import { describe, expect, it } from "vitest";
import type { ScenarioPacket } from "./types";
import { runRegistryAgentModule } from "./registryAgentLoader";

const samplePacket: ScenarioPacket = {
  commanderIntent: "Defend sea lanes",
  observedFacts: [
    {
      id: "fact_uas_001",
      domain: "air",
      entity: "UAS",
      event: "contact",
      time: "2026-06-04T12:00:00Z",
      source: "radar",
      confidence: "medium",
      severity: "medium",
    },
  ],
  knownAssets: ["asset-1"],
  constraints: [],
  agentId: "intel-interpreter",
  agentVersion: "1.0.0",
  moduleEntrypoint: "src/agents/intelInterpreter/index.ts",
};

describe("registryAgentLoader", () => {
  it("invokes intel-interpreter module stub when entrypoint is declared", () => {
    const output = runRegistryAgentModule(
      {
        agentId: "intel-interpreter",
        agentVersion: "1.0.0",
        moduleEntrypoint: "src/agents/intelInterpreter/index.ts",
      },
      samplePacket
    );
    expect(output?.interpretationRef).toMatch(/^stub-/);
    expect(output?.interpretationRef).toContain("-facts");
  });

  it("returns undefined for agents without a bundled module", () => {
    const output = runRegistryAgentModule(
      { agentId: "coa-planner", agentVersion: "1.0.0" },
      samplePacket
    );
    expect(output).toBeUndefined();
  });
});
