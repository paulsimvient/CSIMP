import { reorderCoaCandidates } from "./candidateOrdering";
import { buildLogisticsPlan, cloneLogisticsPlanForCoa } from "./logistics";
import { pickDefaultSelectedCoa } from "./pipeline";
import type { ManualSyncEntry } from "./manualSync";
import {
  revalidateOperatorWithPipeline,
  type OperatorPipelineContext,
} from "./operatorPipelineRevalidation";
import {
  collectRevisionBlockers,
  materializeCoaRevision,
  needsMaterializedValidation,
  type MaterializeRevisionContext,
} from "./materializeCoaRevision";
import {
  coaOrigin,
  createForkId,
  createOperatorDraftId,
  createImportedDraftId,
  emptyMatrixOverlay,
  getExecuteBlockers,
  getMatrixOverlay,
  hasOverlayChanges,
  overlayAfterSuccessfulMaterialization,
  isOperatorCandidate,
  nextForkLabel,
  nextImportedDraftLabel,
  nextOperatorDraftLabel,
  resolveMatrixOverlayCoaId,
  withOverlayRevision,
  ZERO_SCORES,
} from "./operatorCoa";
import type { CoaCandidate, CoaId, CoaState, MatrixOverlay } from "./types";

export type { MaterializeRevisionContext, OperatorPipelineContext };

export function normalizeCandidate(candidate: CoaCandidate): CoaCandidate {
  return {
    ...candidate,
    origin: candidate.origin ?? "automated",
    revisionId: candidate.revisionId ?? `rev-${candidate.id}`,
  };
}

export function normalizeCoaState(state: CoaState): CoaState {
  const candidatesById = Object.fromEntries(
    Object.entries(state.candidatesById).map(([id, c]) => [id, normalizeCandidate(c)])
  ) as Record<CoaId, CoaCandidate>;

  return {
    ...state,
    candidatesById,
    matrixOverlaysByCoaId: state.matrixOverlaysByCoaId ?? {},
  };
}

export function preserveOperatorCoasOnPipeline(
  previous: CoaState,
  generated: CoaState
): CoaState {
  const operatorCandidates = Object.values(previous.candidatesById).filter(
    (c) => isOperatorCandidate(c)
  );
  if (operatorCandidates.length === 0) {
    return {
      ...generated,
      matrixOverlaysByCoaId: previous.matrixOverlaysByCoaId ?? {},
      preparedExecution: undefined,
    };
  }

  const candidatesById = { ...generated.candidatesById };
  const candidateOrder = [...generated.candidateOrder];

  for (const op of operatorCandidates) {
    const stale: CoaCandidate = {
      ...op,
      validationStatus: op.validationStatus === "validated" ? "stale" : op.validationStatus,
      status: op.status === "sat" ? "stale" : op.status,
    };
    candidatesById[op.id] = stale;
    if (!candidateOrder.includes(op.id)) {
      candidateOrder.push(op.id);
    }
  }

  return {
    ...generated,
    candidatesById,
    candidateOrder,
    matrixOverlaysByCoaId: previous.matrixOverlaysByCoaId ?? {},
    preparedExecution: undefined,
    selectedCoaId: generated.selectedCoaId ?? previous.selectedCoaId,
  };
}

export function createOperatorDraftCandidate(state: CoaState): {
  state: CoaState;
  draftId: CoaId;
} {
  const id = createOperatorDraftId(state);
  const runId = state.activeRunId ?? ("operator" as CoaState["activeRunId"]);
  const candidate: CoaCandidate = {
    id,
    runId: runId!,
    origin: "operator-authored",
    revisionId: `rev-${Date.now()}`,
    status: "draft",
    validationStatus: "unvalidated",
    label: nextOperatorDraftLabel(state),
    selectedActions: [],
    logisticsPlan: { kind: "empty", reason: "no-actions" },
    scores: { ...ZERO_SCORES },
  };

  const overlay = withOverlayRevision(emptyMatrixOverlay());

  return {
    draftId: id,
    state: {
      ...state,
      candidatesById: { ...state.candidatesById, [id]: candidate },
      candidateOrder: [...state.candidateOrder, id],
      selectedCoaId: id,
      matrixOverlaysByCoaId: {
        ...(state.matrixOverlaysByCoaId ?? {}),
        [id]: overlay,
      },
      preparedExecution: undefined,
    },
  };
}

