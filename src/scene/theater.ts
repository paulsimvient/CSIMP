import type { ObservedFact } from "../intel/types";

export const TAIWAN_CENTER: [number, number] = [121.0, 24.3];

export const TAIWAN_BOUNDS = {
  minLng: 117.5,
  maxLng: 124.0,
  minLat: 21.8,
  maxLat: 26.2,
} as const;

/** MapLibre maxBounds: [[west, south], [east, north]] */
export const TAIWAN_MAX_BOUNDS: [[number, number], [number, number]] = [
  [116.8, 21.2],
  [124.8, 26.8],
];

const STUB_THEATER_COORDS: Array<[number, number]> = [
  [121.6, 25.2],
  [121.75, 25.15],
  [121.56, 25.05],
  [121.2, 24.7],
  [121.18, 25.02],
  [119.9, 24.3],
  [120.2, 24.85],
  [122.1, 24.1],
  [121.23, 25.07],
  [120.98, 24.98],
];

export function isTaiwanTheaterCoord([lng, lat]: [number, number]): boolean {
  return (
    lat >= TAIWAN_BOUNDS.minLat &&
    lat <= TAIWAN_BOUNDS.maxLat &&
    lng >= TAIWAN_BOUNDS.minLng &&
    lng <= TAIWAN_BOUNDS.maxLng
  );
}

export function resolveTheaterCoord(fact: ObservedFact, index: number): [number, number] {
  const text = `${fact.location ?? ""} ${fact.entity}`.toLowerCase();
  if (text.includes("keelung")) return [121.75, 25.15];
  if (text.includes("taoyuan")) return [121.18, 25.02];
  if (text.includes("northern")) return [121.6, 25.2];
  if (text.includes("kaohsiung") || text.includes("southern")) return [120.3, 22.6];
  if (text.includes("eastern")) return [122.1, 24.1];
  if (text.includes("strait") || text.includes("shipping")) return [120.4, 24.3];
  if (text.includes("taiwan") || text.includes("taipei")) return [121.0, 24.95];

  const stub = STUB_THEATER_COORDS[index % STUB_THEATER_COORDS.length]!;
  const offsetLng = ((index % 5) - 2) * 0.08;
  const offsetLat = ((index % 3) - 1) * 0.06;
  return [stub[0] + offsetLng, stub[1] + offsetLat];
}

export type CoordinateType = "reported" | "derived" | "stub";

export function resolveCoordinateType(
  fact: ObservedFact,
  index: number
): CoordinateType {
  if (fact.coordinates && isTaiwanTheaterCoord([fact.coordinates.lng, fact.coordinates.lat])) {
    return "reported";
  }
  const text = `${fact.location ?? ""} ${fact.entity}`.toLowerCase();
  if (
    text.includes("keelung") ||
    text.includes("taoyuan") ||
    text.includes("northern") ||
    text.includes("kaohsiung") ||
    text.includes("southern") ||
    text.includes("eastern") ||
    text.includes("strait") ||
    text.includes("shipping") ||
    text.includes("taiwan") ||
    text.includes("taipei")
  ) {
    return "derived";
  }
  void index;
  return "stub";
}

export function normalizeFactCoordinates(
  fact: ObservedFact,
  index: number
): { lat: number; lng: number; coordinateType: CoordinateType } {
  if (fact.coordinates) {
    let { lat, lng } = fact.coordinates;
    if (lng >= 20 && lng <= 28 && lat >= 115 && lat <= 125) {
      const swappedLng = lat;
      const swappedLat = lng;
      lat = swappedLat;
      lng = swappedLng;
    }
    if (isTaiwanTheaterCoord([lng, lat])) {
      return { lat, lng, coordinateType: "reported" };
    }
  }
  const [lng, lat] = resolveTheaterCoord(fact, index);
  return { lat, lng, coordinateType: resolveCoordinateType(fact, index) };
}

export function factToLngLat(fact: ObservedFact, index: number): [number, number] {
  const { lat, lng } = normalizeFactCoordinates(fact, index);
  return [lng, lat];
}

export function formatCoordLabel([lng, lat]: [number, number]): string {
  const latStr = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"}`;
  const lngStr = `${Math.abs(lng).toFixed(4)}°${lng >= 0 ? "E" : "W"}`;
  return `${latStr}, ${lngStr}`;
}

export function clampLngLatToTheater([lng, lat]: [number, number]): [number, number] {
  if (isTaiwanTheaterCoord([lng, lat])) return [lng, lat];
  return TAIWAN_CENTER;
}

export function normalizeFactsForTheater(facts: ObservedFact[]): ObservedFact[] {
  return facts.map((fact, index) => {
    const { lat, lng, coordinateType } = normalizeFactCoordinates(fact, index);
    return {
      ...fact,
      coordinates: { lat, lng },
      coordinateType,
      location: fact.location ?? "Taiwan Strait theater",
    };
  });
}
