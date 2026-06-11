import { describe, expect, it } from "vitest";
import type { SyncMatrixBar } from "../../coa/syncMatrix";
import { buildMatrixAssetRows, matrixAssetStatusLabel } from "./matrixInspectorAssets";

function bar(partial: Partial<SyncMatrixBar> & Pick<SyncMatrixBar, "id">): SyncMatrixBar {
  return {
    label: partial.label ?? "Task",
    rowKey: partial.rowKey ?? "maneuver::main-effort",
    startSec: partial.startSec ?? 0,
    durationSec: partial.durationSec ?? 300,
    status: partial.status ?? "planned",
    dependencies: [],
    dependencyLabels: [],
    missingFields: [],
    reasons: [],
    fixes: [],
    ...partial,
  };
}

describe("buildMatrixAssetRows", () => {
  it("marks known assets available when unassigned", () => {
    const rows = buildMatrixAssetRows({
      knownAssets: ["cyber-defense-team", "uav-recon-flight"],
      bars: [],
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "available")).toBe(true);
  });

  it("links assigned and active tasks to assets", () => {
    const rows = buildMatrixAssetRows({
      knownAssets: ["cyber-defense-team"],
      bars: [
        bar({
          id: "t1",
          actor: "cyber-defense-team",
          actionVerb: "Disrupt",
          target: "Keelung port",
        }),
      ],
      executionActiveBarIds: new Set(["t1"]),
    });
    expect(rows[0]?.status).toBe("active");
    expect(rows[0]?.taskLabel).toContain("Disrupt");
  });

  it("includes non-catalog actors used on tasks", () => {
    const rows = buildMatrixAssetRows({
      knownAssets: [],
      bars: [bar({ id: "t2", actor: "Strike Flight Alpha", actionVerb: "Strike" })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("assigned-unit");
    expect(rows[0]?.status).toBe("assigned");
  });
});

describe("matrixAssetStatusLabel", () => {
  it("maps statuses to labels", () => {
    expect(matrixAssetStatusLabel("available")).toBe("Available");
    expect(matrixAssetStatusLabel("active")).toBe("Active");
  });
});
