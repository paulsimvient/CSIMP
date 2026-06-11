import type { ManualSyncEntry } from "../coa/manualSync";
import type { SyncMatrixBar } from "../coa/syncMatrix";
import type { SyncGridRowKey } from "../coa/syncGridSchema";
import type { ObservedFact } from "../intel/types";
import type { OverviewTrack } from "../components/ops/types";
import { buildActionPreview } from "./actionPreview";
import { factToLngLat } from "./theater";

export type ExecutionMapInput = {
  bars: SyncMatrixBar[];
  facts: ObservedFact[];
  tracks: OverviewTrack[];
  manualEntries?: ManualSyncEntry[];
  /** When set, only draw links for these task bar ids (execution playback). */
  activeBarIds?: Set<string>;
  /** Infer map anchors for incomplete tasks from row type and scene objects. */
  useFallbackAnchors?: boolean;
};

function fuzzyLabelMatch(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function coordFromFactId(
  factId: string,
  facts: ObservedFact[]
): [number, number] | undefined {
  const index = facts.findIndex((fact) => fact.id === factId);
  if (index < 0) return undefined;
  return factToLngLat(facts[index]!, index);
}

function coordFromTrack(track: OverviewTrack): [number, number] | undefined {
  if (!track.coordinates) return undefined;
  return [track.coordinates.lng, track.coordinates.lat];
}

function resolveLabelCoord(
  label: string | undefined,
  facts: ObservedFact[],
  tracks: OverviewTrack[]
): [number, number] | undefined {
  if (!label?.trim()) return undefined;
  for (const track of tracks) {
    if (fuzzyLabelMatch(label, track.callsign) || fuzzyLabelMatch(label, track.id)) {
      const coord = coordFromTrack(track);
      if (coord) return coord;
    }
  }
  for (let index = 0; index < facts.length; index++) {
    const fact = facts[index]!;
    if (
      fuzzyLabelMatch(label, fact.entity) ||
      fuzzyLabelMatch(label, fact.id) ||
      fuzzyLabelMatch(label, fact.event ?? "")
    ) {
      return factToLngLat(fact, index);
    }
  }
  return undefined;
}

export function resolveBarInteractionCoords(
  bar: SyncMatrixBar,
  facts: ObservedFact[],
  tracks: OverviewTrack[],
  manualEntries: ManualSyncEntry[] = []
): { actorCoord?: [number, number]; targetCoord?: [number, number] } {
  const entry = manualEntries.find((item) => item.id === bar.id);
  const targetFactId = bar.targetFactIds?.[0] ?? entry?.targetFactId;
  const targetCoord =
    (targetFactId ? coordFromFactId(targetFactId, facts) : undefined) ??
    resolveLabelCoord(bar.target ?? entry?.target, facts, tracks);

  const actorCoord = resolveLabelCoord(bar.actor ?? entry?.actor, facts, tracks);

  return { actorCoord, targetCoord };
}

function rowKeyDomainHints(rowKey?: SyncGridRowKey): string[] {
  if (!rowKey) return [];
  if (rowKey.startsWith("cyber::")) return ["cyber", "information"];
  if (rowKey.startsWith("information::")) return ["information", "logistics"];
  if (rowKey.startsWith("isr::")) return ["air", "maritime", "ground"];
  if (rowKey.startsWith("fires::")) return ["air", "maritime"];
  if (rowKey.startsWith("protection::")) return ["ground", "information"];
  if (rowKey.startsWith("maneuver::")) return ["ground", "maritime"];
  if (rowKey.startsWith("sustainment::")) return ["logistics", "information"];
  return [];
}

/** Best-effort map anchor when a draft task is missing actor/target assignments. */
export function resolveBarFallbackAnchor(
  bar: SyncMatrixBar,
  facts: ObservedFact[],
  tracks: OverviewTrack[]
): [number, number] | undefined {
  const hints = rowKeyDomainHints(bar.rowKey as SyncGridRowKey | undefined);
  for (const domain of hints) {
    const index = facts.findIndex((fact) => fact.domain.toLowerCase() === domain);
    if (index >= 0) return factToLngLat(facts[index]!, index);
  }
  for (const domain of hints) {
    const index = facts.findIndex((fact) => fact.domain.toLowerCase().includes(domain));
    if (index >= 0) return factToLngLat(facts[index]!, index);
  }
  const hostileIndex = facts.findIndex(
    (fact) => fact.severity === "high" || fact.severity === "critical"
  );
  if (hostileIndex >= 0) return factToLngLat(facts[hostileIndex]!, hostileIndex);
  const friendlyTrack = tracks.find((track) => track.side === "friendly" && track.coordinates);
  if (friendlyTrack?.coordinates) {
    return [friendlyTrack.coordinates.lng, friendlyTrack.coordinates.lat];
  }
  if (facts.length > 0) return factToLngLat(facts[0]!, 0);
  return undefined;
}

function applyFallbackCoords(
  bar: SyncMatrixBar,
  coords: { actorCoord?: [number, number]; targetCoord?: [number, number] },
  facts: ObservedFact[],
  tracks: OverviewTrack[]
): { actorCoord?: [number, number]; targetCoord?: [number, number]; pending: boolean } {
  const { actorCoord: initialActor, targetCoord: initialTarget } = coords;
  let actorCoord = initialActor;
  let targetCoord = initialTarget;
  const hasAssignment = Boolean(bar.actor?.trim() || bar.target?.trim() || bar.targetFactIds?.length);
  if (actorCoord && targetCoord) {
    return { actorCoord, targetCoord, pending: false };
  }
  const fallback = resolveBarFallbackAnchor(bar, facts, tracks);
  if (!fallback) {
    return { actorCoord, targetCoord, pending: !hasAssignment };
  }
  if (!actorCoord && !targetCoord) {
    return { actorCoord: undefined, targetCoord: fallback, pending: !hasAssignment };
  }
  if (!targetCoord) {
    targetCoord = fallback;
  }
  return { actorCoord, targetCoord, pending: !hasAssignment };
}

export function buildExecutionInteractionMap(
  input: ExecutionMapInput
): GeoJSON.FeatureCollection | null {
  const manualEntries = input.manualEntries ?? [];
  const scopedBars = input.activeBarIds?.size
    ? input.bars.filter((bar) => input.activeBarIds!.has(bar.id))
    : input.bars;

  const features: GeoJSON.Feature[] = [];

  for (const bar of scopedBars) {
    const resolved = resolveBarInteractionCoords(
      bar,
      input.facts,
      input.tracks,
      manualEntries
    );
    const { actorCoord, targetCoord, pending } = input.useFallbackAnchors
      ? applyFallbackCoords(bar, resolved, input.facts, input.tracks)
      : { ...resolved, pending: false };

    const preview = buildActionPreview({
      action: bar.actionVerb ?? bar.label,
      actorCoord,
      targetCoord,
    });
    if (!preview) continue;
    const taskFeatures = [...preview.geojson.features];
    const hasLine = taskFeatures.some((feature) => feature.geometry.type === "LineString");
    if (!hasLine && actorCoord && targetCoord) {
      taskFeatures.unshift({
        type: "Feature",
        properties: { previewKind: "execution-link", dashed: 1 },
        geometry: { type: "LineString", coordinates: [actorCoord, targetCoord] },
      });
    }
    for (const feature of taskFeatures) {
      features.push({
        ...feature,
        properties: {
          ...(feature.properties ?? {}),
          taskId: bar.id,
          taskLabel: bar.label,
          previewKind: feature.properties?.previewKind ?? "execution-link",
          ...(pending ? { pendingTask: 1 } : {}),
        },
      });
    }
  }

  return features.length > 0 ? { type: "FeatureCollection", features } : null;
}

export function mergeFeatureCollections(
  ...collections: Array<GeoJSON.FeatureCollection | null | undefined>
): GeoJSON.FeatureCollection | null {
  const features = collections.flatMap((collection) => collection?.features ?? []);
  return features.length > 0 ? { type: "FeatureCollection", features } : null;
}
