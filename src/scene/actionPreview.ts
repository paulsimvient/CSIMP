import { circleRing } from "./sensors";

export type ActionPreviewInput = {
  action?: string;
  actorCoord?: [number, number];
  targetCoord?: [number, number];
};

export type ActionPreviewResult = {
  geojson: GeoJSON.FeatureCollection;
  statusLabel: string;
};

function normalizeAction(action?: string): string {
  return (action ?? "").trim().toLowerCase();
}

function lineFeature(
  coordinates: [number, number][],
  properties: Record<string, string | number>
): GeoJSON.Feature {
  return {
    type: "Feature",
    properties,
    geometry: { type: "LineString", coordinates },
  };
}

function polygonFeature(
  coordinates: GeoJSON.Position[][],
  properties: Record<string, string | number>
): GeoJSON.Feature {
  return {
    type: "Feature",
    properties,
    geometry: { type: "Polygon", coordinates },
  };
}

function pointFeature(
  coord: [number, number],
  properties: Record<string, string | number>
): GeoJSON.Feature {
  return {
    type: "Feature",
    properties,
    geometry: { type: "Point", coordinates: coord },
  };
}

function midpoint(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function offsetCoord(from: [number, number], to: [number, number], km: number): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const scale = km / 111;
  return [to[0] - (dx / len) * scale, to[1] - (dy / len) * scale];
}

export function buildActionPreview(input: ActionPreviewInput): ActionPreviewResult | null {
  const action = normalizeAction(input.action);
  if (!action) return null;

  const { actorCoord, targetCoord } = input;
  const anchor = targetCoord ?? actorCoord;
  if (!anchor) return null;

  const features: GeoJSON.Feature[] = [];
  let statusLabel = "Action preview on map";

  const hasLink = Boolean(actorCoord && targetCoord);

  if (
    action.includes("advance") ||
    action.includes("deploy") ||
    action.includes("move") ||
    action.includes("reinforce")
  ) {
    if (hasLink) {
      features.push(
        lineFeature([actorCoord!, targetCoord!], { previewKind: "movement", dashed: 0 })
      );
      features.push(pointFeature(targetCoord!, { previewKind: "movement-head" }));
    }
    statusLabel = "✓ Movement arrow shown on map";
  } else if (action.includes("strike") || action.includes("assault") || action.includes("attack")) {
    if (hasLink) {
      features.push(lineFeature([actorCoord!, targetCoord!], { previewKind: "attack-line", dashed: 0 }));
    }
    if (targetCoord) {
      features.push(pointFeature(targetCoord, { previewKind: "attack-head" }));
    }
    statusLabel = "✓ Attack vector shown toward target";
  } else if (action.includes("secure") || action.includes("seize") || action.includes("establish")) {
    const ring = circleRing(anchor, action.includes("establish") ? 4.5 : 3.2);
    features.push(
      polygonFeature([ring], { previewKind: "secure-ring", dashed: 0 }),
      pointFeature(anchor, { previewKind: "secure-center" })
    );
    statusLabel = "✓ Secure perimeter shown on target";
  } else if (action.includes("defend") || action.includes("protect") || action.includes("maintain")) {
    const center = actorCoord ?? targetCoord!;
    const ring = circleRing(center, 2.8);
    features.push(polygonFeature([ring], { previewKind: "defend-ring", dashed: 1 }));
    statusLabel = "✓ Defensive arc shown around selected position";
  } else if (action.includes("screen") || action.includes("guard")) {
    if (hasLink) {
      const mid = midpoint(actorCoord!, targetCoord!);
      features.push(lineFeature([actorCoord!, targetCoord!], { previewKind: "screen-line", dashed: 1 }));
      features.push(polygonFeature([circleRing(mid, 2)], { previewKind: "screen-area", dashed: 1 }));
    }
    statusLabel = "✓ Screen line shown between unit and protected area";
  } else if (
    action.includes("observe") ||
    action.includes("monitor") ||
    action.includes("investigate")
  ) {
    if (hasLink) {
      features.push(
        lineFeature([actorCoord!, targetCoord!], { previewKind: "observe-line", dashed: 1 })
      );
    }
    if (targetCoord) {
      features.push(polygonFeature([circleRing(targetCoord, 2.2)], { previewKind: "observe-area", dashed: 1 }));
    } else if (actorCoord) {
      features.push(polygonFeature([circleRing(actorCoord, 2.2)], { previewKind: "observe-area", dashed: 1 }));
    }
    statusLabel = "✓ ISR coverage area shown on map";
  } else if (action.includes("suppress")) {
    if (hasLink) {
      features.push(lineFeature([actorCoord!, targetCoord!], { previewKind: "suppress-line", dashed: 0 }));
    }
    if (targetCoord) {
      features.push(polygonFeature([circleRing(targetCoord, 2.5)], { previewKind: "suppress-area", dashed: 0 }));
    }
    statusLabel = "✓ Suppression area shown on target";
  } else if (action.includes("disrupt") || action.includes("jam")) {
    if (hasLink) {
      features.push(lineFeature([actorCoord!, targetCoord!], { previewKind: "disrupt-line", dashed: 1 }));
    }
    features.push(polygonFeature([circleRing(anchor, 3)], { previewKind: "disrupt-area", dashed: 1 }));
    statusLabel = action.includes("jam")
      ? "✓ Jam / EW link and radius shown on map"
      : "✓ Disruption link and radius shown on map";
  } else if (action.includes("harden")) {
    if (hasLink) {
      features.push(lineFeature([actorCoord!, targetCoord!], { previewKind: "coord-line", dashed: 1 }));
    }
    if (targetCoord) {
      features.push(polygonFeature([circleRing(targetCoord, 1.8)], { previewKind: "secure-area", dashed: 0 }));
    }
    statusLabel = "✓ Harden / contain area shown on map";
  } else if (action.includes("inform")) {
    if (hasLink) {
      features.push(lineFeature([actorCoord!, targetCoord!], { previewKind: "coord-line", dashed: 1 }));
    }
    statusLabel = "✓ Information ops link shown on map";
  } else if (action.includes("resupply") || action.includes("casevac")) {
    if (hasLink) {
      features.push(lineFeature([actorCoord!, targetCoord!], { previewKind: "logistics-line", dashed: 1 }));
    }
    statusLabel = action.includes("casevac")
      ? "✓ CASEVAC route shown on map"
      : "✓ Logistics route shown on map";
  } else if (action.includes("coordinate")) {
    if (hasLink) {
      features.push(lineFeature([actorCoord!, offsetCoord(actorCoord!, targetCoord!, 0.5), targetCoord!], {
        previewKind: "coord-line",
        dashed: 1,
      }));
    }
    statusLabel = "✓ Coordination link shown on map";
  } else if (hasLink) {
    features.push(lineFeature([actorCoord!, targetCoord!], { previewKind: "generic-line", dashed: 1 }));
    statusLabel = "✓ Task link shown on map";
  } else {
    features.push(pointFeature(anchor, { previewKind: "generic-point" }));
    statusLabel = "✓ Selected object highlighted on map";
  }

  return {
    geojson: { type: "FeatureCollection", features },
    statusLabel,
  };
}