export function createImportedOperatorDraft(
  state: CoaState,
  manualEntries: ManualSyncEntry[] = []
): { state: CoaState; draftId: CoaId } {
  const id = createImportedDraftId(state);
  const runId = state.activeRunId ?? ("imported" as CoaState["activeRunId"]);
  const candidate: CoaCandidate = {
    id,
    runId: runId!,
    origin: "imported",
    revisionId: `rev-${Date.now()}`,
    status: "draft",
    validationStatus: "unvalidated",
    label: nextImportedDraftLabel(state),
    selectedActions: [],
    logisticsPlan: { kind: "empty", reason: "no-actions" },
    scores: { ...ZERO_SCORES },
  };

  const overlay = withOverlayRevision({
    ...emptyMatrixOverlay(),
    manualEntries,
  });

  return {
    draftId: id,
    state: {
      ...state,
      candidatesById: { ...state.candidatesById, [id]: candidate },
      candidateOrder: [...state.candidateOrder, id],
      selectedCoaId: id,
      matrixOverlaysByCoaId: {
        ...(state.matrixOverlaysByCoaId ?? {}),
        [id]: overlay,
      },
      preparedExecution: undefined,
    },
  };
}

export async function validateOperatorCoaWithPipeline(
  state: CoaState,
  coaId: CoaId,
  ctx: OperatorPipelineContext = {},
  deps?: { effectsEngine?: import("./types").EffectsEngineFn }
): Promise<CoaState> {
  const candidate = state.candidatesById[coaId];
  if (!candidate || !needsMaterializedValidation(candidate)) return state;

  const overlay = state.matrixOverlaysByCoaId?.[coaId] ?? emptyMatrixOverlay();
  const result = materializeCoaRevision(candidate, overlay, {
    ...ctx,
    coaLabel: ctx.coaLabel ?? candidate.label,
  });

  if (result.blockers.length > 0 || !result.candidate) {
    return {
      ...state,
      candidatesById: {
        ...state.candidatesById,
        [coaId]: {
          ...candidate,
          status: "incomplete",
          validationStatus: "unvalidated",
          validationBlockers: result.blockers,
          validatedOrderSet: undefined,
          validation: undefined,
        },
      },
      preparedExecution: undefined,
    };
  }

  const rescored = await revalidateOperatorWithPipeline(result.candidate, ctx, deps);
  if (rescored.validationBlockers?.length || rescored.status !== "sat") {
    return {
      ...state,
      candidatesById: {
        ...state.candidatesById,
        [coaId]: {
          ...rescored,
          validationStatus: "unvalidated",
          validatedOrderSet: undefined,
          validation: undefined,
        },
      },
      preparedExecution: undefined,
    };
  }

  return reorderCoaCandidates({
    ...state,
    candidatesById: {
      ...state.candidatesById,
      [coaId]: {
        ...rescored,
        validation: result.validation,
        validatedOrderSet: result.orderSet,
      },
    },
    matrixOverlaysByCoaId: {
      ...(state.matrixOverlaysByCoaId ?? {}),
      [coaId]: overlayAfterSuccessfulMaterialization(overlay),
    },
    preparedExecution: undefined,
  });
}

export function forkOperatorModifiedCandidate(
  state: CoaState,
  parentId: CoaId
): { state: CoaState; forkId: CoaId } | undefined {
  const parent = state.candidatesById[parentId];
  if (!parent || coaOrigin(parent) === "operator-authored") return undefined;

  const forkId = createForkId(parentId, state);
  const runId = parent.runId;

  const logisticsPlan =
    parent.logisticsPlan.kind === "populated"
      ? cloneLogisticsPlanForCoa(parent.logisticsPlan, forkId)
      : parent.logisticsPlan;

  const fork: CoaCandidate = {
    ...parent,
    id: forkId,
    runId,
    origin: "operator-modified",
    parentCoaId: parentId,
    revisionId: `rev-${Date.now()}`,
    validationStatus: "unvalidated",
    status: "incomplete",
    label: nextForkLabel(parent, state),
    logisticsPlan,
    dominatedBy: undefined,
    rankingExplanation: undefined,
  };

  const parentOverlay = state.matrixOverlaysByCoaId?.[parentId] ?? emptyMatrixOverlay();
  const overlay = withOverlayRevision({
    ...parentOverlay,
    ...(state.matrixOverlaysByCoaId?.[forkId] ?? {}),
  });

  const overlays = { ...(state.matrixOverlaysByCoaId ?? {}), [forkId]: overlay };
  delete overlays[parentId];

  return {
    forkId,
    state: {
      ...state,
      candidatesById: { ...state.candidatesById, [forkId]: fork },
      candidateOrder: state.candidateOrder.includes(forkId)
        ? state.candidateOrder
        : [...state.candidateOrder, forkId],
      selectedCoaId: forkId,
      matrixOverlaysByCoaId: overlays,
      preparedExecution: undefined,
    },
  };
}

