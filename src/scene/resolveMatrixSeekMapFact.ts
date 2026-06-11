import { sectionIdForRowKey, type SyncGridRowKey } from "../coa/syncGridSchema";
import type { SyncMatrixBar } from "../coa/syncMatrix";
import type { ObservedFact } from "../intel/types";
import type { MatrixTimelineSeekTarget } from "../components/SyncMatrix";
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

function barInSeekTarget(bar: SyncMatrixBar, target: MatrixTimelineSeekTarget): boolean {
  if (target.rowKey) return bar.rowKey === target.rowKey;
  if (target.sectionId && bar.rowKey) {
    return sectionIdForRowKey(bar.rowKey as SyncGridRowKey) === target.sectionId;
  }
  return true;
}

function pickFactFromBars(
  bars: SyncMatrixBar[],
  facts: ObservedFact[],
  tracks: OverviewTrack[]
): string | undefined {
  for (const bar of bars) {
    if (bar.targetFactIds?.[0]) return bar.targetFactIds[0];
  }
  for (const bar of bars) {
    const { targetCoord } = resolveBarInteractionCoords(bar, facts, tracks);
    if (targetCoord && bar.targetFactIds?.[0]) return bar.targetFactIds[0];
    const actorId = findTrackIdForActor(bar.actor, tracks, facts);
    if (actorId) return actorId;
  }
  return undefined;
}

/** Pick a map object to frame when the operator seeks on the sync matrix. */
export function resolveMatrixSeekMapFactId(input: {
  timeSec: number;
  target: MatrixTimelineSeekTarget;
  bars: SyncMatrixBar[];
  facts: ObservedFact[];
  tracks: OverviewTrack[];
}): string | undefined {
  const scoped = input.bars.filter((bar) => barInSeekTarget(bar, input.target));
  if (scoped.length === 0) {
    return pickFactFromBars(input.bars, input.facts, input.tracks);
  }

  const activeAtTime = scoped.filter(
    (bar) =>
      input.timeSec >= bar.startSec &&
      input.timeSec < bar.startSec + Math.max(bar.durationSec, 1)
  );
  const fromActive = pickFactFromBars(activeAtTime, input.facts, input.tracks);
  if (fromActive) return fromActive;

  const nearest = [...scoped].sort(
    (left, right) =>
      Math.abs(input.timeSec - left.startSec) - Math.abs(input.timeSec - right.startSec)
  );
  return pickFactFromBars(nearest, input.facts, input.tracks);
}
