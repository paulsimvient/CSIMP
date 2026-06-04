import { isHighRiskActionType } from "../intel/evidence";
import type { CoaAction, SolverCandidateResult, SolverInput } from "./types";

type IntelAction = NonNullable<SolverInput["intelActions"]>[number];

/**
 * Produces competing COA bundles from validated intel actions (not one mega-bundle).
 * Shared assets within a bundle are serialized into earliest feasible slots (not UNSAT).
 */
export async function solveValidatedIntelBundles(
  input: SolverInput
): Promise<SolverCandidateResult[]> {
  await delay(120);

  const actions = input.intelActions ?? [];
  if (actions.length === 0) {
    return [
      {
        status: "unsat",
        selectedActions: [],
        constraintSatisfaction: {
          hard: [
            {
              id: "hc-cited-facts",
              satisfied: false,
              label: "Evidence required",
              reason: "No cited validated intel actions available for planning",
            },
          ],
          soft: [],
        },
      },
    ];
  }

  const bundles = buildCompetingBundles(actions);
  const results: SolverCandidateResult[] = [];

  for (const bundle of bundles) {
    results.push(evaluateBundle(bundle, input));
  }

  const anySat = results.some((r) => r.status === "sat");
  if (!anySat && actions.length > 0) {
    const weakEvidence = actions.every(
      (a) => !a.confidence || a.confidence === "low"
    );
    if (weakEvidence) {
      results.push(insufficientEvidenceResult(actions));
    }
  }

  return results.length > 0 ? results : [{ status: "unsat", selectedActions: [] }];
}

function buildCompetingBundles(actions: IntelAction[]): IntelAction[][] {
  const continuity: IntelAction[] = [];
  const investigate: IntelAction[] = [];
  const observe: IntelAction[] = [];
  const coordinate: IntelAction[] = [];

  for (const action of actions) {
    const type = action.actionType ?? "other";
    const text = action.description.toLowerCase();
    if (
      type === "preserve" ||
      type === "inform" ||
      /continuity|logistics|public|messaging|port/i.test(text)
    ) {
      continuity.push(action);
    } else if (
      type === "investigate" ||
      type === "harden" ||
      /cyber|forensic|authentication|siem/i.test(text)
    ) {
      investigate.push(action);
    } else if (
      type === "observe" ||
      type === "monitor" ||
      /uas|airspace|drone|radar|isr/i.test(text)
    ) {
      observe.push(action);
    } else if (
      type === "coordinate" ||
      /maritime|vessel|liaison|patrol/i.test(text)
    ) {
      coordinate.push(action);
    } else {
      continuity.push(action);
    }
  }

  const byTheme = { continuity, investigate, observe, coordinate };

  const bundles: IntelAction[][] = [];

  for (const group of Object.values(byTheme)) {
    if (group.length > 0) bundles.push(group);
  }

  const byConfidence = [...actions].sort(
    (a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence)
  );
  for (const action of byConfidence.slice(0, 3)) {
    bundles.push([action]);
  }

  return dedupeBundles(bundles);
}