export function ensureForkBeforeMatrixEdit(
  state: CoaState,
  coaId: CoaId | undefined
): CoaState {
  if (!coaId) return state;
  const candidate = state.candidatesById[coaId];
  if (!candidate) return state;
  const origin = coaOrigin(candidate);
  if (origin !== "automated") return state;

  const overlay = state.matrixOverlaysByCoaId?.[coaId];
  if (!overlay || !hasOverlayChanges(overlay)) return state;

  const existingFork = Object.values(state.candidatesById).find(
    (c) => c.parentCoaId === coaId && c.validationStatus !== "validated"
  );
  if (existingFork) {
    return { ...state, selectedCoaId: existingFork.id };
  }

  const forked = forkOperatorModifiedCandidate(state, coaId);
  return forked?.state ?? state;
}

function resolveOverlayTargetId(state: CoaState, coaId: CoaId): CoaId {
  return resolveMatrixOverlayCoaId(state, coaId);
}

export function setMatrixOverlay(
  state: CoaState,
  coaId: CoaId,
  updater: (prev: MatrixOverlay) => MatrixOverlay
): CoaState {
  let targetId = resolveOverlayTargetId(state, coaId);
  let nextState =
    targetId !== coaId ? { ...state, selectedCoaId: targetId } : state;

  const prev = nextState.matrixOverlaysByCoaId?.[targetId] ?? emptyMatrixOverlay();
  const next = withOverlayRevision(updater(prev));
  nextState = {
    ...nextState,
    matrixOverlaysByCoaId: {
      ...(nextState.matrixOverlaysByCoaId ?? {}),
      [targetId]: next,
    },
    preparedExecution:
      nextState.preparedExecution?.candidateId === targetId &&
      nextState.preparedExecution.revisionId !== next.revisionId
        ? undefined
        : nextState.preparedExecution,
  };

  const candidate = nextState.candidatesById[targetId];
  if (candidate && coaOrigin(candidate) === "automated" && hasOverlayChanges(next)) {
    const forked = forkOperatorModifiedCandidate(nextState, targetId);
    if (forked) nextState = forked.state;
  }

  return nextState;
}

export function validateOperatorCoa(
  state: CoaState,
  coaId: CoaId,
  ctx: MaterializeRevisionContext = {}
): CoaState {
  const candidate = state.candidatesById[coaId];
  if (!candidate || !needsMaterializedValidation(candidate)) return state;

  const overlay = state.matrixOverlaysByCoaId?.[coaId] ?? emptyMatrixOverlay();
  const result = materializeCoaRevision(candidate, overlay, {
    ...ctx,
    coaLabel: ctx.coaLabel ?? candidate.label,
  });

  if (result.blockers.length > 0 || !result.candidate) {
    return {
      ...state,
      candidatesById: {
        ...state.candidatesById,
        [coaId]: {
          ...candidate,
          status: "incomplete",
          validationStatus: "unvalidated",
          validationBlockers: result.blockers,
          validatedOrderSet: undefined,
          validation: undefined,
        },
      },
      preparedExecution: undefined,
    };
  }

  return reorderCoaCandidates({
    ...state,
    candidatesById: { ...state.candidatesById, [coaId]: result.candidate! },
    matrixOverlaysByCoaId: {
      ...(state.matrixOverlaysByCoaId ?? {}),
      [coaId]: overlayAfterSuccessfulMaterialization(overlay),
    },
    preparedExecution: undefined,
  });
}

