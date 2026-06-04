import { describe, expect, it } from "vitest";
import type { SyncMatrixBar, SyncMatrixRow } from "../../coa/syncMatrix";
import {
  computeBarHorizontalAnchors,
  dependencyLinkedSectionIds,
} from "./syncMatrixLayout";

describe("syncMatrixLayout", () => {
  it("marks sections linked by dependencies", () => {
    const rows: SyncMatrixRow[] = [
      {
        id: "section-maneuver",
        label: "MANEUVER",
        kind: "section",
        sectionId: "maneuver",
        depth: 0,
        bars: [],
      },
      {
        id: "maneuver::main-effort",
        label: "Main Effort",
        kind: "task",
        sectionId: "maneuver",
        depth: 1,
        bars: [{ id: "bar-a", dependencies: [] } as Pick<SyncMatrixBar, "id" | "dependencies"> as SyncMatrixBar],
      },
      {
        id: "section-isr",
        label: "ISR",
        kind: "section",
        sectionId: "isr",
        depth: 0,
        bars: [],
      },
      {
        id: "isr::air",
        label: "Air ISR",
        kind: "task",
        sectionId: "isr",
        depth: 1,
        bars: [{ id: "bar-b", dependencies: ["bar-a"] } as Pick<SyncMatrixBar, "id" | "dependencies"> as SyncMatrixBar],
      },
    ];

    const linked = dependencyLinkedSectionIds(rows);
    expect(linked.has("maneuver")).toBe(true);
    expect(linked.has("isr")).toBe(true);
  });

  it("computes horizontal bar anchors from timing", () => {
    const bar = {
      startSec: 900,
      durationSec: 900,
    } as SyncMatrixBar;
    const anchors = computeBarHorizontalAnchors(bar, 900, 8, 96, 220);
    expect(anchors.left).toBe(220 + 96);
    expect(anchors.right).toBe(220 + 192);
  });
});
