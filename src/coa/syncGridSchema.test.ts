import { describe, expect, it } from "vitest";
import {
  defaultActionVerbForRowKey,
  mapCategoryToRowKey,
  parseRowKeyFromText,
} from "./syncGridSchema";

describe("syncGridSchema non-kinetic rows", () => {
  it("assigns default verbs for new cyber and information rows", () => {
    expect(defaultActionVerbForRowKey("cyber::jam")).toBe("Jam");
    expect(defaultActionVerbForRowKey("cyber::harden")).toBe("Harden");
    expect(defaultActionVerbForRowKey("information::ops")).toBe("Inform");
  });

  it("routes cyber chips to jam, harden, or disruption rows", () => {
    expect(mapCategoryToRowKey("cyber", { label: "Jam coastal radar emissions", actionType: "other" })).toBe(
      "cyber::jam"
    );
    expect(mapCategoryToRowKey("cyber", { label: "Harden port authentication stack", actionType: "harden" })).toBe(
      "cyber::harden"
    );
    expect(mapCategoryToRowKey("cyber", { label: "Disrupt C2 node", actionType: "cyber" })).toBe(
      "cyber::disruption"
    );
  });

  it("routes information category to the information ops row", () => {
    expect(mapCategoryToRowKey("information", { label: "Counter rumor on port closure" })).toBe(
      "information::ops"
    );
  });

  it("parses row keys from natural language", () => {
    expect(parseRowKeyFromText("info ops counter the port rumor")).toBe("information::ops");
    expect(parseRowKeyFromText("jam enemy EW at H+1")).toBe("cyber::jam");
    expect(parseRowKeyFromText("harden authentication logging")).toBe("cyber::harden");
    expect(parseRowKeyFromText("cyber disrupt radar site")).toBe("cyber::disruption");
  });
});
