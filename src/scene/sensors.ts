import type { ObservedFact } from "../intel/types";
import { factToLngLat, isTaiwanTheaterCoord } from "./theater";

export type SensorFootprint = {
  id: string;
  name: string;
  coord: [number, number];
  radiusKm: number;
  shape: "circle" | "triangle";
};

export const SENSOR_RANGE_KM = 22;
export const MOBILE_SENSOR_RANGE_KM = 12;
export const DETECTION_RING_KM = 8;

export const FIXED_SENSOR_SITES: SensorFootprint[] = [
  { id: "radar-north", name: "Northern Coastal Radar", coord: [121.18, 25.02], radiusKm: SENSOR_RANGE_KM, shape: "circle" },
  { id: "sigint-strait", name: "Strait SIGINT Node", coord: [120.4, 24.5], radiusKm: SENSOR_RANGE_KM, shape: "circle" },
  { id: "fusion-center", name: "Joint Fusion Cell", coord: [121.0, 24.95], radiusKm: SENSOR_RANGE_KM, shape: "circle" },
];

export function toCoord(
  coordinates: { lat: number; lng: number } | undefined,
  fallback: [number, number]
): [number, number] {
  if (!coordinates) return fallback;
  const coord: [number, number] = [coordinates.lng, coordinates.lat];
  return isTaiwanTheaterCoord(coord) ? coord : fallback;
}

export function haversineKm(a: [number, number], b: [number, number]): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLng = (lng2 - lng1) * r;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function isWithinSensorRange(
  coord: [number, number],
  sensors: SensorFootprint[]
): boolean {
  return sensors.some((sensor) => haversineKm(coord, sensor.coord) <= sensor.radiusKm);
}

export function nearestSensor(
  coord: [number, number],
  sensors: SensorFootprint[]
): SensorFootprint | undefined {
  let best: SensorFootprint | undefined;
  let bestDist = Infinity;
  for (const sensor of sensors) {
    const dist = haversineKm(coord, sensor.coord);
    if (dist <= sensor.radiusKm && dist < bestDist) {
      best = sensor;
      bestDist = dist;
    }
  }
  return best;
}

/** True when the fact describes a friendly sensor asset — not a track *reported by* radar. */
export function isSensorEntityFact(fact: ObservedFact): boolean {
  const blob = `${fact.entity} ${fact.event} ${fact.location ?? ""}`.toLowerCase();
  if (
    /drone|swarm|vessel|submarine|inbound|track set|contact|corridor|shipping|patrol aircraft/i.test(
      blob
    )
  ) {
    return false;
  }
  if (fact.domain === "UAS" || fact.domain === "maritime" || fact.domain === "air") {
    return false;
  }
  if (/radar\s+(site|node|delta)|sigint\s+node|fusion\s+(cell|center)|sensor\s+net/i.test(blob)) {
    return true;
  }
  if (fact.domain === "signals" && /fusion|sigint|radar/i.test(fact.entity)) {
    return true;
  }
  return /^(coastal radar|.*\bradar\b.*site|passive sensor)/i.test(fact.entity);
}

export function collectSensorFootprints(facts: ObservedFact[]): SensorFootprint[] {
  const mobile: SensorFootprint[] = [];
  facts.forEach((fact, index) => {
    if (!isSensorEntityFact(fact)) return;
    const coord = factToLngLat(fact, index);
    const overlapsFixed = FIXED_SENSOR_SITES.some(
      (site) => haversineKm(coord, site.coord) < 8
    );
    if (overlapsFixed) return;
    mobile.push({
      id: `mobile-${fact.id}`,
      name: fact.entity,
      coord,
      radiusKm: MOBILE_SENSOR_RANGE_KM,
      shape: /sigint|passive/i.test(fact.source) ? "triangle" : "circle",
    });
  });
  return [...FIXED_SENSOR_SITES, ...mobile];
}

/** Wire rings on map: fixed sites + mobile sensors (deduped). */
export function mapDisplayFootprints(facts: ObservedFact[]): SensorFootprint[] {
  const mobile: SensorFootprint[] = [];
  facts.forEach((fact, index) => {
    if (!isSensorEntityFact(fact)) return;
    const coord = factToLngLat(fact, index);
    if (FIXED_SENSOR_SITES.some((site) => haversineKm(coord, site.coord) < 10)) return;
    mobile.push({
      id: `mobile-${fact.id}`,
      name: fact.entity,
      coord,
      radiusKm: MOBILE_SENSOR_RANGE_KM,
      shape: /sigint|passive/i.test(fact.source) ? "triangle" : "circle",
    });
  });
  return [...FIXED_SENSOR_SITES, ...mobile];
}

export function filterFactsInSensorRange(
  facts: ObservedFact[],
  sensors: SensorFootprint[] = collectSensorFootprints(facts)
): ObservedFact[] {
  return facts.filter((fact, index) => {
    if (isSensorEntityFact(fact)) return true;
    const coord = factToLngLat(fact, index);
    return isWithinSensorRange(coord, sensors);
  });
}

/** Great-circle destination (km, bearing °) for accurate geo rings at any zoom. */
export function destinationLngLat(
  center: [number, number],
  distanceKm: number,
  bearingDeg: number
): [number, number] {
  const [lng, lat] = center;
  const earthRadiusKm = 6371;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const angularDist = distanceKm / earthRadiusKm;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDist) +
      Math.cos(lat1) * Math.sin(angularDist) * Math.cos(bearing)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDist) * Math.cos(lat1),
      Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

export function circleRing(
  center: [number, number],
  radiusKm: number,
  points = 64
): GeoJSON.Position[] {
  const ring: GeoJSON.Position[] = [];
  for (let i = 0; i <= points; i++) {
    const bearing = (i / points) * 360;
    ring.push(destinationLngLat(center, radiusKm, bearing));
  }
  return ring;
}

export type TrackRingPoint = {
  coord: [number, number];
  kind: "threat" | "sensor" | "friendly" | "unknown";
  detected: boolean;
  factId: string;
};

/** Geographic polygon rings — same projection as the map at every zoom level. */
export function buildTrackRingPolygonsGeoJson(
  points: TrackRingPoint[],
  options?: { includeFixedSites?: boolean }
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const point of points) {
    if (point.kind === "sensor") {
      features.push({
        type: "Feature",
        properties: { ringType: "sensor", factId: point.factId },
        geometry: {
          type: "Polygon",
          coordinates: [circleRing(point.coord, SENSOR_RANGE_KM)],
        },
      });
    } else if (point.detected) {
      features.push({
        type: "Feature",
        properties: { ringType: "detection", factId: point.factId },
        geometry: {
          type: "Polygon",
          coordinates: [circleRing(point.coord, DETECTION_RING_KM)],
        },
      });
    }
  }

  if (options?.includeFixedSites) {
    for (const site of FIXED_SENSOR_SITES) {
      features.push({
        type: "Feature",
        properties: { ringType: "sensor-site", factId: site.id },
        geometry: {
          type: "Polygon",
          coordinates: [circleRing(site.coord, site.radiusKm)],
        },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

export function triangleRing(
  center: [number, number],
  radiusKm: number,
  headingDeg = 0
): GeoJSON.Position[] {
  const points: GeoJSON.Position[] = [];
  for (let i = 0; i < 3; i++) {
    const bearing = headingDeg + (i * 360) / 3;
    points.push(destinationLngLat(center, radiusKm, bearing));
  }
  points.push(points[0]!);
  return points;
}
