import { describe, expect, it } from "vitest";
import {
  applyManualEntryPatch,
  createDraftManualEntryAtCell,
  createImportedManualEntriesFromText,
  createManualEntryFromInstruction,
  manualEntryToBarLabel,
  parseManualInstruction,
  parseMissionOffsetSec,
  validateManualEntry,
} from "./manualSync";

describe("parseManualInstruction", () => {
  it("extracts actor, action, target, and explicit from/to timing", () => {
    const parsed = parseManualInstruction(
      "1-42 secure Objective KEN from H+15 to H+45.",
      { factId: "fact-obj", entity: "Objective KEN" }
    );
    expect(parsed.actor).toBe("1-42");
    expect(parsed.actionVerb).toBe("secure");
    expect(parsed.target).toBe("Objective KEN");
    expect(parsed.category).toBe("main-effort");
    expect(parsed.rowKey).toBe("maneuver::main-effort");
    expect(parsed.startSec).toBe(15 * 60);
    expect(parsed.durationSec).toBe(30 * 60);
    expect(parsed.missingFields).not.toContain("start");
    expect(parsed.missingFields).not.toContain("duration");
  });

  it("does not invent start or duration for deadline-only phrasing", () => {
    const parsed = parseManualInstruction(
      "1-42 secure Objective KEN by H+45.",
      { factId: "fact-obj", entity: "Objective KEN" }
    );
    expect(parsed.endTimeLabel).toBe("H+45");
    expect(parsed.missingFields).toContain("start");
    expect(parsed.missingFields).toContain("duration");
    expect(parsed.timingUnresolved).toContain("start");
    expect(parsed.timingUnresolved).toContain("duration");
  });

  it("infers ISR row from natural language without manual override", () => {
    const parsed = parseManualInstruction(
      "ISR maintain contact with enemy formation from H+15 to H+60."
    );
    expect(parsed.rowKey).toMatch(/^isr::/);
    expect(parsed.category).toBe("isr");
  });

  it("flags missing timing when not provided", () => {
    const parsed = parseManualInstruction(
      "Reserve be prepared to reinforce the main effort on order."
    );
    expect(parsed.missingFields).toContain("timing");
    expect(parsed.category).toBe("reserve");
  });
});

describe("validateManualEntry", () => {
  it("clears missing actor/action/target after values are provided", () => {
    const entry = validateManualEntry({
      id: "manual-1",
      origin: "user-added",
      actor: "1-42",
      actionVerb: "Secure",
      target: "OBJ KEN",
      category: "main-effort",
      rowKey: "maneuver::main-effort",
      subLabel: "Main Effort",
      startSec: 15 * 60,
      durationSec: 30 * 60,
      status: "planned",
      source: "matrix",
      missingFields: ["actor", "action", "target"],
      timingUnresolved: [],
      confirmed: false,
    });
    expect(entry.missingFields).not.toContain("actor");
    expect(entry.missingFields).not.toContain("action");
    expect(entry.missingFields).not.toContain("target");
    expect(entry.confirmed).toBe(true);
  });
});

describe("applyManualEntryPatch", () => {
  it("preserves duration when only startSec is patched during drag", () => {
    const entry = validateManualEntry({
      id: "manual-1",
      origin: "user-added",
      actor: "1-42",
      actionVerb: "Secure",
      target: "OBJ KEN",
      category: "main-effort",
      rowKey: "maneuver::main-effort",
      subLabel: "Main Effort",
      startSec: 0,
      durationSec: 1800,
      status: "planned",
      source: "matrix",
      missingFields: [],
      timingUnresolved: [],
      confirmed: true,
    });
    const patched = applyManualEntryPatch(entry, { startSec: 900 });
    expect(patched.startSec).toBe(900);
    expect(patched.durationSec).toBe(1800);
  });
});

describe("createDraftManualEntryAtCell", () => {
  it("creates a visible matrix placeholder with timing but missing task fields", () => {
    const entry = createDraftManualEntryAtCell({
      rowKey: "cyber::disruption",
      startSec: 900,
      durationSec: 3600,
    });
    expect(entry.rowKey).toBe("cyber::disruption");
    expect(entry.actionVerb).toBe("Disrupt");
    expect(entry.startSec).toBe(900);
    expect(entry.durationSec).toBe(3600);
    expect(entry.missingFields).toEqual(["actor", "target"]);
    expect(entry.confirmed).toBe(false);
    expect(manualEntryToBarLabel(entry)).toBe("Disrupt");
  });

  it("defaults jam, harden, and inform verbs from row keys", () => {
    expect(createDraftManualEntryAtCell({ rowKey: "cyber::jam", startSec: 0 }).actionVerb).toBe(
      "Jam"
    );
    expect(createDraftManualEntryAtCell({ rowKey: "cyber::harden", startSec: 0 }).actionVerb).toBe(
      "Harden"
    );
    expect(
      createDraftManualEntryAtCell({ rowKey: "information::ops", startSec: 0 }).actionVerb
    ).toBe("Inform");
  });
});

describe("createManualEntryFromInstruction", () => {
  it("creates a provisional user-added entry", () => {
    const entry = createManualEntryFromInstruction(
      "Cyber disrupt the coastal radar site before the main effort crosses PL RED.",
      { factId: "fact-radar", entity: "Coastal radar site" }
    );
    expect(entry.origin).toBe("user-added");
    expect(entry.category).toBe("cyber");
    expect(entry.targetFactId).toBe("fact-radar");
  });

  it("routes jam, harden, and info ops instructions to the new rows", () => {
    expect(
      createManualEntryFromInstruction("Jam coastal radar emissions from H+1 to H+2").rowKey
    ).toBe("cyber::jam");
    expect(
      createManualEntryFromInstruction("Harden port authentication logging from H+0 to H+1").rowKey
    ).toBe("cyber::harden");
    expect(
      createManualEntryFromInstruction("Info ops counter the port closure rumor from H+1 to H+2")
        .rowKey
    ).toBe("information::ops");
  });
});

describe("parseMissionOffsetSec", () => {
  it("parses H+ labels to seconds", () => {
    expect(parseMissionOffsetSec("H+45")).toBe(45 * 60);
  });
});

describe("createImportedManualEntriesFromText", () => {
  it("creates one imported entry per non-empty line", () => {
    const entries = createImportedManualEntriesFromText(
      "Fighter 1 observe inbound track at H+0:15\nLogistics resupply port at H+1:00"
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]?.origin).toBe("imported");
    expect(entries[0]?.source).toBe("import");
  });
});
