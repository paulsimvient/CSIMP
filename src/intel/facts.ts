export { normalizeBatch, normalizeReport } from "./normalizeReport";

// Scenario fixtures — see factSets.ts and src/scenarios/*.json
export {
  DEFAULT_FACT_SET_ID,
  FactSetLoadError,
  listAvailableFactSets,
  loadFactSet,
  stubPortAFacts,
  validateObservedFact,
  validateObservedFacts,
} from "./factSets";
export type { FactSetDescriptor } from "./factSets";
