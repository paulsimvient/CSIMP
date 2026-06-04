import { describe, expect, it } from "vitest";
import { defaultEffectsEngine } from "./effects";
import type { CoaAction, CoaCandidate } from "./types";

describe("defaultEffectsEngine cyber adapter integration", () => {
  it("attaches simulated cyber effects for cyber COAs with cited facts", async () => {
    const candidate = makeSatCandidate("coa-cyber", [
      makeAction("ia_cyber", "Investigate authentication anomalies", "cyber"),
    ]);

    const results = await defaultEffectsEngine([candidate], {
      intelActions: [
        {
          id: "ia_cyber",
          description: "Investigate authentication anomalies",
          citedFacts: ["fact_cyber_001"],
          actionType: "investigate",
        },
      ],
    });

    const effect = results["coa-cyber"];
    expect(effect).toBeDefined();
    expect(effect?.summary.cyberEffects?.executionMode).toBe("simulation");
    expect(effect?.summary.cyberEffects?.provider).toBe("simulated");
    expect(effect?.summary.cyberEffects?.citedFactIds).toContain("fact_cyber_001");
    expect(effect?.summary.cyberEffects?.techniquesEvaluated.length).toBeGreaterThan(0);
  });

  it("uses atomic-red-team when lab options are provided", async () => {
    const candidate = makeSatCandidate("coa-lab", [
      makeAction("ia_cyber", "Investigate authentication anomalies", "cyber"),
    ]);

    const results = await defaultEffectsEngine([candidate], {
      intelActions: [
        {
          id: "ia_cyber",
          description: "Investigate authentication anomalies",
          citedFacts: ["fact_cyber_001"],
          actionType: "investigate",
        },
      ],
      cyberEmulation: {
        provider: "atomic-red-team",
        humanApproved: true,
        labEnvironmentConfirmed: true,
      },
    });

    const effect = results["coa-lab"];
    expect(effect?.summary.cyberEffects?.executionMode).toBe("in-process-simulation");
    expect(effect?.summary.cyberEffects?.provider).toBe("atomic-red-team");
    expect(effect?.summary.cyberEffects?.atomicTestsExecuted?.length).toBeGreaterThan(0);
  });
});

function makeSatCandidate(id: string, actions: CoaAction[]): CoaCandidate {
  return {
    id,
    runId: "run-test",
    status: "sat",
    label: "COA 1",
    selectedActions: actions,
    logisticsPlan: {
      kind: "populated",
      source: "validated-intel",
      coaId: id,
      lanes: [{ id: "lane-1", label: "Cyber", chipIds: [] }],
      chips: [],
      totalDuration: 3600,
    },
    scores: { feasibility: 1, logistics: 0.8, effects: 0, risk: 0, overall: 0.5 },
  };
}

function makeAction(id: string, name: string, type: string): CoaAction {
  return {
    id,
    name,
    type,
    startTime: 0,
    duration: 1800,
    resources: ["cyber-team"],
  };
}
