import type { SyncMatrixBar } from "../coa/syncMatrix";
import type { ValidatedOrderSetTask } from "../coa/types";

/** Convert committed order-set tasks into sync-matrix bars for map playback. */
export function orderSetTasksToSyncBars(tasks: ValidatedOrderSetTask[]): SyncMatrixBar[] {
  return tasks.map((task) => ({
    id: task.id,
    actionId: task.actionId,
    label: task.label,
    subLabel: task.rowKey ?? task.label,
    startSec: task.startSec,
    durationSec: Math.max(task.durationSec, 60),
    status: task.status as SyncMatrixBar["status"],
    dependencies: [...task.dependencies],
    dependencyLabels: [],
    resourceLabel: task.actor,
    reasons: [],
    fixes: [],
    origin: task.origin as SyncMatrixBar["origin"],
    actor: task.actor,
    target: task.target,
    actionVerb: task.actionVerb,
    targetFactIds: task.targetFactIds ? [...task.targetFactIds] : undefined,
    missingFields: [],
    rowKey: task.rowKey as SyncMatrixBar["rowKey"],
    isManual: task.isManual,
  }));
}

/** Wall-clock duration for a full mission playback pass (H+00 → horizon). */
export const DEFAULT_PLAYBACK_WALL_DURATION_MS = 180_000;

/**
 * Mission-time → wall-clock scale for execution playback.
 * Targets ~3 minutes for the full horizon, capped so we never skim faster than
 * ~1 mission minute per wall second and never slower than 1:1 mission time.
 */
export function msPerMissionSecondForPlayback(horizonSec: number): number {
  const safeHorizon = Math.max(60, horizonSec);
  const fromDuration = DEFAULT_PLAYBACK_WALL_DURATION_MS / safeHorizon;
  const maxSkimMs = 1000 / 60;
  const realtimeMs = 1000;
  return Math.min(realtimeMs, Math.max(maxSkimMs, fromDuration));
}
