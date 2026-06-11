/**
 * Shadow mode: candidate agents observe the same bounded input as production
 * but cannot mutate application state or replace operator-facing results.
 */

export type ShadowSafetyMetrics = {
  schemaValid: boolean;
  groundingPassRate: number;
  hallucinatedFactIds: number;
  unsupportedActions: number;
  constraintViolations: number;
  confidenceInflation: number;
};

export type ShadowPerformanceMetrics = {
  latencyMs: number;
  tokenUsage?: number;
};

export type ShadowComparisonResult = {
  productionVersion: string;
  candidateVersion: string;
  releaseId: string;
  scenarioId: string;
  safety: ShadowSafetyMetrics;
  performance: ShadowPerformanceMetrics;
  operatorAcceptanceDelta?: number;
  solverOutputDelta?: number;
  promoted: boolean;
  blockers: string[];
};
