import { describe, expect, it, beforeEach } from "vitest";
import {
  appendIngestFacts,
  getIngestStatusStore,
  readIngestEventsSince,
  resetIngestStore,
} from "./intelIngestStore";
import type { ObservedFact } from "../src/intel/types";

const sampleFact = (): ObservedFact => ({
  id: "fact_air_track",
  domain: "air",
  entity: "Track T-4412",
  event: "unidentified air track",
  time: "2026-06-04T12:00:00Z",
  source: "coastal-radar",
  confidence: "medium",
  severity: "high",
});

describe("intelIngestStore", () => {
  beforeEach(() => {
    resetIngestStore();
  });

  it("tracks cursor events for client polling", () => {
    const first = appendIngestFacts([sampleFact()]);
    expect(first.added).toHaveLength(1);
    expect(readIngestEventsSince(0).added).toHaveLength(1);

    const second = appendIngestFacts([sampleFact()]);
    expect(second.added).toHaveLength(0);
    expect(second.duplicateCount).toBe(1);
    expect(readIngestEventsSince(first.cursor).added).toHaveLength(0);
  });

  it("returns lightweight status without full fact arrays", () => {
    appendIngestFacts([sampleFact()]);
    const status = getIngestStatusStore();
    expect(status.acceptedTotal).toBe(1);
    expect(status.recent).toHaveLength(1);
    expect(status.recent[0]?.entity).toBe("Track T-4412");
    expect(status).not.toHaveProperty("facts");
  });
});