export function mergeOperatorRevisionIntoParent(
  state: CoaState,
  operatorCoaId: CoaId
): CoaState {
  const operator = state.candidatesById[operatorCoaId];
  const parentId = operator?.parentCoaId;
  if (
    !operator ||
    !parentId ||
    coaOrigin(operator) !== "operator-modified" ||
    operator.validationStatus !== "validated" ||
    !operator.validatedOrderSet
  ) {
    return state;
  }

  const parent = state.candidatesById[parentId];
  if (!parent || coaOrigin(parent) !== "automated") return state;

  const mergedParent: CoaCandidate = {
    ...parent,
    selectedActions: operator.selectedActions,
    logisticsPlan: operator.logisticsPlan,
    scores: operator.scores,
    effects: operator.effects,
    validation: operator.validation,
    validatedOrderSet: operator.validatedOrderSet,
    validationStatus: "validated",
    validationBlockers: undefined,
    revisionId: operator.revisionId ?? parent.revisionId,
    status: "sat",
    dominatedBy: undefined,
  };

  const candidatesById = { ...state.candidatesById, [parentId]: mergedParent };
  delete candidatesById[operatorCoaId];

  const overlays = { ...(state.matrixOverlaysByCoaId ?? {}) };
  delete overlays[operatorCoaId];
  delete overlays[parentId];

  return reorderCoaCandidates({
    ...state,
    candidatesById,
    candidateOrder: state.candidateOrder.filter((id) => id !== operatorCoaId),
    matrixOverlaysByCoaId: overlays,
    selectedCoaId: parentId,
    preparedExecution: undefined,
    executedSnapshot:
      state.executedSnapshot?.candidateId === operatorCoaId
        ? undefined
        : state.executedSnapshot,
  });
}

export function prepareExecution(
  state: CoaState,
  coaId: CoaId,
  ctx: MaterializeRevisionContext = {}
): CoaState {
  const candidate = state.candidatesById[coaId];
  if (!candidate) return state;
  const overlay = state.matrixOverlaysByCoaId?.[coaId] ?? emptyMatrixOverlay();

  if (candidate.validationStatus === "validated") {
    const materialized = materializeCoaRevision(candidate, overlay, ctx);
    if (
      materialized.blockers.length === 0 &&
      materialized.orderSet &&
      materialized.validation?.evidenceSnapshotId
    ) {
      const working = materialized.candidate ?? candidate;
      const persistMaterialized =
        coaOrigin(candidate) === "automated" &&
        working !== candidate &&
        working.logisticsPlan.kind === "populated";

      const nextState: CoaState = {
        ...state,
        ...(persistMaterialized
          ? { candidatesById: { ...state.candidatesById, [coaId]: working } }
          : {}),
        preparedExecution: {
          candidateId: coaId,
          revisionId: overlay.revisionId,
          preparedAt: new Date().toISOString(),
          label: candidate.label,
          origin: coaOrigin(candidate),
          orderSet: materialized.orderSet,
          evidenceSnapshotId: materialized.validation.evidenceSnapshotId,
        },
      };

      return persistMaterialized ? reorderCoaCandidates(nextState) : nextState;
    }
  }

  let working = candidate;
  let orderSet = candidate.validatedOrderSet;
  let evidenceSnapshotId = candidate.validation?.evidenceSnapshotId;

  if (needsMaterializedValidation(candidate)) {
    if (candidate.validationStatus !== "validated" || !orderSet) return state;
  } else if (coaOrigin(candidate) === "automated") {
    const revisionBlockers = collectRevisionBlockers(candidate, overlay, ctx);
    if (revisionBlockers.length > 0) return state;
    const materialized = materializeCoaRevision(candidate, overlay, ctx);
    if (!materialized.orderSet) return state;
    orderSet = materialized.orderSet;
    evidenceSnapshotId = materialized.validation?.evidenceSnapshotId;
    working = materialized.candidate ?? candidate;
  }

  const blockers =
    working.validationStatus === "validated" && orderSet
      ? collectRevisionBlockers(working, overlay, ctx)
      : getExecuteBlockers({
          candidate: working,
          overlay,
          logisticsReady: working.logisticsPlan.kind === "populated",
        }).filter((b) => !b.includes("Prepare execution"));

  if (blockers.length > 0 || !orderSet || !evidenceSnapshotId) return state;

  const persistMaterialized =
    coaOrigin(candidate) === "automated" &&
    working !== candidate &&
    working.logisticsPlan.kind === "populated";

  const nextState: CoaState = {
    ...state,
    ...(persistMaterialized
      ? { candidatesById: { ...state.candidatesById, [coaId]: working } }
      : {}),
    preparedExecution: {
      candidateId: coaId,
      revisionId: overlay.revisionId,
      preparedAt: new Date().toISOString(),
      label: candidate.label,
      origin: coaOrigin(candidate),
      orderSet,
      evidenceSnapshotId,
    },
  };

  return persistMaterialized ? reorderCoaCandidates(nextState) : nextState;
}

