import { describe, expect, it } from "vitest";
import { buildExecutionTrackPositions } from "./executionTrackMotion";
import type { SyncMatrixBar } from "../coa/syncMatrix";
import type { ValidatedOrderSetTask } from "../coa/types";

describe("buildExecutionTrackPositions", () => {
  const bar: SyncMatrixBar = {
    id: "manual-1",
    actionId: "manual-1",
    label: "GROU investigate",
    startSec: 0,
    durationSec: 600,
    status: "planned",
    dependencies: [],
    dependencyLabels: [],
    reasons: [],
    fixes: [],
    origin: "user-added",
    actor: "GROU - Northwest coastal",
    target: "AIR - Western air defense",
    actionVerb: "Investigate",
    targetFactIds: ["fact-target"],
    missingFields: [],
    isManual: true,
    rowKey: "maneuver::supporting-effort",
  };

  const task: ValidatedOrderSetTask = {
    id: "manual-1",
    actionId: "manual-1",
    label: bar.label,
    startSec: 0,
    durationSec: 600,
    actor: bar.actor,
    target: bar.target,
    actionVerb: bar.actionVerb,
    status: "planned",
    origin: "user-added",
    dependencies: [],
    targetFactIds: ["fact-target"],
    isManual: true,
  };

  it("moves actor track toward target during playback", () => {
    const positions = buildExecutionTrackPositions({
      playbackTimeSec: 300,
      tasks: [task],
      bars: [bar],
      facts: [
        {
          id: "fact-target",
          domain: "air",
          entity: "Western air defense",
          event: "Active",
          time: "00:00",
          source: "test",
          confidence: "high",
          severity: "medium",
        },
      ],
      tracks: [
        {
          id: "track-grou",
          callsign: "GROU - Northwest coastal",
          side: "friendly",
          classification: "unknown-air",
          confidence: 0.8,
          uncertaintyMeters: 500,
          stalenessMinutes: 1,
          stalenessState: "fresh",
          detectedBy: "test",
          lastUpdate: "00:00",
          summary: "Coastal contact",
          history: [],
          coordinates: { lng: 120.1, lat: 24.1 },
        },
      ],
    });

    const next = positions.get("track-grou");
    expect(next).toBeDefined();
    expect(next!.lng).toBeGreaterThan(120.1);
    expect(next!.lat).not.toBe(24.1);
  });
});
