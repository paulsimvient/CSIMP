import { describe, expect, it } from "vitest";
import { deriveWorkflowStepState } from "./WorkflowStepper";

describe("deriveWorkflowStepState", () => {
  it("starts on event before analysis context exists", () => {
    const state = deriveWorkflowStepState({
      hasEventContext: false,
      coaRunning: false,
      candidateCount: 0,
      logisticsReady: false,
      canExecute: false,
      isExecuting: false,
    });
    expect(state.current).toBe("event");
    expect(state.completed.has("event")).toBe(false);
  });

  it("moves to select once candidates exist", () => {
    const state = deriveWorkflowStepState({
      hasEventContext: true,
      coaRunning: false,
      candidateCount: 3,
      logisticsReady: false,
      canExecute: false,
      isExecuting: false,
    });
    expect(state.current).toBe("select");
    expect(state.completed.has("generate")).toBe(true);
  });

  it("focuses execute when ready or running", () => {
    const ready = deriveWorkflowStepState({
      hasEventContext: true,
      coaRunning: false,
      candidateCount: 2,
      selectedCoaId: "coa-1",
      logisticsReady: true,
      canExecute: true,
      isExecuting: false,
    });
    expect(ready.current).toBe("execute");

    const running = deriveWorkflowStepState({
      hasEventContext: true,
      coaRunning: false,
      candidateCount: 2,
      selectedCoaId: "coa-1",
      logisticsReady: true,
      canExecute: false,
      isExecuting: true,
    });
    expect(running.current).toBe("execute");
  });
});
