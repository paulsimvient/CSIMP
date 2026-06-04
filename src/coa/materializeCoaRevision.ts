import type { ObservedFact } from "../intel/types";
import { assessChip } from "./matrixQuality";
import { buildRevisionEffects, computeOverallScore } from "./effects";
import { buildLogisticsPlan, scoreLogisticsPlan } from "./logistics";
import type { IntelActionContext } from "./logisticsScene";
import { CONSTRAINTS_VERSION, SCORING_MODEL_VERSION } from "./pipeline";
import {
  buildManualOnlySyncMatrix,
  buildSyncMatrixModel,
  type SyncMatrixBar,
} from "./syncMatrix";
import { validateManualEntry } from "./manualSync";
import { coaOrigin } from "./operatorCoa";
import type {
  CoaCandidate,
  CoaId,
  CoaAction,
  CoaValidationRecord,
  LogisticsPlan,
  MatrixOverlay,
  ValidatedOrderSet,
  ValidatedOrderSetTask,
} from "./types";

export type MaterializeRevisionContext = {
  intelActions?: IntelActionContext[];
  observedFacts?: ObservedFact[];
  coaLabel?: string;
};

export type MaterializeRevisionResult = {
  blockers: string[];
  candidate?: CoaCandidate;
  orderSet?: ValidatedOrderSet;
  validation?: CoaValidationRecord;
};

function slugResource(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "unassigned-asset";
}

function inferActionType(bar: SyncMatrixBar): string {
  const verb = (bar.actionVerb ?? "").toLowerCase();
  if (/strike|suppress|fires/.test(verb)) return "strike";
  if (/observe|monitor|isr|recon/.test(verb)) return "observe";
  if (/cyber|disrupt|jam/.test(verb)) return "cyber";
  if (/coordinate/.test(verb)) return "coordinate";
  if (/preserve|screen|secure/.test(verb)) return "preserve";
  return "other";
}

export function collectVisibleSyncBars(
  candidate: CoaCandidate,
  overlay: MatrixOverlay,
  ctx: MaterializeRevisionContext = {}
): SyncMatrixBar[] {
  const base = candidate.logisticsPlan;
  const matrixInput = {
    manualEntries: overlay.manualEntries,
    barPatches: overlay.barPatches,
    hiddenBarIds: overlay.hiddenBarIds,
    modifiedBarIds: overlay.modifiedBarIds,
    coaLabel: ctx.coaLabel ?? candidate.label,
    observedFacts: ctx.observedFacts,
  };

  const model =
    base.kind === "populated"
      ? buildSyncMatrixModel({ plan: base, ...matrixInput })
      : overlay.manualEntries.length > 0
        ? buildManualOnlySyncMatrix(overlay.manualEntries, matrixInput)
        : null;

  if (!model) return [];
  return model.rows.flatMap((row) => row.bars);
}

