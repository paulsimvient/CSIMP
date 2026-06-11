import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  deleteSqlSnapshot,
  loadSqlSnapshot,
  saveSqlSnapshot,
} from "../persistence/sqlState";
import { assertCoaState } from "./assertions";
import { EMPTY_DISPLAYED_PLAN } from "./logisticsConstants";
import {
  createOperatorDraftCandidate,
  createImportedOperatorDraft,
  validateOperatorCoaWithPipeline,
  executePreparedCoa,
  prepareAndExecuteCoa,
  forkOperatorModifiedCandidate,
  normalizeCoaState,
  preserveOperatorCoasOnPipeline,
  prepareExecution,
  setMatrixOverlay,
  validateOperatorCoa,
  removeCoaCandidate,
  mergeOperatorRevisionIntoParent,
  rebaseOperatorCoa,
} from "./operatorCoaActions";
import { needsMaterializedValidation } from "./materializeCoaRevision";
import { emptyMatrixOverlay, getMatrixOverlay } from "./operatorCoa";
import type { MatrixOverlay } from "./types";
import {
  pickDefaultSelectedCoa,
  resolveDisplayedLogisticsPlan,
  runCoaPipeline,
  selectRankedCandidates,
  selectSelectedCoa,
} from "./pipeline";
import type { EvidenceConflict } from "../intel/evidence";
import type { CoaCandidate, CoaId, CoaState, LogisticsPlan, PipelineInput } from "./types";

// ─── Store shape ──────────────────────────────────────────────────────────────

export type ValidateOperatorResult = {
  ok: boolean;
  blockers: string[];
};

type CoaStore = CoaState & {
  runPipeline: (input?: PipelineInput) => Promise<void>;
  selectCoa: (coaId: CoaId) => void;
  reset: () => void;
  createOperatorDraft: () => CoaId | undefined;
  createImportedOperatorDraft: (manualEntries?: import("./manualSync").ManualSyncEntry[]) => CoaId | undefined;
  forkOperatorModified: (parentId: CoaId) => CoaId | undefined;
  updateMatrixOverlay: (
    coaId: CoaId,
    updater: (prev: MatrixOverlay) => MatrixOverlay
  ) => void;
  validateOperatorCoaRevision: (
    coaId: CoaId,
    ctx?: import("./operatorPipelineRevalidation").OperatorPipelineContext
  ) => Promise<ValidateOperatorResult>;
  prepareCoaExecution: (
    coaId: CoaId,
    ctx?: import("./materializeCoaRevision").MaterializeRevisionContext
  ) => void;
  discardOperatorCoa: (coaId: CoaId) => void;
  removeCoa: (coaId: CoaId) => void;
  rebaseOperatorCoa: (operatorCoaId: CoaId, newParentId: CoaId) => void;
  mergeOperatorIntoParent: (operatorCoaId: CoaId) => void;
  executePreparedCoaRevision: () => boolean;
  executeCoaRevision: (
    coaId: CoaId,
    ctx?: import("./materializeCoaRevision").MaterializeRevisionContext
  ) => { ok: boolean; blockers: string[] };
  clearPreparedExecution: () => void;
};

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_STATE: CoaState = {
  candidatesById: {},
  candidateOrder: [],
  status: "idle",
  matrixOverlaysByCoaId: {},
};

const COA_SQL_KEY = "coa_state";

export { EMPTY_DISPLAYED_PLAN, EMPTY_LOGISTICS_NOT_BUILT } from "./logisticsConstants";

/** Stable empty array — selectors must not allocate `[]` per subscription tick. */
export const EMPTY_EVIDENCE_CONFLICTS: EvidenceConflict[] = [];