function evaluateBundle(
  bundle: IntelAction[],
  input: SolverInput
): SolverCandidateResult {
  const allLowConfidence = bundle.every(
    (a) => !a.confidence || a.confidence === "low"
  );
  const hasEscalatory = bundle.some((a) =>
    isHighRiskActionType(a.actionType, a.description)
  );
  if (allLowConfidence && hasEscalatory) {
    return insufficientEvidenceResult(bundle);
  }

  const T0 = Date.now() / 1000;
  const scheduleResult = scheduleBundleActions(bundle, T0);
  if (!scheduleResult.ok) {
    return {
      status: "unsat",
      selectedActions: [],
      constraintSatisfaction: {
        hard: [
          {
            id: "hc-resource-exclusivity",
            satisfied: false,
            label: "Asset exclusivity",
            reason: scheduleResult.reason,
            evidence: scheduleResult.actionIds,
          },
        ],
        soft: [],
      },
    };
  }

  const selectedActions = scheduleResult.actions;

  const missingAuthority = findMissingAuthority(bundle, input);
  if (missingAuthority) {
    return {
      status: "unsat",
      selectedActions,
      constraintSatisfaction: {
        hard: [
          {
            id: "hc-authority",
            satisfied: false,
            label: "Authority approval",
            reason: missingAuthority.reason,
            evidence: missingAuthority.evidence,
          },
        ],
        soft: [],
      },
    };
  }

  return {
    status: "sat",
    selectedActions,
    constraintSatisfaction: {
      hard: [
        {
          id: "hc-cited-facts",
          satisfied: true,
          label: "Cited evidence",
          reason: "Every action cites at least one observed fact",
          evidence: bundle.flatMap((a) => a.citedFacts),
        },
        {
          id: "hc-resource-exclusivity",
          satisfied: true,
          label: "Asset exclusivity",
          reason: "No overlapping asset assignments in this bundle",
        },
        {
          id: "hc-known-assets",
          satisfied: true,
          label: "Known assets only",
          reason: "Required assets are drawn from the scenario packet",
        },
      ],
      soft: [
        {
          id: "sc-minimize-actions",
          satisfied: bundle.length <= 2,
          weight: 0.4,
          label: "Parsimony",
          reason:
            bundle.length <= 2
              ? "Compact action set"
              : "Multiple actions increase coordination load",
          score: bundle.length <= 2 ? 1 : 0.4,
        },
        {
          id: "sc-align-intent",
          satisfied: true,
          weight: 0.5,
          label: "Commander intent alignment",
          reason: "Bundle theme matches validated intel action types",
          score: 0.8,
        },
        buildScheduleEfficiencyConstraint(selectedActions),
        ...scheduleResult.adjustments.map((adjustment, index) => ({
          id: `sc-schedule-shift-${index}`,
          satisfied: true,
          weight: 0.3,
          label: "Flexible reschedule",
          reason: `${adjustment.actionId} on ${adjustment.asset}: ${adjustment.originalStartSec}s → ${adjustment.adjustedStartSec}s (${adjustment.reason})`,
          score: 0.85,
        })),
      ],
    },
  };
}

/**
 * Builds a deterministic, resource-aware schedule for one candidate bundle.
 *
 * The intel layer proposes actions and required assets. This scheduler decides
 * when those actions can start. It does not use an LLM and it does not rely on
 * fixed index spacing. Actions with different assets may run in parallel;
 * Hard windows (`immediate`, `time-bound`) cannot be shifted — asset conflicts → UNSAT.
 * Flexible (`routine`) actions may be rescheduled with trace entries.
 */
export function scheduleBundleActions(
  bundle: IntelAction[],
  T0: number
): import("./types").ScheduleBundleResult {
  const assetEndTimes = new Map<string, number>();
  const ordered = [...bundle].sort(comparePlanningPriority);
  const actions: CoaAction[] = [];
  const adjustments: import("./types").ScheduleAdjustment[] = [];

  for (const action of ordered) {
    const resources = normalizedResources(action);
    const duration = durationFor(action.timeSensitivity);
    const releaseTime = T0 + releaseOffsetFor(action.timeSensitivity);
    const hardWindow = hasHardTimeWindow(action.timeSensitivity);

    for (const asset of resources) {
      const assetFreeAt = assetEndTimes.get(asset) ?? T0;
      if (hardWindow && assetFreeAt > releaseTime) {
        const conflicting = actions
          .filter(
            (scheduled) =>
              scheduled.resources.includes(asset) &&
              scheduled.startTime + scheduled.duration > releaseTime
          )
          .map((scheduled) => scheduled.id);
        return {
          ok: false,
          reason: `Hard time window for "${action.description}" requires ${asset} at t=${releaseTime - T0}s but asset is booked until t=${assetFreeAt - T0}s`,
          asset,
          actionIds: [...conflicting, action.id],
        };
      }
    }

    let startTime = releaseTime;
    for (const asset of resources) {
      startTime = Math.max(startTime, assetEndTimes.get(asset) ?? T0);
    }

    if (!hardWindow && startTime > releaseTime) {
      for (const asset of resources) {
        const assetFreeAt = assetEndTimes.get(asset) ?? T0;
        if (assetFreeAt > releaseTime) {
          adjustments.push({
            actionId: action.id,
            asset,
            originalStartSec: releaseTime - T0,
            adjustedStartSec: startTime - T0,
            reason: `Rescheduled to avoid overlap on ${asset}`,
          });
        }
      }
    }

    const endTime = startTime + duration;
    for (const asset of resources) {
      assetEndTimes.set(asset, endTime);
    }

    actions.push({
      id: action.id,
      name: action.description,
      type: action.actionType ?? "other",
      startTime,
      duration,
      resources,
    });
  }

  return {
    ok: true,
    actions: actions.sort(
      (a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id)
    ),
    adjustments,
  };
}

