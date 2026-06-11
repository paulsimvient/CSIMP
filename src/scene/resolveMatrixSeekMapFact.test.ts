import { describe, expect, it } from "vitest";
import { resolveMatrixSeekMapFactId } from "./resolveMatrixSeekMapFact";
import type { SyncMatrixBar } from "../coa/syncMatrix";

function bar(partial: Partial<SyncMatrixBar> & Pick<SyncMatrixBar, "id">): SyncMatrixBar {
  return {
    actionId: partial.id,
    label: "Task",
    subLabel: "Main Effort",
    startSec: 0,
    durationSec: 900,
    status: "planned",
    dependencies: [],
    dependencyLabels: [],
    resourceLabel: "1-42",
    reasons: [],
    fixes: [],
    origin: "system-generated",
    missingFields: [],
    rowKey: "maneuver::main-effort",
    ...partial,
  };
}

describe("resolveMatrixSeekMapFactId", () => {
  it("prefers an active task target in the clicked section", () => {
    expect(
      resolveMatrixSeekMapFactId({
        timeSec: 600,
        target: { sectionId: "maneuver" },
        bars: [
          bar({
            id: "a",
            startSec: 300,
            durationSec: 900,
            targetFactIds: ["obj-ken"],
            rowKey: "maneuver::main-effort",
          }),
          bar({
            id: "b",
            startSec: 0,
            durationSec: 300,
            targetFactIds: ["track-1"],
            rowKey: "isr::air",
          }),
        ],
        facts: [],
        tracks: [],
      })
    ).toBe("obj-ken");
  });

  it("falls back to the nearest bar in the row", () => {
    expect(
      resolveMatrixSeekMapFactId({
        timeSec: 1200,
        target: { rowKey: "fires::suppression" },
        bars: [
          bar({
            id: "fires",
            startSec: 900,
            durationSec: 600,
            targetFactIds: ["radar-site"],
            rowKey: "fires::suppression",
          }),
        ],
        facts: [],
        tracks: [],
      })
    ).toBe("radar-site");
  });
});
