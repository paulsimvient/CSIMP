import { describe, expect, it } from "vitest";
import type { SyncMatrixBar } from "../coa/syncMatrix";
import type { ObservedFact } from "../intel/types";
import type { OverviewTrack } from "../components/ops/types";
import {
  buildExecutionInteractionMap,
  resolveBarInteractionCoords,
} from "./executionInteractionMap";

const facts: ObservedFact[] = [
  {
    id: "fact-target",
    time: "12:00:00",
    domain: "maritime",
    entity: "Hostile DDG",
    event: "Patrol track",
    source: "radar",
    confidence: "high",
    severity: "high",
    coordinates: { lat: 24.5, lng: 120.2 },
  },
];

const tracks: OverviewTrack[] = [
  {
    id: "fact-friendly",
    callsign: "2-107 INF",
    side: "friendly",
    classification: "uas",
    confidence: 0.9,
    uncertaintyMeters: 200,
    stalenessMinutes: 1,
    stalenessState: "fresh",
    detectedBy: "radar",
    lastUpdate: "12:00",
    summary: "Friendly unit",
    history: [],
    coordinates: { lat: 24.2, lng: 120.0 },
  },
];

const bar: SyncMatrixBar = {
  id: "manual-1",
  actionId: "manual-1",
  label: "Supporting Effort",
  startSec: 0,
  durationSec: 900,
  status: "planned",
  dependencies: [],
  dependencyLabels: [],
  reasons: [],
  fixes: [],
  origin: "user-added",
  actor: "2-107 INF",
  target: "Hostile DDG",
  actionVerb: "observe",
  targetFactIds: ["fact-target"],
  missingFields: [],
  isManual: true,
};

describe("executionInteractionMap", () => {
  it("resolves actor and target coordinates from labels and fact ids", () => {
    const coords = resolveBarInteractionCoords(bar, facts, tracks);
    expect(coords.actorCoord).toEqual([120.0, 24.2]);
    expect(coords.targetCoord).toEqual([120.2, 24.5]);
  });

  it("builds line features for matrix tasks", () => {
    const geojson = buildExecutionInteractionMap({ bars: [bar], facts, tracks });
    expect(geojson?.features.length).toBeGreaterThan(0);
    expect(
      geojson?.features.some((feature) => feature.geometry.type === "LineString")
    ).toBe(true);
  });
});