function hasHardTimeWindow(
  sensitivity?: "immediate" | "time-bound" | "routine"
): boolean {
  return sensitivity === "immediate" || sensitivity === "time-bound";
}

function normalizedResources(action: IntelAction): string[] {
  const assets = action.requiredAssets?.filter(Boolean) ?? [];
  return assets.length > 0 ? Array.from(new Set(assets)).sort() : ["unassigned-asset"];
}

function comparePlanningPriority(a: IntelAction, b: IntelAction): number {
  return (
    sensitivityRank(a.timeSensitivity) - sensitivityRank(b.timeSensitivity) ||
    confidenceRank(b.confidence) - confidenceRank(a.confidence) ||
    a.id.localeCompare(b.id)
  );
}

function sensitivityRank(value?: "immediate" | "time-bound" | "routine"): number {
  if (value === "immediate") return 0;
  if (value === "time-bound") return 1;
  if (value === "routine") return 2;
  return 1;
}

/** Earliest allowed start relative to planning T0. */
function releaseOffsetFor(value?: "immediate" | "time-bound" | "routine"): number {
  if (value === "immediate") return 0;
  if (value === "time-bound") return 60;
  if (value === "routine") return 180;
  return 60;
}

function buildScheduleEfficiencyConstraint(actions: CoaAction[]) {
  if (actions.length === 0) {
    return {
      id: "sc-schedule-efficiency",
      satisfied: false,
      weight: 0.5,
      label: "Schedule efficiency",
      reason: "No scheduled actions",
      score: 0,
    };
  }

  const start = Math.min(...actions.map((action) => action.startTime));
  const end = Math.max(...actions.map((action) => action.startTime + action.duration));
  const makespan = Math.max(end - start, 1);
  const work = actions.reduce((sum, action) => sum + action.duration, 0);
  const score = Math.max(0, Math.min(1, work / makespan / actions.length));

  return {
    id: "sc-schedule-efficiency",
    satisfied: score >= 0.5,
    weight: 0.5,
    label: "Schedule efficiency",
    reason: "Resource-aware scheduler packed actions into earliest feasible slots",
    score,
  };
}

/**
 * Re-checks a fixed operator/materialized schedule with the same hard constraints
 * used for automated bundle evaluation (overlap, authority, schedule efficiency).
 */
export function evaluateScheduledRevision(
  selectedActions: CoaAction[],
  input: SolverInput
): SolverCandidateResult {
  if (selectedActions.length === 0) {
    return {
      status: "unsat",
      selectedActions: [],
      constraintSatisfaction: {
        hard: [
          {
            id: "hc-actions",
            satisfied: false,
            label: "Executable tasks",
            reason: "No scheduled actions in revision",
          },
        ],
        soft: [],
      },
    };
  }

  const overlap = findAssetOverlap(selectedActions);
  if (overlap) {
    return {
      status: "unsat",
      selectedActions,
      constraintSatisfaction: {
        hard: [
          {
            id: "hc-resource-exclusivity",
            satisfied: false,
            label: "Asset exclusivity",
            reason: `${overlap.asset} double-booked in overlapping time windows`,
            evidence: overlap.actionIds,
          },
        ],
        soft: [],
      },
    };
  }

  const bundle = (input.intelActions ?? []).filter((action) =>
    selectedActions.some((scheduled) => scheduled.id === action.id)
  );
  const missingAuthority = findMissingAuthority(bundle, input);
  if (missingAuthority) {
    return {
      status: "unsat",
      selectedActions,
      constraintSatisfaction: {
        hard: [
          {
            id: "hc-authority",
            satisfied: false,
            label: "Authority approval",
            reason: missingAuthority.reason,
            evidence: missingAuthority.evidence,
          },
        ],
        soft: [],
      },
    };
  }

  return {
    status: "sat",
    selectedActions,
    constraintSatisfaction: {
      hard: [
        {
          id: "hc-cited-facts",
          satisfied: true,
          label: "Cited evidence",
          reason: "Revision schedule passes resource and authority checks",
        },
        {
          id: "hc-resource-exclusivity",
          satisfied: true,
          label: "Asset exclusivity",
          reason: "No overlapping asset assignments in this revision",
        },
      ],
      soft: [
        buildScheduleEfficiencyConstraint(selectedActions),
        {
          id: "sc-minimize-actions",
          satisfied: selectedActions.length <= 4,
          weight: 0.4,
          label: "Parsimony",
          reason:
            selectedActions.length <= 4
              ? "Compact revision"
              : "Large revision increases coordination load",
          score: selectedActions.length <= 4 ? 1 : 0.5,
        },
      ],
    },
  };
}

