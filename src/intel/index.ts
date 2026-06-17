export type {
  Assumption,
  CandidateAction,
  ConfidenceLevel,
  FactDomain,
  GroundingIssue,
  GroundingValidationResult,
  IntelState,
  Inference,
  LLMInterpretation,
  ObservedFact,
  RawSourceReport,
  ScenarioPacket,
  SeverityLevel,
} from "./types";

export {
  DEFAULT_FACT_SET_ID,
  FactSetLoadError,
  listAvailableFactSets,
  loadFactSet,
  normalizeBatch,
  normalizeReport,
  stubPortAFacts,
  validateObservedFact,
  validateObservedFacts,
} from "./facts";
export type { FactSetDescriptor } from "./facts";
export { buildInterpreterPrompt, buildScenarioPacket } from "./scenarioPacket";
export { llmInterpreter, stubInterpreter } from "./interpreter";
export {
  confidenceExceedsEvidence,
  detectEvidenceConflicts,
  maxConfidenceFromFactIds,
} from "./evidence";
export type { EvidenceConflict } from "./evidence";
export { extractValidatedActions, formatGroundingReport, validateGrounding } from "./grounding";
export {
  runIntelPipeline,
  useAppendObservedFacts,
  useGroundingResult,
  useIntelStatus,
  useIntelStore,
  useObservedFacts,
  useRawModelText,
  useRawInterpretation,
  useResetIntel,
  useRunIntel,
  useScenarioPacket,
  useValidatedActions,
} from "./pipeline";
export {
  factDedupeKey,
  ingestPayload,
  ingestRawReports,
  mergeObservedFacts,
} from "./ingest";
export { useIngestSync } from "./useIngestSync";
export { ingestFeedWindowEnabled, useIngestMetrics } from "./useIngestMetrics";
