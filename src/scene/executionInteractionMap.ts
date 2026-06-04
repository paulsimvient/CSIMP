import type { ManualSyncEntry } from "../coa/manualSync";
import type { SyncMatrixBar } from "../coa/syncMatrix";
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

export function buildExecutionInteractionMap(
  input: ExecutionMapInput
): GeoJSON.FeatureCollection | null {
  const manualEntries = input.manualEntries ?? [];
  const scopedBars = input.activeBarIds?.size
    ? input.bars.filter((bar) => input.activeBarIds!.has(bar.id))
    : input.bars;

  const features: GeoJSON.Feature[] = [];

  for (const bar of scopedBars) {
    const { actorCoord, targetCoord } = resolveBarInteractionCoords(
      bar,
      input.facts,
      input.tracks,
      manualEntries
    );
    const preview = buildActionPreview({
      action: bar.actionVerb ?? bar.label,
      actorCoord,
      targetCoord,
    });
    if (!preview) continue;
    for (const feature of preview.geojson.features) {
      features.push({
        ...feature,
        properties: {
          ...(feature.properties ?? {}),
          taskId: bar.id,
          taskLabel: bar.label,
          previewKind: feature.properties?.previewKind ?? "execution-link",
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
