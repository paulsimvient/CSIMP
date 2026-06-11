import type { ManualSyncEntry } from "../coa/manualSync";
import type { SyncMatrixBar } from "../coa/syncMatrix";
import type { ValidatedOrderSetTask } from "../coa/types";
import type { ObservedFact } from "../intel/types";
import type { OverviewTrack } from "../components/ops/types";
import { resolveBarInteractionCoords } from "./executionInteractionMap";

function fuzzyLabelMatch(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function findTrackIdForActor(
  actor: string | undefined,
  tracks: OverviewTrack[],
  facts: ObservedFact[]
): string | undefined {
  if (!actor?.trim()) return undefined;
  for (const track of tracks) {
    if (fuzzyLabelMatch(actor, track.callsign) || fuzzyLabelMatch(actor, track.id)) {
      return track.id;
    }
  }
  for (const fact of facts) {
    if (fuzzyLabelMatch(actor, fact.entity) || fuzzyLabelMatch(actor, fact.id)) {
      return fact.id;
    }
  }
  return undefined;
}

function lerpCoord(
  from: [number, number],
  to: [number, number],
  t: number
): [number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    from[0] + (to[0] - from[0]) * clamped,
    from[1] + (to[1] - from[1]) * clamped,
  ];
}

function motionReachForVerb(verb: string): number {
  const lower = verb.toLowerCase();
  if (/advance|deploy|move|reinforce|resupply|casevac/.test(lower)) return 1;
  if (/strike|attack|assault|suppress/.test(lower)) return 0.72;
  if (/investigate|observe|monitor|screen|guard|coordinate/.test(lower)) return 0.48;
  if (/disrupt|secure|seize|establish|defend|protect/.test(lower)) return 0.35;
  return 0.55;
}

export function buildExecutionTrackPositions(input: {
  playbackTimeSec: number;
  tasks: ValidatedOrderSetTask[];
  bars: SyncMatrixBar[];
  facts: ObservedFact[];
  tracks: OverviewTrack[];
  manualEntries?: ManualSyncEntry[];
}): Map<string, { lng: number; lat: number }> {
  const positions = new Map<string, { lng: number; lat: number }>();
  const sorted = [...input.tasks].sort((a, b) => a.startSec - b.startSec);

  for (const task of sorted) {
    if (input.playbackTimeSec < task.startSec) continue;

    const bar = input.bars.find((item) => item.id === task.id);
    if (!bar) continue;

    const { actorCoord, targetCoord } = resolveBarInteractionCoords(
      bar,
      input.facts,
      input.tracks,
      input.manualEntries
    );
    if (!actorCoord || !targetCoord) continue;

    const actorTrackId = findTrackIdForActor(
      task.actor ?? bar.actor,
      input.tracks,
      input.facts
    );
    if (!actorTrackId) continue;

    const endSec = task.startSec + Math.max(task.durationSec, 1);
    const rawProgress =
      input.playbackTimeSec >= endSec
        ? 1
        : (input.playbackTimeSec - task.startSec) / Math.max(task.durationSec, 1);
    const verb = task.actionVerb ?? bar.actionVerb ?? bar.label;
    const reach = motionReachForVerb(verb);
    const coord = lerpCoord(actorCoord, targetCoord, rawProgress * reach);
    positions.set(actorTrackId, { lng: coord[0], lat: coord[1] });
  }

  return positions;
}
