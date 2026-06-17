import { describe, expect, it } from "vitest";
import { buildLogisticsPlan } from "./logistics";
import { buildSyncMatrixModel, formatMissionTick, manualEntryToSyncBar } from "./syncMatrix";
import { createDraftManualEntryAtCell } from "./manualSync";

describe("buildSyncMatrixModel", () => {
  it("groups parallel actions into operational rows with mission-time ticks", () => {
    const plan = buildLogisticsPlan({
      coaId: "coa_sync",
      source: "validated-intel",
      actions: [
        {
          id: "observe",
          name: "ISR orbit over contact",
          type: "observe",
          startTime: 0,
          duration: 300,
          resources: ["uav-recon"],
        },
        {
          id: "coordinate",
          name: "Coordinate intercept package",
          type: "coordinate",
          startTime: 60,
          duration: 240,
          resources: ["fighter-intercept"],
        },
        {
          id: "preserve",
          name: "Screen coastal radar site",
          type: "preserve",
          startTime: 0,
          duration: 360,
          resources: ["security-element"],
        },
      ],
      intelActions: [
        { id: "observe", description: "ISR orbit", citedFacts: ["fact-1"], actionType: "observe" },
        { id: "coordinate", description: "Coordinate intercept", citedFacts: ["fact-2"], actionType: "coordinate" },
        { id: "preserve", description: "Screen site", citedFacts: ["fact-3"], actionType: "preserve" },
      ],
      observedFacts: [
        { id: "fact-1", domain: "air", entity: "UAV", event: "Orbit", time: "00:00", source: "t", confidence: "high", severity: "low" },
        { id: "fact-2", domain: "air", entity: "Fighter", event: "Intercept", time: "00:00", source: "t", confidence: "high", severity: "medium" },
        { id: "fact-3", domain: "ground", entity: "Radar", event: "Screen", time: "00:00", source: "t", confidence: "high", severity: "medium" },
      ],
    });

    expect(plan.kind).toBe("populated");
    if (plan.kind !== "populated") return;

    const model = buildSyncMatrixModel({ plan, tickIntervalSec: 15 * 60 });
    expect(model.actionCount).toBe(3);
    expect(model.ticks[0]?.label).toBe("H+00");
    expect(model.ticks.some((tick) => tick.label === "H+15")).toBe(true);

    const sectionLabels = model.rows
      .filter((row) => row.kind === "section")
      .map((row) => row.label);
    expect(sectionLabels).toContain("MANEUVER");
    expect(sectionLabels).toContain("ISR");

    expect(model.rows.some((row) => row.id === "isr::air" && row.bars.length > 0)).toBe(true);
    expect(
      model.rows.some((row) => row.id === "protection::security" && row.bars.length > 0)
    ).toBe(true);
    expect(model.rows.some((row) => row.kind === "section" && row.label === "MANEUVER")).toBe(
      true
    );
    expect(model.rows.some((row) => row.id === "commanders-intent")).toBe(true);
    expect(formatMissionTick(15 * 60)).toBe("H+15");
  });

  it("does not duplicate manual overlay entries already materialized as system bars", () => {
    const plan = buildLogisticsPlan({
      coaId: "coa_dup",
      source: "validated-intel",
      actions: [
        {
          id: "investigate",
          name: "GROU investigate air defense",
          type: "observe",
          startTime: 0,
          duration: 600,
          resources: ["grou-northwest-coastal"],
        },
      ],
    });
    if (plan.kind !== "populated") throw new Error("expected populated plan");
    const manualEntry = {
      id: "manual-1",
      origin: "user-added" as const,
      category: "supporting-effort" as const,
      rowKey: "maneuver::supporting-effort" as const,
      subLabel: "Supporting Effort",
      actor: "GROU - Northwest coastal",
      actionVerb: "Investigate",
      target: "AIR - Western air defense",
      startSec: 0,
      durationSec: 600,
      status: "planned" as const,
      source: "matrix" as const,
      missingFields: [],
      confirmed: true,
    };
    const model = buildSyncMatrixModel({
      plan,
      manualEntries: [manualEntry],
    });
    const bars = model.rows.flatMap((row) => row.bars);
    expect(bars).toHaveLength(1);
  });
});

describe("manualEntryToSyncBar", () => {
  it("maps draft placeholders into editable manual bars", () => {
    const entry = createDraftManualEntryAtCell({
      rowKey: "isr::air",
      startSec: 240,
      durationSec: 60,
    });
    const bar = manualEntryToSyncBar(entry);
    expect(bar.isManual).toBe(true);
    expect(bar.actionVerb).toBe("Observe");
    expect(bar.startSec).toBe(240);
    expect(bar.missingFields).toEqual(["actor", "target"]);
  });
});
