import {
  buildChipAssessments,
  type MatrixQuality,
  type MatrixQualityContext,
} from "./matrixQuality";
import {
  manualEntryToBarLabel,
  type ManualSyncEntry,
  type SyncTaskOrigin,
} from "./manualSync";
import {
  formatMatrixRowOption,
  formatTaskCardPrimary,
  mapCategoryToRowKey,
  syncGridRowLabel,
  SYNC_GRID_SECTIONS,
  SYNC_GRID_TASK_ROWS,
  type SyncGridRowKey,
  type SyncMatrixCategory,
} from "./syncGridSchema";
import {
  aggregateChipsByAction,
  buildSystemSyncBar,
  mergeChipAssessments,
  resolveCoaMatrixLabel,
} from "./syncMatrixPopulation";
import type { ObservedFact } from "../intel/types";
import type { LogisticsChip, LogisticsPlan } from "./types";
import {
  formatMatrixTick,
  formatMissionTick,
  resolveDefaultTickInterval,
} from "./matrixTimeScale";

export type { SyncMatrixCategory } from "./syncGridSchema";
export {
  formatMatrixRowOption,
  formatTaskCardPrimary,
  formatTaskCardSecondary,
  mapCategoryToRowKey,
  SYNC_GRID_TASK_ROWS,
  syncGridRowLabel,
  type SyncGridRowKey,
} from "./syncGridSchema";

export type SyncBarStatus =
  | "planned"
  | "active"
  | "complete"
  | "delayed"
  | "blocked"
  | "contingent";

export type SyncMatrixBar = {
  id: string;
  actionId: string;
  label: string;
  subLabel?: string;
  startSec: number;
  durationSec: number;
  status: SyncBarStatus;
  dependencies: string[];
  dependencyLabels: string[];
  resourceLabel?: string;
  reasons: string[];
  fixes: string[];
  origin: SyncTaskOrigin;
  actor?: string;
  target?: string;
  actionVerb?: string;
  targetFactIds?: string[];
  startCondition?: string;
  endTimeLabel?: string;
  missingFields: string[];
  rowKey?: string;
  operationalFunction?: string;
  sourceLabel?: string;
  isManual: boolean;
};

export type SyncMatrixRowKind = "section" | "meta" | "task" | "decision";

export type SyncDecisionMarker = {
  id: string;
  label: string;
  offsetSec?: number;
  unresolved?: boolean;
  detail?: string;
};

export type SyncMatrixRow = {
  id: string;
  label: string;
  kind: SyncMatrixRowKind;
  sectionId?: string;
  depth: 0 | 1;
  bars: SyncMatrixBar[];
  metaText?: string;
  decisionMarkers?: SyncDecisionMarker[];
};

export type SyncMatrixTick = {
  offsetSec: number;
  label: string;
};

export type SyncMatrixModel = {
  horizonSec: number;
  tickIntervalSec: number;
  ticks: SyncMatrixTick[];
  rows: SyncMatrixRow[];
  actionCount: number;
  coaLabel?: string;
};

export type SyncDecisionPointInput = {
  id: string;
  question: string;
  triggerFacts?: string[];
};

export type BuildSyncMatrixInput = {
  plan: Extract<LogisticsPlan, { kind: "populated" }>;
  tickIntervalSec?: number;
  qualityContext?: MatrixQualityContext;
  provisional?: boolean;
  manualEntries?: ManualSyncEntry[];
  modifiedBarIds?: Set<string> | string[];
  barPatches?: Record<string, Partial<Pick<SyncMatrixBar, "startSec" | "durationSec" | "status" | "rowKey" | "actor" | "target" | "subLabel" | "actionVerb">>>;
  hiddenBarIds?: Set<string> | string[];
  commanderIntent?: string;
  decisionPoints?: SyncDecisionPointInput[];
  observedFacts?: ObservedFact[];
  coaLabel?: string;
};

/** @deprecated Use SYNC_GRID_TASK_ROWS / formatMatrixRowOption */
export const CATEGORY_ORDER: SyncMatrixCategory[] = [
  "main-effort",
  "supporting-effort",
  "security",
  "isr",
  "fires",
  "cyber",
  "logistics",
  "reserve",
];

