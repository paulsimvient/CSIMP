import { describe, expect, it } from "vitest";
import {
  createOperatorDraftCandidate,
  forkOperatorModifiedCandidate,
  prepareExecution,
  executePreparedCoa,
  prepareAndExecuteCoa,
  setMatrixOverlay,
  validateOperatorCoa,
  mergeOperatorRevisionIntoParent,
} from "./operatorCoaActions";
import { collectRevisionBlockers } from "./materializeCoaRevision";
import { getExecuteBlockers, getMatrixOverlay, hasOverlayChanges } from "./operatorCoa";
import type { CoaCandidate, CoaState } from "./types";

function automatedCandidate(id: string): CoaCandidate {
  return {
    id,
    runId: "run-1",
    origin: "automated",
    revisionId: `rev-${id}`,
    validationStatus: "validated",
    status: "sat",
    label: "COA 1",
    selectedActions: [
      {
        id: "a1",
        name: "Act",
        type: "observe",
        startTime: 0,
        duration: 300,
        resources: ["uav-1"],
      },
    ],
    logisticsPlan: {
      kind: "populated",
      coaId: id,
      source: "validated-intel",
      lanes: [{ id: `lane-${id}`, label: "UAV", chipIds: [`chip-${id}-a1`] }],
      chips: [
        {
          id: `chip-${id}-a1`,
          actionId: "a1",
          label: "Observe objective ALPHA",
          laneId: `lane-${id}`,
          startOffset: 0,
          duration: 300,
          dependencies: [],
          citedFactIds: ["fact-1"],
          resourceIds: ["uav-1"],
          sceneSummary: "Objective ALPHA",
        },
      ],
      totalDuration: 300,
    },
    scores: { feasibility: 1, logistics: 0.8, effects: 0.7, risk: 0.2, overall: 0.75 },
  };
}

function baseState(candidate: CoaCandidate): CoaState {
  return {
    candidatesById: { [candidate.id]: candidate },
    candidateOrder: [candidate.id],
    selectedCoaId: candidate.id,
    status: "ready",
    matrixOverlaysByCoaId: {},
  };
}

describe("operator COA lifecycle", () => {
  it("creates an independent operator-authored draft", () => {
    const { draftId, state } = createOperatorDraftCandidate(baseState(automatedCandidate("coa-1")));
    expect(draftId).toMatch(/^operator-draft-/);
    expect(state.candidatesById[draftId]?.origin).toBe("operator-authored");
    expect(state.candidatesById[draftId]?.status).toBe("draft");
    expect(state.selectedCoaId).toBe(draftId);
  });

  it("forks automated COA when matrix overlay changes", () => {
    const candidate = automatedCandidate("coa-auto");
    let state = baseState(candidate);
    state = setMatrixOverlay(state, candidate.id, (prev) => ({
      ...prev,
      hiddenBarIds: ["chip-1"],
    }));
    const fork = Object.values(state.candidatesById).find(
      (c) => c.parentCoaId === candidate.id
    );
    expect(fork?.origin).toBe("operator-modified");
    expect(state.selectedCoaId).toBe(fork?.id);
    expect(hasOverlayChanges(state.matrixOverlaysByCoaId?.[fork!.id]!)).toBe(true);
  });

  it("blocks execute when automated COA has overlay without fork selection", () => {
    const candidate = automatedCandidate("coa-auto");
    const state = setMatrixOverlay(baseState(candidate), candidate.id, (prev) => ({
      ...prev,
      hiddenBarIds: ["chip-1"],
    }));
    const forkId = state.selectedCoaId!;
    const blockers = getExecuteBlockers({
      candidate: state.candidatesById[forkId],
      overlay: state.matrixOverlaysByCoaId![forkId]!,
      logisticsReady: true,
    });
    expect(blockers.some((b) => b.includes("validation"))).toBe(true);
  });

  it("allows prepare and execute after operator validation", () => {
    const candidate = automatedCandidate("coa-auto");
    const forked = forkOperatorModifiedCandidate(baseState(candidate), candidate.id);
    expect(forked).toBeDefined();
    let state = forked!.state;
    state = validateOperatorCoa(state, forked!.forkId);
    const validated = state.candidatesById[forked!.forkId];
    expect(validated?.validationStatus).toBe("validated");
    expect(validated?.validatedOrderSet?.actionCount).toBeGreaterThan(0);
    expect(validated?.logisticsPlan.kind).toBe("populated");
    const revisionBlockers = collectRevisionBlockers(
      validated!,
      state.matrixOverlaysByCoaId![forked!.forkId]!
    );
    expect(revisionBlockers).toEqual([]);
    state = prepareExecution(state, forked!.forkId);
    expect(state.preparedExecution?.revisionId).toBeDefined();
    expect(state.preparedExecution?.orderSet).toBeDefined();
    const blockers = getExecuteBlockers({
      candidate: validated,
      overlay: state.matrixOverlaysByCoaId![forked!.forkId]!,
      preparedExecution: state.preparedExecution,
      logisticsReady: true,
    });
    expect(blockers).toEqual([]);
    state = executePreparedCoa(state);
    expect(state.executedSnapshot?.candidateId).toBe(forked!.forkId);
    expect(state.executedSnapshot?.orderSet.actionCount).toBeGreaterThan(0);
  });

  it("commits execute for automated SAT COA without a matrix overlay entry", () => {
    const candidate = automatedCandidate("coa-auto");
    let state = baseState(candidate);
    const result = prepareAndExecuteCoa(state, candidate.id);
    expect(result.ok).toBe(true);
    expect(result.state.executedSnapshot?.candidateId).toBe(candidate.id);
  });

  it("reads matrix overlay from operator-modified fork when parent automated COA is selected", () => {
    const candidate = automatedCandidate("coa-auto");
    let state = setMatrixOverlay(baseState(candidate), candidate.id, (prev) => ({
      ...prev,
      manualEntries: [
        {
          id: "manual-1",
          origin: "user-added",
          actor: "Alpha Company",
          actionVerb: "observe",
          target: "Objective ALPHA",
          category: "supporting-effort",
          rowKey: "maneuver::main-effort",
          subLabel: "Main Effort",
          startSec: 0,
          durationSec: 900,
          status: "planned",
          confidence: "medium",
          source: "matrix",
          missingFields: [],
          timingUnresolved: [],
          instruction: "Observe objective ALPHA",
          confirmed: true,
        },
      ],
    }));
    const forkId = state.selectedCoaId!;
    expect(getMatrixOverlay(state, candidate.id).manualEntries).toHaveLength(1);
    expect(getMatrixOverlay(state, forkId).manualEntries).toHaveLength(1);
    expect(state.matrixOverlaysByCoaId?.[candidate.id]).toBeUndefined();
  });

  it("merges validated operator-modified revision into parent automated COA", () => {
    const candidate = automatedCandidate("coa-auto");
    const forked = forkOperatorModifiedCandidate(baseState(candidate), candidate.id);
    let state = validateOperatorCoa(forked!.state, forked!.forkId);
    state = mergeOperatorRevisionIntoParent(state, forked!.forkId);

    expect(state.candidatesById[forked!.forkId]).toBeUndefined();
    const parent = state.candidatesById[candidate.id];
    expect(parent?.validationStatus).toBe("validated");
    expect(parent?.validatedOrderSet?.actionCount).toBeGreaterThan(0);
    expect(parent?.logisticsPlan.kind).toBe("populated");
    expect(state.selectedCoaId).toBe(candidate.id);
    expect(state.matrixOverlaysByCoaId?.[candidate.id]).toBeUndefined();
  });
});
