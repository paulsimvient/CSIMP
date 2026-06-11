import { collectRevisionBlockers } from "./materializeCoaRevision";
import type { ManualSyncEntry } from "./manualSync";
import type { MaterializeRevisionContext } from "./materializeCoaRevision";
import type {
  CoaCandidate,
  CoaId,
  CoaOrigin,
  CoaState,
  ExecutedCoaSnapshot,
  MatrixOverlay,
  PreparedExecution,
} from "./types";

import type { MatrixBarPatch } from "./types";

export type BarPatch = MatrixBarPatch;

export function coaOrigin(candidate: CoaCandidate): CoaOrigin {
  return candidate.origin ?? "automated";
}

export function isOperatorCandidate(candidate: CoaCandidate): boolean {
  const origin = coaOrigin(candidate);
  return (
    origin === "operator-authored" ||
    origin === "operator-modified" ||
    origin === "imported"
  );
}

export const EMPTY_MATRIX_OVERLAY: MatrixOverlay = {
  revisionId: "rev-base",
  manualEntries: [],
  barPatches: {},
  hiddenBarIds: [],
  modifiedBarIds: [],
};

/** Fresh overlay for mutations — do not use as a Zustand selector fallback. */
export function emptyMatrixOverlay(): MatrixOverlay {
  return {
    revisionId: EMPTY_MATRIX_OVERLAY.revisionId,
    manualEntries: [],
    barPatches: {},
    hiddenBarIds: [],
    modifiedBarIds: [],
  };
}

export function hasOverlayChanges(overlay: MatrixOverlay): boolean {
  return (
    overlay.manualEntries.length > 0 ||
    overlay.hiddenBarIds.length > 0 ||
    overlay.modifiedBarIds.length > 0 ||
    Object.keys(overlay.barPatches).length > 0
  );
}

export function computeOverlayRevisionId(overlay: MatrixOverlay): string {
  const payload = JSON.stringify({
    manual: overlay.manualEntries.map((e) => ({
      id: e.id,
      startSec: e.startSec,
      durationSec: e.durationSec,
      rowKey: e.rowKey,
      confirmed: e.confirmed,
      missingFields: e.missingFields,
    })),
    hidden: [...overlay.hiddenBarIds].sort(),
    modified: [...overlay.modifiedBarIds].sort(),
    patches: overlay.barPatches,
  });
  let h = 5381;
  for (let i = 0; i < payload.length; i++) {
    h = ((h << 5) + h + payload.charCodeAt(i)) >>> 0;
  }
  return `rev-${h.toString(36)}`;
}

export function withOverlayRevision(overlay: MatrixOverlay): MatrixOverlay {
  return { ...overlay, revisionId: computeOverlayRevisionId(overlay) };
}

/** Manual tasks are baked into logistics on validate — drop overlay copies to avoid duplicate bars. */
export function overlayAfterSuccessfulMaterialization(
  overlay: MatrixOverlay
): MatrixOverlay {
  return withOverlayRevision({
    ...overlay,
    manualEntries: [],
  });
}

export function getMatrixOverlay(
  state: CoaState,
  coaId: CoaId | undefined
): MatrixOverlay {
  if (!coaId) return EMPTY_MATRIX_OVERLAY;
  const targetId = resolveMatrixOverlayCoaId(state, coaId);
  return state.matrixOverlaysByCoaId?.[targetId] ?? EMPTY_MATRIX_OVERLAY;
}

/** Matrix edits for automated COAs live on the operator-modified fork when one exists. */
export function resolveMatrixOverlayCoaId(
  state: CoaState,
  coaId: CoaId
): CoaId {
  const candidate = state.candidatesById[coaId];
  if (!candidate || coaOrigin(candidate) !== "automated") return coaId;
  const existingFork = Object.values(state.candidatesById).find(
    (c) => c.parentCoaId === coaId
  );
  return existingFork?.id ?? coaId;
}