/** @deprecated Use formatMatrixRowOption */
export const CATEGORY_LABELS: Record<SyncMatrixCategory, string> = {
  "main-effort": "Maneuver / Main Effort",
  "supporting-effort": "Maneuver / Supporting Effort",
  security: "Protection / Security",
  isr: "ISR / Air ISR",
  fires: "Fires / Suppression",
  cyber: "Cyber / EW / Disruption",
  logistics: "Sustainment / Logistics",
  reserve: "Maneuver / Reserve",
};

export {
  formatMatrixTick,
  formatMissionTick,
  matrixTickInputPlaceholder,
  matrixTimeUnitForInterval,
  normalizeTickIntervalForUnit,
  parseMatrixTickToSec,
  parseMissionTickToSec,
  defaultTickIntervalForUnit,
  resolveDefaultTickInterval,
  resolveDefaultTimeScale,
  type MatrixTimeUnit,
  type MatrixTickOption,
  MATRIX_TICK_OPTIONS,
  MATRIX_TIME_UNIT_OPTIONS,
} from "./matrixTimeScale";

export function buildSyncMatrixModel(input: BuildSyncMatrixInput): SyncMatrixModel {
  const { plan, qualityContext, provisional } = input;
  const modifiedIds = new Set(input.modifiedBarIds ?? []);
  const assessments = buildChipAssessments(plan, qualityContext, provisional);
  const chipsByAction = aggregateChipsByAction(plan.chips);
  const chipById = new Map(plan.chips.map((chip) => [chip.id, chip]));
  const barsByRowKey = new Map<string, SyncMatrixBar[]>();
  const coaLabel = resolveCoaMatrixLabel(plan, input.coaLabel);

  for (const chip of chipsByAction.values()) {
    const groupChips = plan.chips.filter((groupChip) => groupChip.actionId === chip.actionId);
    const assessment = mergeChipAssessments(groupChips, assessments);
    const bar = buildSystemSyncBar({
      chip,
      assessment,
      chipById,
      coaLabel,
      modifiedIds,
    });
    const rowKey = bar.rowKey ?? mapCategoryToRowKey("supporting-effort", chip);
    const list = barsByRowKey.get(rowKey) ?? [];
    list.push(bar);
    barsByRowKey.set(rowKey, list);
  }

  for (const entry of input.manualEntries ?? []) {
    const rowKey = entry.rowKey ?? mapCategoryToRowKey(entry.category);
    const bar: SyncMatrixBar = {
      id: entry.id,
      actionId: entry.id,
      label: manualEntryToBarLabel(entry),
      subLabel: syncGridRowLabel(rowKey),
      startSec: entry.startSec,
      durationSec: entry.durationSec,
      status: entry.status,
      dependencies: entry.dependencyBarId ? [entry.dependencyBarId] : [],
      dependencyLabels: entry.dependency ? [entry.dependency] : [],
      resourceLabel: entry.actor,
      reasons: entry.missingFields.map((field) => `Missing ${field}`),
      fixes: entry.missingFields.map((field) => `Provide ${field} before execution`),
      origin: entry.origin,
      actor: entry.actor,
      target: entry.target,
      actionVerb: entry.actionVerb,
      targetFactIds: entry.targetFactId ? [entry.targetFactId] : [],
      startCondition: entry.startCondition,
      endTimeLabel: entry.endTimeLabel,
      missingFields: entry.missingFields,
      rowKey,
      isManual: true,
    };
    const list = barsByRowKey.get(rowKey) ?? [];
    list.push(bar);
    barsByRowKey.set(rowKey, list);
  }

  return assembleSyncMatrixModel(
    barsByRowKey,
    input,
    chipsByAction.size + (input.manualEntries?.length ?? 0),
    coaLabel
  );
}