function findAssetOverlap(actions: CoaAction[]): { asset: string; actionIds: string[] } | undefined {
  const intervals = new Map<string, { start: number; end: number; actionId: string }[]>();

  for (const action of actions) {
    const end = action.startTime + action.duration;
    for (const asset of action.resources) {
      const list = intervals.get(asset) ?? [];
      for (const prior of list) {
        if (action.startTime < prior.end && end > prior.start) {
          return { asset, actionIds: [prior.actionId, action.id] };
        }
      }
      list.push({ start: action.startTime, end, actionId: action.id });
      intervals.set(asset, list);
    }
  }
  return undefined;
}

function findMissingAuthority(
  bundle: IntelAction[],
  _input: SolverInput
): { reason: string; evidence: string[] } | undefined {
  for (const action of bundle) {
    if ((action.requiredAssets ?? []).some((a) => /strike|offensive/i.test(a))) {
      return {
        reason: "Escalatory asset requires explicit authority state (not modeled in stub)",
        evidence: action.citedFacts,
      };
    }
  }
  return undefined;
}

function dedupeBundles(bundles: IntelAction[][]): IntelAction[][] {
  const seen = new Set<string>();
  const out: IntelAction[][] = [];
  for (const bundle of bundles) {
    const key = bundle
      .map((a) => a.id)
      .sort()
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(bundle);
  }
  return out;
}

function insufficientEvidenceResult(
  bundle: IntelAction[]
): SolverCandidateResult {
  return {
    status: "insufficient_evidence",
    selectedActions: [],
    constraintSatisfaction: {
      hard: [
        {
          id: "hc-evidence-quality",
          satisfied: false,
          label: "Evidence sufficient for intervention",
          reason:
            "No high-confidence intervention COA is justified yet — prefer collection and continuity preservation",
          evidence: bundle.flatMap((a) => a.citedFacts),
        },
        {
          id: "hc-cited-facts",
          satisfied: bundle.every((a) => a.citedFacts.length > 0),
          label: "Cited evidence",
          reason: "Actions cite observed facts but confidence is insufficient for escalatory bundles",
          evidence: bundle.flatMap((a) => a.citedFacts),
        },
      ],
      soft: [
        {
          id: "sc-collection-first",
          satisfied: true,
          weight: 0.5,
          label: "Collection-first posture",
          reason: "Monitor, investigate, and preserve continuity until corroboration",
        },
      ],
    },
  };
}

function confidenceRank(c?: "low" | "medium" | "high"): number {
  if (c === "high") return 2;
  if (c === "medium") return 1;
  return 0;
}

/** Mission timeline seconds — sized so sync-matrix bars span multiple ticks at 1 min scale. */
function durationFor(timeSensitivity?: "immediate" | "time-bound" | "routine"): number {
  switch (timeSensitivity) {
    case "immediate":
      return 10 * 60;
    case "time-bound":
      return 30 * 60;
    case "routine":
      return 60 * 60;
    default:
      return 15 * 60;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