export function collectRevisionBlockers(
  candidate: CoaCandidate,
  overlay: MatrixOverlay,
  ctx: MaterializeRevisionContext = {}
): string[] {
  const blockers: string[] = [];
  const bars = collectVisibleSyncBars(candidate, overlay, ctx);
  const visibleIds = new Set(bars.map((bar) => bar.id));
  const visibleActionIds = new Set(bars.map((bar) => bar.actionId));

  if (bars.length === 0) {
    blockers.push("No executable tasks in the visible matrix");
    return blockers;
  }

  for (const raw of overlay.manualEntries) {
    const entry = validateManualEntry(raw);
    if (!entry.confirmed || entry.missingFields.length > 0) {
      blockers.push(
        `Manual task "${entry.subLabel}" needs ${entry.missingFields.join(", ") || "completion"} — edit it in the left task panel`
      );
    }
    if (entry.dependencyBarId && !visibleIds.has(entry.dependencyBarId)) {
      blockers.push(
        `Manual task "${entry.subLabel}" depends on a removed or hidden task`
      );
    }
  }

  for (const bar of bars) {
    const blockingFields = bar.isManual
      ? bar.missingFields
      : bar.missingFields.filter((field) => field === "timing");
    if (blockingFields.length > 0) {
      const detail =
        blockingFields.includes("timing") && bar.startSec >= 0 && bar.durationSec > 0
          ? "confirmed start/end on the timeline"
          : blockingFields.join(", ");
      blockers.push(`Task "${bar.label}" needs ${detail}`);
    }

    for (const depId of bar.dependencies) {
      if (!visibleIds.has(depId) && !visibleActionIds.has(depId)) {
        blockers.push(
          `Task "${bar.label}" depends on "${depId}" which was removed or hidden`
        );
      }
    }

    if (bar.isManual && !(bar.targetFactIds?.length ?? 0) && !bar.target?.trim()) {
      blockers.push(`Manual task "${bar.label}" lacks grounded target evidence`);
    }
  }

  if (candidate.logisticsPlan.kind === "populated") {
    const chipById = new Map(candidate.logisticsPlan.chips.map((chip) => [chip.id, chip]));
    for (const bar of bars) {
      if (bar.isManual) continue;
      const chip = chipById.get(bar.id);
      if (!chip) continue;
      const factIds = bar.targetFactIds ?? chip.citedFactIds ?? chip.linkedFactIds;
      const assessment = assessChip(
        factIds?.length
          ? { ...chip, citedFactIds: factIds, linkedFactIds: factIds }
          : chip
      );
      if (assessment.level === "red") {
        blockers.push(
          `Task "${bar.label}": ${assessment.reasons[0] ?? "insufficient evidence"}`
        );
      }
    }
  }

  const resourceWindows = new Map<string, Array<{ start: number; end: number; label: string }>>();
  for (const bar of bars) {
    const resource = slugResource(bar.resourceLabel ?? bar.actor ?? "unassigned-asset");
    const windows = resourceWindows.get(resource) ?? [];
    windows.push({
      start: bar.startSec,
      end: bar.startSec + bar.durationSec,
      label: bar.label,
    });
    resourceWindows.set(resource, windows);
  }

  for (const [resource, windows] of resourceWindows) {
    const sorted = [...windows].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const curr = sorted[i]!;
      if (curr.start < prev.end) {
        blockers.push(
          `Resource "${resource}" double-booked between "${prev.label}" and "${curr.label}"`
        );
      }
    }
  }

  return [...new Set(blockers)];
}

function barToCoaAction(bar: SyncMatrixBar): CoaAction {
  const resource = bar.resourceLabel ?? bar.actor ?? "command-element";
  return {
    id: bar.actionId || bar.id,
    name: bar.label,
    type: inferActionType(bar),
    startTime: bar.startSec,
    duration: Math.max(bar.durationSec, 60),
    resources: [slugResource(resource)],
  };
}

function buildOrderSet(
  revisionId: string,
  bars: SyncMatrixBar[]
): ValidatedOrderSet {
  const tasks: ValidatedOrderSetTask[] = bars.map((bar) => ({
    id: bar.id,
    actionId: bar.actionId,
    label: bar.label,
    startSec: bar.startSec,
    durationSec: bar.durationSec,
    rowKey: bar.rowKey,
    actor: bar.actor,
    target: bar.target,
    actionVerb: bar.actionVerb,
    status: bar.status,
    origin: bar.origin,
    dependencies: [...bar.dependencies],
    targetFactIds: bar.targetFactIds ? [...bar.targetFactIds] : undefined,
    isManual: bar.isManual,
  }));

  return {
    revisionId,
    actionCount: tasks.length,
    tasks,
  };
}

function evidenceSnapshotId(
  observedFacts: ObservedFact[] | undefined,
  overlay: MatrixOverlay
): string {
  const factIds = (observedFacts ?? []).map((f) => f.id).sort().join(",");
  const manualFacts = overlay.manualEntries
    .map((e) => e.targetFactId ?? "")
    .filter(Boolean)
    .sort()
    .join(",");
  let h = 5381;
  const payload = `${factIds}|${manualFacts}`;
  for (let i = 0; i < payload.length; i++) {
    h = ((h << 5) + h + payload.charCodeAt(i)) >>> 0;
  }
  return `evidence-${h.toString(36)}`;
}