export function overlayDiffSummary(
  overlay: MatrixOverlay,
  baseCandidate?: CoaCandidate
): { added: number; changed: number; removed: number } {
  const added = overlay.manualEntries.filter((e) => e.origin === "user-added").length;
  const removed = overlay.hiddenBarIds.length;
  const changed = overlay.modifiedBarIds.length;
  if (!baseCandidate) return { added, changed, removed };
  return { added, changed, removed };
}

export type ExecuteReadinessInput = {
  candidate?: CoaCandidate;
  overlay: MatrixOverlay;
  preparedExecution?: PreparedExecution;
  coaRunning?: boolean;
  logisticsReady?: boolean;
  materializeContext?: MaterializeRevisionContext;
};

export function getExecuteBlockers(input: ExecuteReadinessInput): string[] {
  const blockers: string[] = [];
  const { candidate, overlay, preparedExecution, coaRunning, logisticsReady, materializeContext } =
    input;

  if (coaRunning) blockers.push("COA pipeline is still running");
  if (!candidate) {
    blockers.push("No COA selected");
    return blockers;
  }

  const origin = coaOrigin(candidate);

  if (origin === "automated" && hasOverlayChanges(overlay)) {
    blockers.push(
      "Matrix differs from validated automated COA — fork as operator-modified variant or discard edits"
    );
  }

  if (origin === "operator-modified") {
    if (candidate.validationStatus !== "validated") {
      blockers.push("Operator-modified COA requires validation before execution");
    }
    if (candidate.validationStatus === "stale") {
      blockers.push("Operator-modified COA is stale — revalidate after new intel or regeneration");
    }
  }

  if (origin === "operator-authored" || origin === "imported") {
    if (candidate.status === "draft" || candidate.status === "incomplete") {
      blockers.push(
        origin === "imported"
          ? "Imported COA draft must be validated before execution"
          : "Operator COA draft must be validated before execution"
      );
    }
    if (candidate.validationStatus === "stale") {
      blockers.push(
        origin === "imported"
          ? "Imported COA is stale — revalidate after new intel or regeneration"
          : "Operator COA is stale — revalidate after new intel or regeneration"
      );
    }
  }

  const revisionBlockers = collectRevisionBlockers(
    candidate,
    overlay,
    materializeContext ?? {}
  );
  for (const reason of revisionBlockers) {
    if (!blockers.includes(reason)) blockers.push(reason);
  }

  if (candidate.validationBlockers?.length) {
    blockers.push(
      `Validation failed — ${candidate.validationBlockers.length} issue${candidate.validationBlockers.length === 1 ? "" : "s"} remain`
    );
  }

  if (origin !== "operator-authored" && !logisticsReady) {
    blockers.push("Logistics matrix must be populated before execution");
  }

  if (candidate.status !== "sat" && origin === "automated") {
    blockers.push("Selected COA is not feasible (SAT)");
  }

  if (
    candidate.status !== "sat" &&
    origin !== "operator-authored" &&
    origin !== "operator-modified"
  ) {
    blockers.push(`COA status is ${candidate.status}`);
  }

  if (preparedExecution) {
    if (preparedExecution.candidateId !== candidate.id) {
      blockers.push("Prepared execution belongs to a different COA");
    } else if (preparedExecution.revisionId !== overlay.revisionId) {
      blockers.push("Visible matrix changed since last preparation — prepare again");
    }
  } else if (!preparedExecution) {
    const needsPrepare =
      hasOverlayChanges(overlay) ||
      (isOperatorCandidate(candidate) && candidate.validationStatus !== "validated");
    if (needsPrepare || origin === "automated") {
      blockers.push("Prepare execution snapshot before committing");
    }
  }

  return blockers;
}

export function canSelectCandidate(candidate: CoaCandidate): boolean {
  const origin = coaOrigin(candidate);
  if (origin === "operator-authored" || origin === "imported") {
    return candidate.status === "draft" || candidate.status === "incomplete" || candidate.status === "sat";
  }
  if (origin === "operator-modified") {
    return true;
  }
  return candidate.status === "sat";
}

