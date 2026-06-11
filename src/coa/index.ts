// Public API surface for the COA pipeline module.
// Import from here, not from individual files.

export type {
  CoaOrigin,
  CoaValidationStatus,
  CoaCandidateStatus,
  CyberEffectsAnnotation,
  CoaAction,
  CoaCandidate,
  CoaId,
  CoaScores,
  CoaState,
  MatrixOverlay,
  PreparedExecution,
  ExecutedCoaSnapshot,
  EffectsEngineContext,
  EffectsResult,
  EffectsSummary,
  LogisticsChip,
  LogisticsLane,
  LogisticsPlan,
  PipelineInput,
  RunId,
  Signal,
} from "./types";

export {
  filterCitedIntelActions,
  runCoaPipeline,
  selectDisplayedLogisticsPlan,
  selectRankedCandidates,
  selectSelectedCoa,
} from "./pipeline";
export {
  CONSTRAINTS_VERSION,
  SCORING_MODEL_VERSION,
} from "./pipeline";
export { buildCoaRankRationale, buildRankingExplanation } from "./rankRationale";
export { SOLVER_VERSION } from "./solver";
export { formatConstraintTraces, unsatSummary } from "./constraintTrace";
export { buildMatrixDerivation } from "./matrixDerivation";
export type { MatrixCellDerivation, MatrixRowId } from "./matrixDerivation";
export { analyzeRankingSensitivity } from "./sensitivity";
export type {
  ConstraintTrace,
  CoaRunMetadata,
  RankingExplanation,
  RankingSensitivity,
} from "./types";

export {
  useCoaStore,
  useDisplayedPlan,
  usePipelineError,
  usePipelineStatus,
  useEvidenceConflicts,
  useRankedCandidates,
  useRankingSensitivity,
  useResetCoa,
  useRunMetadata,
  useSelectedCoa,
  useCreateOperatorDraft,
  useMatrixOverlay,
  usePrepareCoaExecution,
  useExecutePreparedCoa,
  useExecutedSnapshot,
  useValidateOperatorCoa,
  useUpdateMatrixOverlay,
  getExecuteBlockers,
  useDiscardOperatorCoa,
  useRemoveCoa,
  useRebaseOperatorCoa,
  useMergeOperatorIntoParent,
} from "./store";

export { reorderCoaCandidates } from "./candidateOrdering";
export {
  mergeOperatorRevisionIntoParent,
  validateOperatorCoaWithPipeline,
  createImportedOperatorDraft,
} from "./operatorCoaActions";
export {
  revalidateOperatorWithPipeline,
  type OperatorPipelineContext,
} from "./operatorPipelineRevalidation";
export { evaluateScheduledRevision } from "./validatedIntelSolver";
export { createImportedManualEntriesFromText } from "./manualSync";

export {
  collectRevisionBlockers,
  materializeCoaRevision,
  needsMaterializedValidation,
  type MaterializeRevisionContext,
} from "./materializeCoaRevision";

export { assertCoaState } from "./assertions";
export {
  runCyberEmulationAdapter,
  CYBER_EMULATION_CONFIG,
  type CyberEffectResult,
  type CyberEmulationProvider,
  type CyberEmulationRunOptions,
} from "./cyberEmulation";