export function buildManualOnlySyncMatrix(
  manualEntries: ManualSyncEntry[],
  input: Omit<BuildSyncMatrixInput, "plan"> = {}
): SyncMatrixModel {
  const barsByRowKey = new Map<string, SyncMatrixBar[]>();
  for (const entry of manualEntries) {
    const rowKey = entry.rowKey ?? mapCategoryToRowKey(entry.category);
    const bar: SyncMatrixBar = {
      id: entry.id,
      actionId: entry.id,
      label: manualEntryToBarLabel(entry),
      subLabel: syncGridRowLabel(rowKey),
      startSec: entry.startSec,
      durationSec: entry.durationSec,
      status: entry.status,
      dependencies: entry.dependencyBarId ? [entry.dependencyBarId] : [],
      dependencyLabels: entry.dependency ? [entry.dependency] : [],
      resourceLabel: entry.actor,
      reasons: entry.missingFields.map((field) => `Missing ${field}`),
      fixes: entry.missingFields.map((field) => `Provide ${field} before execution`),
      origin: entry.origin,
      actor: entry.actor,
      target: entry.target,
      actionVerb: entry.actionVerb,
      targetFactIds: entry.targetFactId ? [entry.targetFactId] : [],
      startCondition: entry.startCondition,
      endTimeLabel: entry.endTimeLabel,
      missingFields: entry.missingFields,
      rowKey,
      isManual: true,
    };
    const list = barsByRowKey.get(rowKey) ?? [];
    list.push(bar);
    barsByRowKey.set(rowKey, list);
  }
  return assembleSyncMatrixModel(
    barsByRowKey,
    input,
    manualEntries.length,
    input.coaLabel ?? "COA"
  );
}

function assembleSyncMatrixModel(
  barsByRowKey: Map<string, SyncMatrixBar[]>,
  input: Omit<BuildSyncMatrixInput, "plan">,
  actionCount: number,
  coaLabel: string
): SyncMatrixModel {
  const patches = input.barPatches ?? {};
  const hidden = new Set(input.hiddenBarIds ?? []);
  const grouped = regroupBars(barsByRowKey, patches, hidden);
  const maxEnd = Math.max(
    0,
    ...[...grouped.values()].flatMap((bars) =>
      bars.map((bar) => bar.startSec + bar.durationSec)
    ),
    0
  );
  const tickIntervalSec =
    input.tickIntervalSec ?? resolveDefaultTickInterval(maxEnd);
  const horizonSec = Math.max(
    tickIntervalSec * 5,
    Math.ceil(maxEnd / tickIntervalSec) * tickIntervalSec || tickIntervalSec * 5
  );
  const ticks = buildTicks(horizonSec, tickIntervalSec);
  const decisionMarkers = buildDecisionMarkers(
    input.decisionPoints ?? [],
    horizonSec,
    tickIntervalSec,
    input.observedFacts ?? []
  );

  const rows: SyncMatrixRow[] = [
    {
      id: "commanders-intent",
      label: "COMMANDER'S INTENT",
      kind: "meta",
      depth: 0,
      bars: [],
      metaText:
        input.commanderIntent?.trim() ||
        "State commander intent after intel validation and COA selection.",
    },
    {
      id: "decision-points",
      label: "DECISION POINTS",
      kind: "decision",
      depth: 0,
      bars: [],
      decisionMarkers,
    },
  ];

  for (const section of SYNC_GRID_SECTIONS) {
    rows.push({
      id: `section-${section.id}`,
      label: section.label,
      kind: "section",
      sectionId: section.id,
      depth: 0,
      bars: [],
    });

    for (const taskRow of SYNC_GRID_TASK_ROWS.filter((row) =>
      row.section === section.label
    )) {
      const key = taskRow.rowKey;
      const bars = (grouped.get(key) ?? []).sort(
        (a, b) => a.startSec - b.startSec || a.label.localeCompare(b.label)
      );
      rows.push({
        id: key,
        label: taskRow.label,
        kind: "task",
        sectionId: section.id,
        depth: 1,
        bars,
      });
    }
  }

  rows.push({
    id: "notes-assumptions",
    label: "NOTES / ASSUMPTIONS",
    kind: "meta",
    depth: 0,
    bars: [],
    metaText: input.provisional
      ? "Provisional matrix — resolve red/yellow issues before execution."
      : "Add assumptions, constraints, and branch plans here.",
  });

  return {
    horizonSec,
    tickIntervalSec,
    ticks,
    rows,
    actionCount,
    coaLabel,
  };
}