export function materializeCoaRevision(
  candidate: CoaCandidate,
  overlay: MatrixOverlay,
  ctx: MaterializeRevisionContext = {}
): MaterializeRevisionResult {
  const blockers = collectRevisionBlockers(candidate, overlay, ctx);
  if (blockers.length > 0) {
    return { blockers };
  }

  const bars = collectVisibleSyncBars(candidate, overlay, ctx);
  const actions = bars.map(barToCoaAction);
  const source =
    candidate.logisticsPlan.kind === "populated"
      ? candidate.logisticsPlan.source
      : "validated-intel";

  const logisticsPlan: LogisticsPlan = buildLogisticsPlan({
    coaId: candidate.id,
    actions,
    source,
    intelActions: ctx.intelActions,
    observedFacts: ctx.observedFacts,
  });

  if (logisticsPlan.kind !== "populated") {
    return { blockers: ["Could not build a populated logistics plan from the visible matrix"] };
  }

  const priorChips =
    candidate.logisticsPlan.kind === "populated"
      ? new Map(candidate.logisticsPlan.chips.map((chip) => [chip.id, chip]))
      : new Map<string, import("./types").LogisticsChip>();
  const barByActionId = new Map(bars.map((bar) => [bar.actionId || bar.id, bar]));

  const enrichedPlan: typeof logisticsPlan = {
    ...logisticsPlan,
    chips: logisticsPlan.chips.map((chip) => {
      const bar = barByActionId.get(chip.actionId);
      const prior = bar ? priorChips.get(bar.id) : undefined;
      const factIds =
        bar?.targetFactIds?.length
          ? bar.targetFactIds
          : prior?.citedFactIds ?? prior?.linkedFactIds;
      if (!factIds?.length) return chip;
      return {
        ...chip,
        citedFactIds: [...factIds],
        linkedFactIds: [...factIds],
      };
    }),
  };

  const logisticsScore = scoreLogisticsPlan(enrichedPlan);
  const feasibility = actions.length > 0 ? 1 : 0;

  let scored: CoaCandidate = {
    ...candidate,
    selectedActions: actions,
    logisticsPlan: enrichedPlan,
    status: "sat",
    validationStatus: "validated",
    revisionId: overlay.revisionId,
    scores: {
      feasibility,
      logistics: logisticsScore,
      effects: candidate.scores.effects,
      risk: candidate.scores.risk,
      overall: computeOverallScore(
        feasibility,
        logisticsScore,
        candidate.scores.effects,
        candidate.scores.risk
      ),
    },
  };

  const effects = buildRevisionEffects(scored);
  scored = {
    ...scored,
    effects: effects.summary,
    scores: {
      ...scored.scores,
      effects: effects.score,
      risk: effects.risk,
      overall: computeOverallScore(
        feasibility,
        logisticsScore,
        effects.score,
        effects.risk
      ),
    },
  };

  const orderSet = buildOrderSet(overlay.revisionId, bars);
  const validation: CoaValidationRecord = {
    validatedAt: new Date().toISOString(),
    constraintsVersion: CONSTRAINTS_VERSION,
    scoringVersion: SCORING_MODEL_VERSION,
    evidenceSnapshotId: evidenceSnapshotId(ctx.observedFacts, overlay),
    blockers: [],
  };

  return {
    blockers: [],
    candidate: {
      ...scored,
      validation,
      validatedOrderSet: orderSet,
      validationBlockers: undefined,
    },
    orderSet,
    validation,
  };
}

export function needsMaterializedValidation(candidate: CoaCandidate): boolean {
  const origin = coaOrigin(candidate);
  return (
    origin === "operator-authored" ||
    origin === "operator-modified" ||
    origin === "imported"
  );
}