function commitState(next: CoaState): void {
  const normalized = normalizeCoaState(next);
  assertCoaState(normalized);
  useCoaStore.setState(normalized);
  void persistCoaState(normalized);
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useCoaStore = create<CoaStore>()((set, get) => ({
  ...INITIAL_STATE,

  runPipeline: async (input: PipelineInput = { mode: "validated-intel" }) => {
    const previous = normalizeCoaState(get());
    set({ status: "running" });
    void persistCoaState({ ...previous, status: "running" });

    try {
      const generated = await runCoaPipeline(input);
      const nextState = preserveOperatorCoasOnPipeline(previous, generated);
      commitState(nextState);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorState = { ...get(), status: "error" as const, error: message };
      set(errorState);
      void persistCoaState(errorState);
    }
  },

  selectCoa: (coaId: CoaId) => {
    const state = normalizeCoaState(get());

    if (!state.candidatesById[coaId]) {
      console.warn(`[COA store] selectCoa: unknown coaId "${coaId}"`);
      return;
    }

    if (state.selectedCoaId === coaId) return;

    commitState({ ...state, selectedCoaId: coaId, preparedExecution: undefined });
  },

  reset: () => {
    set(INITIAL_STATE);
    void deleteSqlSnapshot(COA_SQL_KEY);
  },

  createOperatorDraft: () => {
    const { draftId, state } = createOperatorDraftCandidate(normalizeCoaState(get()));
    commitState(state);
    return draftId;
  },

  createImportedOperatorDraft: (manualEntries) => {
    const { draftId, state } = createImportedOperatorDraft(
      normalizeCoaState(get()),
      manualEntries ?? []
    );
    commitState(state);
    return draftId;
  },

  forkOperatorModified: (parentId: CoaId) => {
    const result = forkOperatorModifiedCandidate(normalizeCoaState(get()), parentId);
    if (!result) return undefined;
    commitState(result.state);
    return result.forkId;
  },

  updateMatrixOverlay: (coaId, updater) => {
    const state = setMatrixOverlay(normalizeCoaState(get()), coaId, updater);
    commitState(state);
  },

  validateOperatorCoaRevision: async (coaId, ctx) => {
    const state = normalizeCoaState(get());
    const candidate = state.candidatesById[coaId];
    if (!candidate) {
      return { ok: false, blockers: ["No COA selected for validation"] };
    }
    if (!needsMaterializedValidation(candidate)) {
      return {
        ok: false,
        blockers: ["Only operator or imported COA drafts can be validated"],
      };
    }

    useCoaStore.setState({
      candidatesById: {
        ...state.candidatesById,
        [coaId]: { ...candidate, status: "validating" },
      },
    });

    try {
      const next = await validateOperatorCoaWithPipeline(
        normalizeCoaState(get()),
        coaId,
        ctx
      );
      commitState(next);
      const updated = next.candidatesById[coaId];
      if (
        updated?.validationStatus === "validated" &&
        updated.status === "sat" &&
        !(updated.validationBlockers?.length)
      ) {
        return { ok: true, blockers: [] };
      }
      return {
        ok: false,
        blockers:
          updated?.validationBlockers?.length
            ? updated.validationBlockers
            : ["Validation failed — review matrix tasks and try again"],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stuck = normalizeCoaState(get());
      const current = stuck.candidatesById[coaId];
      if (current?.status === "validating") {
        commitState({
          ...stuck,
          candidatesById: {
            ...stuck.candidatesById,
            [coaId]: {
              ...current,
              status: "incomplete",
              validationStatus: "unvalidated",
              validationBlockers: [message],
            },
          },
          preparedExecution: undefined,
        });
      }
      return { ok: false, blockers: [message] };
    }
  },

  prepareCoaExecution: (coaId, ctx) => {
    commitState(prepareExecution(normalizeCoaState(get()), coaId, ctx));
  },

  discardOperatorCoa: (coaId) => {
    commitState(removeCoaCandidate(normalizeCoaState(get()), coaId));
  },

  removeCoa: (coaId) => {
    commitState(removeCoaCandidate(normalizeCoaState(get()), coaId));
  },

  rebaseOperatorCoa: (operatorCoaId, newParentId) => {
    commitState(rebaseOperatorCoa(normalizeCoaState(get()), operatorCoaId, newParentId));
  },

  mergeOperatorIntoParent: (operatorCoaId) => {
    commitState(
      mergeOperatorRevisionIntoParent(normalizeCoaState(get()), operatorCoaId)
    );
  },

  executePreparedCoaRevision: () => {
    const before = normalizeCoaState(get());
    const after = executePreparedCoa(before);
    if (after.executedSnapshot === before.executedSnapshot) return false;
    commitState(after);
    return true;
  },

  executeCoaRevision: (coaId, ctx) => {
    const result = prepareAndExecuteCoa(normalizeCoaState(get()), coaId, ctx);
    commitState(result.state);
    return { ok: result.ok, blockers: result.blockers };
  },

  clearPreparedExecution: () => {
    const state = normalizeCoaState(get());
    if (!state.preparedExecution) return;
    commitState({ ...state, preparedExecution: undefined });
  },
}));

// ─── React hooks ─────────────────────────────────────────────────────────────

export function useDisplayedPlan(): LogisticsPlan | typeof EMPTY_DISPLAYED_PLAN {
  return useCoaStore((s) => resolveDisplayedLogisticsPlan(s));
}

export function useSelectedCoa(): CoaCandidate | undefined {
  return useCoaStore((s) => selectSelectedCoa(s));
}

export function useRankedCandidates(): CoaCandidate[] {
  return useCoaStore(useShallow((s) => selectRankedCandidates(s)));
}

export function usePipelineStatus(): CoaState["status"] {
  return useCoaStore((s) => s.status);
}

export function usePipelineError(): string | undefined {
  return useCoaStore((s) => s.error);
}

export function useRunPipeline() {
  return useCoaStore((s) => s.runPipeline);
}

export function useSelectCoa() {
  return useCoaStore((s) => s.selectCoa);
}

export function useResetCoa() {
  return useCoaStore((s) => s.reset);
}

export function useEvidenceConflicts(): EvidenceConflict[] {
  return useCoaStore((s) => s.evidenceConflicts ?? EMPTY_EVIDENCE_CONFLICTS);
}

export function useRankingSensitivity() {
  return useCoaStore((s) => s.rankingSensitivity);
}

export function useRunMetadata() {
  return useCoaStore((s) => s.runMetadata);
}

export function useMatrixOverlayForSelected(): MatrixOverlay {
  return useCoaStore(useShallow((s) => getMatrixOverlay(s, s.selectedCoaId)));
}

export function useMatrixOverlay(coaId: CoaId | undefined): MatrixOverlay {
  return useCoaStore(useShallow((s) => getMatrixOverlay(s, coaId)));
}

export function usePreparedExecution() {
  return useCoaStore((s) => s.preparedExecution);
}

export function useExecutedSnapshot() {
  return useCoaStore((s) => s.executedSnapshot);
}

export function useCreateOperatorDraft() {
  return useCoaStore((s) => s.createOperatorDraft);
}

export function useCreateImportedOperatorDraft() {
  return useCoaStore((s) => s.createImportedOperatorDraft);
}

export function useForkOperatorModified() {
  return useCoaStore((s) => s.forkOperatorModified);
}

export function useUpdateMatrixOverlay() {
  return useCoaStore((s) => s.updateMatrixOverlay);
}

export function useValidateOperatorCoa() {
  return useCoaStore((s) => s.validateOperatorCoaRevision);
}

export function useDiscardOperatorCoa() {
  return useCoaStore((s) => s.removeCoa);
}

export function useRemoveCoa() {
  return useCoaStore((s) => s.removeCoa);
}

export function useRebaseOperatorCoa() {
  return useCoaStore((s) => s.rebaseOperatorCoa);
}

export function useMergeOperatorIntoParent() {
  return useCoaStore((s) => s.mergeOperatorIntoParent);
}

export function usePrepareCoaExecution() {
  return useCoaStore((s) => s.prepareCoaExecution);
}

export function useExecutePreparedCoa() {
  return useCoaStore((s) => s.executePreparedCoaRevision);
}

export function useExecuteCoaRevision() {
  return useCoaStore((s) => s.executeCoaRevision);
}

export function useClearPreparedExecution() {
  return useCoaStore((s) => s.clearPreparedExecution);
}

function sanitizeHydratedCoaState(state: CoaState): CoaState {
  const merged = normalizeCoaState({
    ...INITIAL_STATE,
    ...state,
    status: state.status === "running" ? "idle" : state.status,
  });

  const ranked = selectRankedCandidates(merged);
  if (ranked.length === 0) return merged;

  const selected = merged.selectedCoaId
    ? merged.candidatesById[merged.selectedCoaId]
    : undefined;
  if (selected?.logisticsPlan.kind === "populated") return merged;

  const better = pickDefaultSelectedCoa(ranked);
  if (better?.logisticsPlan.kind === "populated") {
    return { ...merged, selectedCoaId: better.id };
  }

  return merged;
}

async function persistCoaState(state: CoaState): Promise<void> {
  await saveSqlSnapshot(COA_SQL_KEY, state);
}

export async function hydrateCoaState(): Promise<boolean> {
  const snapshot = await loadSqlSnapshot<CoaState>(COA_SQL_KEY);
  if (!snapshot) return false;
  useCoaStore.setState(sanitizeHydratedCoaState(snapshot));
  return true;
}

export { emptyMatrixOverlay, EMPTY_MATRIX_OVERLAY, getExecuteBlockers, getMatrixOverlay } from "./operatorCoa";
export {
  canSelectCandidate,
  candidateBadgeLabel,
  coaOrigin,
  executionStatusMessage,
  hasOverlayChanges,
  isOperatorCandidate,
  overlayDiffSummary,
} from "./operatorCoa";
