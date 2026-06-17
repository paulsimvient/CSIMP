import { describe, expect, it } from "vitest";
import {
  factDedupeKey,
  ingestPayload,
  mergeObservedFacts,
} from "./ingest";
import type { ObservedFact } from "./types";

const baseFact = (overrides: Partial<ObservedFact> = {}): ObservedFact => ({
  id: "fact_air_track",
  domain: "air",
  entity: "Track T-4412",
  event: "unidentified air track",
  time: "2026-06-04T12:00:00Z",
  source: "coastal-radar",
  confidence: "medium",
  severity: "high",
  ...overrides,
});

describe("mergeObservedFacts", () => {
  it("appends new facts and skips duplicates by id or entity/event/time", () => {
    const existing = [baseFact()];
    const incoming = [
      baseFact(),
      baseFact({
        id: "fact_maritime_kalmar",
        domain: "maritime",
        entity: "MV Kalmar",
        event: "vessel holding pattern",
      }),
    ];
    const result = mergeObservedFacts(existing, incoming);
    expect(result.added).toHaveLength(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.facts).toHaveLength(2);
    expect(factDedupeKey(result.facts[1]!)).toBe(factDedupeKey(incoming[1]!));
  });
});

describe("ingestPayload", () => {
  it("normalizes raw reports into observed facts with stable ids", () => {
    const facts = ingestPayload({
      reports: [
        {
          reportId: "radar-track-4412",
          source: "coastal-radar",
          domain: "air",
          timestamp: "2026-06-04T12:00:00Z",
          text: "Unidentified track bearing 045",
          metadata: { entity: "Track T-4412", event: "unidentified air track" },
        },
      ],
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.id).toBe("fact_air_radar_track_4412");
    expect(facts[0]?.entity).toBe("Track T-4412");
  });
});