function buildDecisionMarkers(
  points: SyncDecisionPointInput[],
  horizonSec: number,
  tickIntervalSec: number,
  observedFacts: ObservedFact[]
): SyncDecisionMarker[] {
  if (points.length === 0) return [];
  const missionBaselineSec = resolveMissionClockBaseline(observedFacts);
  const factOffsetById = new Map(
    observedFacts
      .map(
        (fact) =>
          [
            fact.id,
            parseFactTimeToMissionSec(fact.time, missionBaselineSec),
          ] as const
      )
      .filter((entry): entry is [string, number] => entry[1] !== undefined)
  );

  return points.map((point, index) => {
    const label = `DP-${index + 1}`;
    const triggerOffsets = (point.triggerFacts ?? [])
      .map((factId) => factOffsetById.get(factId))
      .filter((value): value is number => value !== undefined);
    const offsetSec =
      triggerOffsets.length > 0
        ? Math.min(horizonSec - tickIntervalSec, Math.max(...triggerOffsets))
        : undefined;

    if (offsetSec === undefined) {
      return {
        id: point.id,
        label,
        unresolved: true,
        detail: point.question?.trim() || "Trigger timing required",
      };
    }

    return {
      id: point.id,
      label,
      offsetSec,
      detail: point.question?.trim(),
    };
  });
}

function resolveMissionClockBaseline(facts: ObservedFact[]): number | undefined {
  const clockSecs = facts
    .map((fact) => parseScenarioClockSec(fact.time))
    .filter((value): value is number => value !== undefined);
  if (clockSecs.length === 0) return undefined;
  return Math.min(...clockSecs);
}

function parseScenarioClockSec(time: string): number | undefined {
  const clock = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!clock) return undefined;
  return Number(clock[1]) * 3600 + Number(clock[2]) * 60;
}

function parseFactTimeToMissionSec(
  time: string,
  missionBaselineSec?: number
): number | undefined {
  const trimmed = time.trim();
  const hMatch = trimmed.match(/H\+(\d{1,3})/i);
  if (hMatch) return Number(hMatch[1]) * 60;
  const clockSec = parseScenarioClockSec(trimmed);
  if (clockSec === undefined) return undefined;
  if (missionBaselineSec === undefined) return undefined;
  return Math.max(0, clockSec - missionBaselineSec);
}

function regroupBars(
  barsByRowKey: Map<string, SyncMatrixBar[]>,
  patches: Record<string, Partial<SyncMatrixBar>>,
  hidden: Set<string>
): Map<string, SyncMatrixBar[]> {
  const grouped = new Map<string, SyncMatrixBar[]>();
  for (const [defaultKey, bars] of barsByRowKey.entries()) {
    for (const bar of bars) {
      if (hidden.has(bar.id)) continue;
      const patched = applyBarPatch(bar, patches[bar.id], bar.rowKey ?? defaultKey);
      const key = patched.rowKey ?? bar.rowKey ?? defaultKey;
      const list = grouped.get(key) ?? [];
      list.push({ ...patched, rowKey: key });
      grouped.set(key, list);
    }
  }
  return grouped;
}

function applyBarPatch(
  bar: SyncMatrixBar,
  patch: Partial<SyncMatrixBar> | undefined,
  defaultRowKey: string
): SyncMatrixBar {
  if (!patch) return bar;
  const rowKey = patch.rowKey ?? bar.rowKey ?? defaultRowKey;
  const actor = patch.actor ?? bar.actor;
  const target = patch.target ?? bar.target;
  const actionVerb = patch.actionVerb ?? bar.actionVerb;
  return {
    ...bar,
    ...patch,
    rowKey,
    actor,
    target,
    actionVerb,
    label: formatTaskCardPrimary({
      actor,
      actionVerb,
      label: bar.label,
    }),
    origin: bar.origin === "system-generated" ? "user-modified" : bar.origin,
  };
}

function buildTicks(horizonSec: number, tickIntervalSec: number): SyncMatrixTick[] {
  const ticks: SyncMatrixTick[] = [];
  for (let offset = 0; offset <= horizonSec; offset += tickIntervalSec) {
    ticks.push({ offsetSec: offset, label: formatMissionTick(offset) });
  }
  return ticks;
}

export function qualityToSyncStatus(level: MatrixQuality): SyncBarStatus {
  if (level === "red") return "blocked";
  if (level === "yellow") return "contingent";
  return "planned";
}

export function snapSecToTick(sec: number, tickIntervalSec: number): number {
  return Math.max(0, Math.round(sec / tickIntervalSec) * tickIntervalSec);
}
