import type { ObservedFact } from "../intel/types";
import { createChipId, createLaneId } from "./ids";
import {
  buildLogisticsSceneContext,
  enrichLogisticsChip,
  enrichLogisticsLaneLabel,
  type IntelActionContext,
  type LogisticsSceneContext,
} from "./logisticsScene";
import type {
  CoaAction,
  CoaId,
  LogisticsChip,
  LogisticsDependencyKind,
  LogisticsLane,
  LogisticsPlan,
  PlanSource,
} from "./types";

// ─── Logistics builder ────────────────────────────────────────────────────────

type BuildLogisticsPlanInput = {
  coaId: CoaId;
  actions: CoaAction[];
  source: PlanSource;
  intelActions?: IntelActionContext[];
  observedFacts?: ObservedFact[];
};

/**
 * Converts a COA's selected actions into a populated logistics plan.
 *
 * Lanes are keyed by resource: each required asset gets its own lane.
 * Multi-asset actions produce one chip per resource lane.
 * Intra-lane dependencies chain sequential chips on the same resource.
 *
 * This runs synchronously — it is pure data transformation, not I/O.
 * It is called inside the pipeline after the solver returns, before any
 * state is committed.
 *
 * Rules enforced here:
 *   - If actions is empty, returns kind "empty" with reason "no-actions".
 *   - Every chip's laneId references a lane in the returned plan.
 *   - The returned plan's coaId matches the provided coaId.
 */
export function buildLogisticsPlan(
  input: BuildLogisticsPlanInput
): LogisticsPlan {
  const { coaId, actions, source, intelActions, observedFacts } = input;

  if (actions.length === 0) {
    return { kind: "empty", reason: "no-actions" };
  }

  const scene = buildLogisticsSceneContext(intelActions, observedFacts);
  const T0 = Math.min(...actions.map((a) => a.startTime));

  const laneMap = new Map<string, { lane: LogisticsLane; chips: LogisticsChip[] }>();

  const orderedActions = [...actions].sort(
    (a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id)
  );

  for (const action of orderedActions) {
    const resources =
      action.resources.length > 0 ? action.resources : ["command-element"];
    for (const resource of resources) {
      const laneId = createLaneId(coaId, resource);

      if (!laneMap.has(laneId)) {
        laneMap.set(laneId, {
          lane: {
            id: laneId,
            label: enrichLogisticsLaneLabel(resource, scene),
            chipIds: [],
          },
          chips: [],
        });
      }

      const entry = laneMap.get(laneId)!;
      const chipId = `chip-${coaId}-${action.id}-${sanitizeForId(resource)}`;

      const prevChipId =
        entry.chips.length > 0
          ? entry.chips[entry.chips.length - 1]!.id
          : undefined;

      const baseChip: LogisticsChip = {
        id: chipId,
        actionId: action.id,
        label: action.name,
        laneId,
        startOffset: action.startTime - T0,
        duration: action.duration,
        dependencies: prevChipId ? [prevChipId] : [],
        typedDependencies: prevChipId
          ? [{ chipId: prevChipId, kind: "requires-completion" }]
          : [],
      };

      const chip = enrichLogisticsChip(baseChip, action, scene);

      entry.chips.push(chip);
      entry.lane.chipIds.push(chipId);
    }
  }

  // Cross-lane dependencies: later actions that cite overlapping facts depend on earlier chips.
  const chipsByAction = new Map<string, LogisticsChip[]>();
  for (const { chips } of laneMap.values()) {
    for (const chip of chips) {
      const list = chipsByAction.get(chip.actionId) ?? [];
      list.push(chip);
      chipsByAction.set(chip.actionId, list);
    }
  }

  // Cross-lane evidence dependencies: later actions that cite overlapping facts
  // depend on earlier chips that produced or collected those facts (may overlap in time).
  for (let i = 1; i < orderedActions.length; i++) {
    const curr = orderedActions[i]!;
    const currChips = chipsByAction.get(curr.id) ?? [];
    if (currChips.length === 0) continue;

    for (let j = 0; j < i; j++) {
      const prev = orderedActions[j]!;
      if (prev.startTime > curr.startTime) continue;

      const prevChips = chipsByAction.get(prev.id) ?? [];
      const prevFacts = new Set(prevChips.flatMap((chip) => chip.linkedFactIds ?? []));
      if (prevFacts.size === 0 || prevChips.length === 0) continue;

      for (const chip of currChips) {
        const sharesFact = (chip.linkedFactIds ?? []).some((id) => prevFacts.has(id));
        if (!sharesFact) continue;
        const kind = inferCrossLaneDependencyKind(prev, curr, scene);
        for (const prevChip of prevChips) {
          if (chip.dependencies.includes(prevChip.id)) {
            upsertTypedDependency(chip, prevChip.id, kind);
            continue;
          }
          chip.dependencies.push(prevChip.id);
          upsertTypedDependency(chip, prevChip.id, kind);
        }
      }
    }
  }

  const lanes: LogisticsLane[] = [];
  const chips: LogisticsChip[] = [];

  for (const { lane, chips: laneChips } of laneMap.values()) {
    lanes.push(lane);
    chips.push(...laneChips);
  }

  const span =
    Math.max(...chips.map((c) => c.startOffset + c.duration), 0) -
    Math.min(...chips.map((c) => c.startOffset), 0);
  const totalDuration = Math.max(span, Math.max(...chips.map((c) => c.duration), 1));

  const plan: LogisticsPlan = {
    kind: "populated",
    source,
    coaId,
    lanes,
    chips,
    totalDuration,
  };
  return assertSafePlan(plan);
}

