import { describe, expect, it } from "vitest";
import {
  collectRevisionBlockers,
  materializeCoaRevision,
} from "./materializeCoaRevision";
import { emptyMatrixOverlay } from "./operatorCoa";
import type { CoaCandidate, LogisticsChip } from "./types";
import type { ManualSyncEntry } from "./manualSync";

function automatedCandidate(id: string, withDependent = false): CoaCandidate {
  const chipId = `chip-${id}-a1`;
  const chip2Id = `chip-${id}-a2`;
  const chips: LogisticsChip[] = [
    {
      id: chipId,
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
  ];
  if (withDependent) {
    chips.push({
      id: chip2Id,
      actionId: "a2",
      label: "Coordinate intercept",
      laneId: `lane-${id}-f`,
      startOffset: 300,
      duration: 300,
      dependencies: [chipId],
      citedFactIds: ["fact-2"],
      resourceIds: ["fighter-1"],
      sceneSummary: "Inbound track",
    });
  }
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
        name: "Observe",
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
      lanes: [
        { id: `lane-${id}`, label: "UAV", chipIds: [chipId] },
        ...(withDependent
          ? [{ id: `lane-${id}-f`, label: "Fighter", chipIds: [chip2Id] }]
          : []),
      ],
      chips,
      totalDuration: withDependent ? 600 : 300,
    },
    scores: { feasibility: 1, logistics: 0.8, effects: 0.7, risk: 0.2, overall: 0.75 },
  };
}

describe("materializeCoaRevision", () => {
  it("blocks when a dependency target was hidden", () => {
    const candidate = automatedCandidate("coa-1", true);
    const chipId = candidate.logisticsPlan.kind === "populated"
      ? candidate.logisticsPlan.chips[0]!.id
      : "chip";
    const overlay = {
      ...emptyMatrixOverlay(),
      hiddenBarIds: [chipId],
      revisionId: "rev-test",
    };
    const blockers = collectRevisionBlockers(candidate, overlay);
    expect(blockers.some((b) => /depends on/i.test(b))).toBe(true);
  });

  it("materializes visible bars into selectedActions and logistics plan", () => {
    const candidate = automatedCandidate("coa-2");
    const result = materializeCoaRevision(candidate, emptyMatrixOverlay());
    expect(result.blockers).toEqual([]);
    expect(result.candidate?.selectedActions).toHaveLength(1);
    expect(result.candidate?.logisticsPlan.kind).toBe("populated");
    expect(result.orderSet?.actionCount).toBe(1);
    expect(result.validation?.evidenceSnapshotId).toMatch(/^evidence-/);
  });

  it("flags manual tasks without evidence", () => {
    const candidate = automatedCandidate("coa-3");
    const manualEntry: ManualSyncEntry = {
      id: "manual-1",
      origin: "user-added",
      category: "supporting-effort",
      rowKey: "maneuver::supporting-effort",
      subLabel: "Supporting Effort",
      actor: "GROU - Northwest",
      actionVerb: "Observe",
      target: "Objective ALPHA",
      startSec: 0,
      durationSec: 600,
      status: "planned",
      source: "matrix",
      missingFields: [],
      confirmed: true,
    };
    const overlay = {
      ...emptyMatrixOverlay(),
      manualEntries: [manualEntry],
    };
    const blockers = collectRevisionBlockers(candidate, overlay);
    expect(blockers.some((b) => /grounded target evidence/i.test(b))).toBe(true);
  });

  it("reports incomplete manual drafts once without duplicate bar labels", () => {
    const candidate: CoaCandidate = {
      id: "operator-2",
      runId: "run-1",
      origin: "operator-authored",
      revisionId: "rev-op-2",
      validationStatus: "unvalidated",
      status: "draft",
      label: "Operator COA – Draft 1",
      selectedActions: [],
      logisticsPlan: { kind: "empty", reason: "not-built" },
      scores: { feasibility: 0, logistics: 0, effects: 0, risk: 0, overall: 0 },
    };
    const draft: ManualSyncEntry = {
      id: "manual-draft",
      origin: "user-added",
      category: "main-effort",
      rowKey: "maneuver::main-effort",
      subLabel: "Main Effort",
      actionVerb: "Advance",
      startSec: 120,
      durationSec: 600,
      status: "planned",
      source: "matrix",
      missingFields: ["actor", "target"],
      confirmed: false,
    };
    const overlay = {
      ...emptyMatrixOverlay(),
      manualEntries: [draft],
    };
    const blockers = collectRevisionBlockers(candidate, overlay);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatch(/Main Effort.*actor, target/);
  });

  it("materializes operator drafts with strike verbs without validated-intel label guard", () => {
    const candidate: CoaCandidate = {
      id: "operator-1",
      runId: "run-1",
      origin: "operator-authored",
      revisionId: "rev-op-1",
      validationStatus: "unvalidated",
      status: "draft",
      label: "Operator COA – Draft 1",
      selectedActions: [],
      logisticsPlan: { kind: "empty", reason: "not-built" },
      scores: { feasibility: 0, logistics: 0, effects: 0, risk: 0, overall: 0 },
    };
    const manualEntry: ManualSyncEntry = {
      id: "manual-strike",
      origin: "user-added",
      category: "supporting-effort",
      rowKey: "maneuver::supporting-effort",
      subLabel: "Supporting Effort",
      actor: "GROU - Northwest coastal",
      actionVerb: "Strike",
      target: "AIR - Western air defense",
      targetFactId: "fact-air-1",
      startSec: 0,
      durationSec: 600,
      status: "planned",
      source: "matrix",
      missingFields: [],
      confirmed: true,
    };
    const overlay = {
      ...emptyMatrixOverlay(),
      manualEntries: [manualEntry],
    };
    const result = materializeCoaRevision(candidate, overlay, {
      observedFacts: [
        {
          id: "fact-air-1",
          domain: "air",
          entity: "Western air defense",
          event: "Active",
          time: "00:00",
          source: "test",
          confidence: "high",
          severity: "medium",
        },
      ],
    });
    expect(result.blockers).toEqual([]);
    expect(result.candidate?.logisticsPlan.kind).toBe("populated");
    if (result.candidate?.logisticsPlan.kind === "populated") {
      expect(result.candidate.logisticsPlan.source).toBe("demo");
    }
  });
});