export function executePreparedCoa(state: CoaState): CoaState {
  const prepared = state.preparedExecution;
  if (!prepared) return state;

  const candidate = state.candidatesById[prepared.candidateId];
  if (!candidate) return state;

  const overlay = getMatrixOverlay(state, prepared.candidateId);

  const blockers = getExecuteBlockers({
    candidate,
    overlay,
    preparedExecution: prepared,
    logisticsReady: candidate.logisticsPlan.kind === "populated",
  });

  if (blockers.length > 0) return state;

  return {
    ...state,
    executedSnapshot: {
      candidateId: prepared.candidateId,
      revisionId: prepared.revisionId,
      label: prepared.label,
      origin: prepared.origin,
      executedAt: new Date().toISOString(),
      orderSet: prepared.orderSet,
      evidenceSnapshotId: prepared.evidenceSnapshotId,
    },
  };
}

export function describeExecuteFailure(
  state: CoaState,
  coaId: CoaId,
  ctx: MaterializeRevisionContext = {}
): string[] {
  const candidate = state.candidatesById[coaId];
  if (!candidate) return ["No COA selected"];
  return getExecuteBlockers({
    candidate,
    overlay: getMatrixOverlay(state, coaId),
    preparedExecution: state.preparedExecution,
    logisticsReady: candidate.logisticsPlan.kind === "populated",
    materializeContext: ctx,
  });
}

export function prepareAndExecuteCoa(
  state: CoaState,
  coaId: CoaId,
  ctx: MaterializeRevisionContext = {}
): { state: CoaState; ok: boolean; blockers: string[] } {
  const beforeSnapshot = state.executedSnapshot;
  let next = prepareExecution(state, coaId, ctx);
  next = executePreparedCoa(next);
  if (next.executedSnapshot !== beforeSnapshot) {
    return { state: next, ok: true, blockers: [] };
  }
  return {
    state: next,
    ok: false,
    blockers: describeExecuteFailure(next, coaId, ctx),
  };
}

export function removeCoaCandidate(state: CoaState, coaId: CoaId): CoaState {
  const candidate = state.candidatesById[coaId];
  if (!candidate) return state;

  const candidatesById = { ...state.candidatesById };
  delete candidatesById[coaId];

  const overlays = { ...(state.matrixOverlaysByCoaId ?? {}) };
  delete overlays[coaId];

  const candidateOrder = state.candidateOrder.filter((id) => id !== coaId);
  const ranked = candidateOrder
    .map((id) => candidatesById[id])
    .filter((item): item is CoaCandidate => Boolean(item));
  const nextSelected =
    state.selectedCoaId === coaId
      ? (pickDefaultSelectedCoa(ranked)?.id ?? ranked[0]?.id)
      : state.selectedCoaId;

  return reorderCoaCandidates({
    ...state,
    candidatesById,
    candidateOrder,
    matrixOverlaysByCoaId: overlays,
    selectedCoaId: nextSelected,
    preparedExecution:
      state.preparedExecution?.candidateId === coaId ? undefined : state.preparedExecution,
    executedSnapshot:
      state.executedSnapshot?.candidateId === coaId ? undefined : state.executedSnapshot,
  });
}

export function discardOperatorCoa(state: CoaState, coaId: CoaId): CoaState {
  return removeCoaCandidate(state, coaId);
}

export function rebaseOperatorCoa(
  state: CoaState,
  operatorCoaId: CoaId,
  newParentId: CoaId
): CoaState {
  const operator = state.candidatesById[operatorCoaId];
  const parent = state.candidatesById[newParentId];
  if (!operator || !parent || coaOrigin(parent) !== "automated") return state;

  const overlay = state.matrixOverlaysByCoaId?.[operatorCoaId] ?? emptyMatrixOverlay();
  const logisticsPlan =
    parent.logisticsPlan.kind === "populated"
      ? cloneLogisticsPlanForCoa(parent.logisticsPlan, operatorCoaId)
      : parent.logisticsPlan;

  const rebased: CoaCandidate = {
    ...operator,
    parentCoaId: newParentId,
    runId: parent.runId,
    status: operator.status === "stale" ? "incomplete" : operator.status,
    validationStatus: "unvalidated",
    logisticsPlan,
    validatedOrderSet: undefined,
    validation: undefined,
    validationBlockers: undefined,
    revisionId: overlay.revisionId,
  };

  return {
    ...state,
    candidatesById: { ...state.candidatesById, [operatorCoaId]: rebased },
    preparedExecution: undefined,
  };
}
