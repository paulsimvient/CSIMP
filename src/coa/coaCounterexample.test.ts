import { describe, expect, it } from "vitest";
import { extractCoaCounterexample } from "./coaCounterexample";

describe("coaCounterexample", () => {
  it("generalizes relay assumption failures into doctrine", () => {
    const ce = extractCoaCounterexample({
      coaRef: "coa-alpha",
      blockers: [
        "Task cyber-patch depends on comms-relay-alpha which is unavailable during patch window",
      ],
      status: "unsat",
    });
    expect(ce.failureClass).toBe("implicit-relay-assumption");
    expect(ce.generalizedDoctrine).toContain("command connectivity");
  });

  it("generalizes logistics blockers", () => {
    const ce = extractCoaCounterexample({
      blockers: ["Task escort depends on asset surface-escort-group-alpha (not in logistics matrix)"],
    });
    expect(ce.failureClass).toBe("stale-logistics-failure");
  });
});
