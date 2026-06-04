import { describe, expect, it } from "vitest";
import {
  cyberExecutionBadgeLabel,
  normalizeCyberExecutionMode,
} from "./executionMode";

describe("cyber execution mode labels", () => {
  it("maps legacy simulated values to simulation", () => {
    expect(normalizeCyberExecutionMode("simulated")).toBe("simulation");
    expect(cyberExecutionBadgeLabel("simulation")).toBe("SIMULATED");
  });

  it("never labels unavailable or in-process modes as LAB EXECUTED", () => {
    expect(cyberExecutionBadgeLabel("lab-unavailable")).toBe("LAB UNAVAILABLE");
    expect(cyberExecutionBadgeLabel("in-process-simulation")).toBe(
      "IN-PROCESS SIMULATION"
    );
    expect(cyberExecutionBadgeLabel("lab-unavailable")).not.toBe("LAB EXECUTED");
    expect(cyberExecutionBadgeLabel("in-process-simulation")).not.toBe(
      "LAB EXECUTED"
    );
  });
});