export function candidateBadgeLabel(
  candidate: CoaCandidate,
  selected: boolean
): string {
  if (candidate.status === "validating") return "Validating";
  const origin = coaOrigin(candidate);
  if (selected && candidate.validationStatus === "validated" && candidate.status === "sat") {
    return "Selected";
  }
  if (origin === "automated") {
    return candidate.status === "sat" ? "Feasible" : candidate.status.toUpperCase();
  }
  if (origin === "operator-authored") {
    if (candidate.status === "draft") return "Draft";
    if (candidate.validationStatus === "validated") return "Validated";
    return "Incomplete";
  }
  if (origin === "imported") {
    if (candidate.status === "draft") return "Draft";
    if (candidate.validationStatus === "validated") return "Validated";
    return "Incomplete";
  }
  if (origin === "operator-modified") {
    if (candidate.validationStatus === "stale") return "Stale";
    if (candidate.validationStatus === "validated") return "Validated";
    return "Revalidate";
  }
  return feasibilityLabel(candidate.status);
}

function feasibilityLabel(status: CoaCandidate["status"]): string {
  switch (status) {
    case "sat":
      return "FEASIBLE";
    case "unsat":
      return "NOT FEASIBLE";
    case "insufficient_evidence":
      return "INSUFFICIENT EVIDENCE";
    case "error":
      return "ERROR";
    case "draft":
      return "DRAFT";
    case "validating":
      return "VALIDATING…";
    default:
      return status.toUpperCase();
  }
}

export function executionStatusMessage(
  snapshot: ExecutedCoaSnapshot | undefined,
  candidate: CoaCandidate | undefined
): { title: string; detail: string } | null {
  if (!snapshot || !candidate || snapshot.candidateId !== candidate.id) return null;
  const origin = coaOrigin(candidate);
  const prefix =
    origin === "operator-modified"
      ? "Operator-modified"
      : origin === "operator-authored"
        ? "Operator"
        : "Automated";
  return {
    title: `${prefix} ${snapshot.label} is executing.`,
    detail: `Validated revision ${snapshot.revisionId} is now the active order set.`,
  };
}

export function nextOperatorDraftLabel(state: CoaState): string {
  const count = Object.values(state.candidatesById).filter(
    (c) => coaOrigin(c) === "operator-authored"
  ).length;
  return `Operator COA — Draft ${count + 1}`;
}

export function nextForkLabel(parent: CoaCandidate, state: CoaState): string {
  const forks = Object.values(state.candidatesById).filter(
    (c) => c.parentCoaId === parent.id
  ).length;
  const suffix = forks === 0 ? "v1" : `v${forks + 1}`;
  return `${parent.label} — Operator Modified ${suffix}`;
}

export function createOperatorDraftId(state: CoaState): CoaId {
  const n =
    Object.values(state.candidatesById).filter(
      (c) => coaOrigin(c) === "operator-authored"
    ).length + 1;
  return `operator-draft-${n}` as CoaId;
}

export function nextImportedDraftLabel(state: CoaState): string {
  const count = Object.values(state.candidatesById).filter(
    (c) => coaOrigin(c) === "imported"
  ).length;
  return `Imported COA — ${count + 1}`;
}

export function createImportedDraftId(state: CoaState): CoaId {
  const n =
    Object.values(state.candidatesById).filter((c) => coaOrigin(c) === "imported")
      .length + 1;
  return `imported-draft-${n}` as CoaId;
}

export function createForkId(parentId: CoaId, state: CoaState): CoaId {
  const forks = Object.values(state.candidatesById).filter(
    (c) => c.parentCoaId === parentId
  ).length;
  return `${parentId}-op-${forks + 1}` as CoaId;
}

export const ZERO_SCORES = {
  feasibility: 0,
  logistics: 0,
  effects: 0,
  risk: 0,
  overall: 0,
} as const;