/** Deep-clone a populated plan for a forked COA id, preserving chip evidence metadata. */
export function cloneLogisticsPlanForCoa(
  plan: Extract<LogisticsPlan, { kind: "populated" }>,
  coaId: CoaId
): Extract<LogisticsPlan, { kind: "populated" }> {
  const laneIdByOld = new Map<string, string>();
  const lanes = plan.lanes.map((lane) => {
    const resourceKey = lane.label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "lane";
    const nextId = createLaneId(coaId, resourceKey);
    laneIdByOld.set(lane.id, nextId);
    return { ...lane, id: nextId, chipIds: [] as string[] };
  });

  const chipIdByOld = new Map<string, string>();
  const chips = plan.chips.map((chip) => {
    const nextChipId = createChipId(coaId, chip.actionId);
    chipIdByOld.set(chip.id, nextChipId);
    return {
      ...chip,
      id: nextChipId,
      laneId: laneIdByOld.get(chip.laneId) ?? chip.laneId,
      dependencies: chip.dependencies.map((dep) => chipIdByOld.get(dep) ?? dep),
    };
  });

  for (const chip of chips) {
    chip.dependencies = chip.dependencies.map((dep) => chipIdByOld.get(dep) ?? dep);
  }

  for (const lane of lanes) {
    lane.chipIds = chips.filter((chip) => chip.laneId === lane.id).map((chip) => chip.id);
  }

  return {
    ...plan,
    coaId,
    lanes,
    chips,
  };
}

// ─── Score logistics quality ──────────────────────────────────────────────────

/**
 * Returns a logistics score in [0, 1] based on plan properties.
 * Higher is better: efficient timeline use, reasonable parallelism, no same-lane overlaps.
 */
export function scoreLogisticsPlan(plan: LogisticsPlan): number {
  if (plan.kind !== "populated") return 0;

  const { chips, totalDuration, lanes } = plan;

  if (chips.length === 0) return 0;

  const uniqueActions = new Map<string, LogisticsChip>();
  for (const chip of chips) uniqueActions.set(chip.actionId, chip);

  const totalActionTime = [...uniqueActions.values()].reduce(
    (sum, chip) => sum + chip.duration,
    0
  );
  const density = totalActionTime / (totalDuration * Math.max(lanes.length, 1));
  const resourceCoverage = Math.min(1, lanes.length / Math.max(uniqueActions.size, 1));

  const overlapCount = countSameLaneTimeOverlaps(plan);
  const overlapPenalty = Math.min(0.5, overlapCount * 0.25);

  return clamp(density * 0.65 + resourceCoverage * 0.35 - overlapPenalty, 0, 1);
}

/** Overlapping chips on the same resource lane indicate scheduling conflict. */
function countSameLaneTimeOverlaps(
  plan: Extract<LogisticsPlan, { kind: "populated" }>
): number {
  let overlaps = 0;
  for (const lane of plan.lanes) {
    const laneChips = plan.chips.filter((c) => c.laneId === lane.id);
    for (let i = 0; i < laneChips.length; i++) {
      for (let j = i + 1; j < laneChips.length; j++) {
        const a = laneChips[i]!;
        const b = laneChips[j]!;
        const aEnd = a.startOffset + a.duration;
        const bEnd = b.startOffset + b.duration;
        if (a.startOffset < bEnd && b.startOffset < aEnd) {
          overlaps++;
        }
      }
    }
  }
  return overlaps;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const BLOCKED_TERMS = [
  "cyber strike",
  "strike",
  "blockade",
  "air superiority",
  "offensive",
  "kinetic",
  "c2 nodes",
];

function containsBlockedTerm(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_TERMS.some((term) => lower.includes(term));
}

export function assertSafePlan(plan: LogisticsPlan): LogisticsPlan {
  if (plan.kind !== "populated" || plan.source !== "validated-intel") {
    return plan;
  }

  const unsafeChip = plan.chips.find((chip) => containsBlockedTerm(chip.label));
  const unsafeLane = plan.lanes.find((lane) => containsBlockedTerm(lane.label));

  if (unsafeChip || unsafeLane) {
    throw new Error(
      `Unsafe/demo COA label detected: ${unsafeChip?.label ?? unsafeLane?.label}`
    );
  }

  return plan;
}

function sanitizeForId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function inferCrossLaneDependencyKind(
  prevAction: CoaAction,
  currAction: CoaAction,
  scene: LogisticsSceneContext
): LogisticsDependencyKind {
  const prevIntel = scene.actionById.get(prevAction.id);
  const prevEnd = prevAction.startTime + prevAction.duration;
  const overlaps = currAction.startTime < prevEnd;

  if (overlaps) {
    const prevType = prevIntel?.actionType ?? prevAction.type;
    if (prevType === "observe" || prevType === "monitor") {
      return "uses-live-feed";
    }
    return "shares-evidence";
  }

  if (currAction.startTime >= prevEnd) {
    return "requires-completion";
  }

  return "shares-evidence";
}

function upsertTypedDependency(
  chip: LogisticsChip,
  chipId: string,
  kind: LogisticsDependencyKind
): void {
  const typed = chip.typedDependencies ?? [];
  const existing = typed.find((entry) => entry.chipId === chipId);
  if (existing) {
    existing.kind = kind;
    chip.typedDependencies = typed;
    return;
  }
  chip.typedDependencies = [...typed, { chipId, kind }];
}
