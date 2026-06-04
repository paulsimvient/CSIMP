import { describe, expect, it } from "vitest";
import { buildRevisionEffects } from "./effects";
import { evaluateScheduledRevision } from "./validatedIntelSolver";
import { revalidateOperatorWithPipeline } from "./operatorPipelineRevalidation";
import type { CoaCandidate, EffectsEngineFn } from "./types";

const instantEffects: EffectsEngineFn = async (candidates) =>
  Object.fromEntries(candidates.map((c) => [c.id, buildRevisionEffects(c)]));

function satCandidate(): CoaCandidate {
  return {
    id: "op-1",
    runId: "run-1",
    origin: "operator-modified",
    status: "sat",
    validationStatus: "unvalidated",
    label: "Operator mod",
    selectedActions: [
      {
        id: "a1",
        name: "Observe",
        type: "observe",
        startTime: 0,
        duration: 600,
        resources: ["uav-1"],
      },
    ],
    logisticsPlan: { kind: "empty", reason: "no-actions" },
    scores: { feasibility: 1, logistics: 0.8, effects: 0, risk: 0.2, overall: 0.7 },
  };
}

describe("operatorPipelineRevalidation", () => {
  it("flags overlapping assets as unsat", () => {
    const result = evaluateScheduledRevision(
      [
        {
          id: "a1",
          name: "One",
          type: "observe",
          startTime: 0,
          duration: 600,
          resources: ["uav-1"],
        },
        {
          id: "a2",
          name: "Two",
          type: "observe",
          startTime: 300,
          duration: 600,
          resources: ["uav-1"],
        },
      ],
      { runId: "run-1", signals: [], mode: "validated-intel" }
    );
    expect(result.status).toBe("unsat");
  });

  it("applies effects and intel fidelity scoring on valid revisions", async () => {
    const rescored = await revalidateOperatorWithPipeline(satCandidate(), {}, {
      effectsEngine: instantEffects,
    });
    expect(rescored.status).toBe("sat");
    expect(rescored.scores.effects).toBeGreaterThan(0);
    expect(rescored.constraintTrace).toBeDefined();
  });
});
