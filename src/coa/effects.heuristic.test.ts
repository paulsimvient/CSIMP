import { describe, expect, it } from "vitest";
import { defaultEffectsEngine } from "./effects";
import type { CoaAction, CoaCandidate } from "./types";

describe("effects heuristic metadata", () => {
  it("tags effects output as deterministic heuristic estimates", async () => {
    const candidate = makeSatCandidate("coa-heuristic", [
      makeAction("ia_1", "Monitor port activity", "monitor"),
    ]);

    const results = await defaultEffectsEngine([candidate], {
      intelActions: [
        {
          id: "ia_1",
          description: "Monitor port activity",
          citedFacts: ["fact_1"],
          actionType: "monitor",
        },
      ],
    });

    const effect = results["coa-heuristic"];
    expect(effect?.summary.estimationMethod).toBe("deterministic-heuristic");
    expect(effect?.summary.isValidatedPrediction).toBe(false);
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
      lanes: [{ id: "lane-1", label: "Ops", chipIds: [] }],
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
    resources: ["team-a"],
  };
}
