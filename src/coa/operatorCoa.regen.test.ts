import { describe, expect, it } from "vitest";
import { preserveOperatorCoasOnPipeline } from "./operatorCoaActions";
import { isOperatorCandidate } from "./operatorCoa";
import type { CoaCandidate, CoaState } from "./types";

function operatorDraft(): CoaCandidate {
  return {
    id: "operator-draft-1",
    runId: "run-old",
    origin: "operator-authored",
    status: "sat",
    validationStatus: "validated",
    label: "Operator COA — Draft 1",
    revisionId: "rev-op-1",
    selectedActions: [],
    logisticsPlan: { kind: "empty", reason: "no-actions" },
    scores: { feasibility: 0, logistics: 0, effects: 0, risk: 0, overall: 0 },
  };
}

describe("preserveOperatorCoasOnPipeline", () => {
  it("keeps operator COAs and marks them stale after regeneration", () => {
    const previous: CoaState = {
      status: "ready",
      candidatesById: {
        "coa-auto-new": {
          id: "coa-auto-new",
          runId: "run-new",
          origin: "automated",
          status: "sat",
          label: "COA 1",
          revisionId: "rev-a",
          selectedActions: [],
          logisticsPlan: { kind: "empty", reason: "no-actions" },
          scores: { feasibility: 1, logistics: 0.8, effects: 0, risk: 0, overall: 0.5 },
        },
        "operator-draft-1": operatorDraft(),
      },
      candidateOrder: ["coa-auto-new", "operator-draft-1"],
      matrixOverlaysByCoaId: {
        "operator-draft-1": {
          revisionId: "rev-op-1",
          manualEntries: [],
          barPatches: {},
          hiddenBarIds: [],
          modifiedBarIds: [],
        },
      },
    };

    const generated: CoaState = {
      status: "ready",
      candidatesById: {
        "coa-auto-regen": {
          id: "coa-auto-regen",
          runId: "run-regen",
          origin: "automated",
          status: "sat",
          label: "COA 1",
          revisionId: "rev-b",
          selectedActions: [],
          logisticsPlan: { kind: "empty", reason: "no-actions" },
          scores: { feasibility: 1, logistics: 0.9, effects: 0, risk: 0, overall: 0.6 },
        },
      },
      candidateOrder: ["coa-auto-regen"],
      selectedCoaId: "coa-auto-regen",
    };

    const merged = preserveOperatorCoasOnPipeline(previous, generated);
    const op = merged.candidatesById["operator-draft-1"];
    expect(op).toBeDefined();
    expect(isOperatorCandidate(op!)).toBe(true);
    expect(op?.validationStatus).toBe("stale");
    expect(op?.status).toBe("stale");
    expect(merged.matrixOverlaysByCoaId?.["operator-draft-1"]).toBeDefined();
  });
});
