import { useEffect, useMemo, useRef, useState } from "react";
import { useScenePickOptional } from "../ops/ScenePickContext";
import { useTaskComposerOptional } from "../ops/TaskComposerContext";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import type { ObservedFact } from "../../intel/types";
import { classifyMapDisplayKind } from "../ops/sceneObjects";
import { contactKinematics } from "../../scene/kinematics";
import {
  buildTrackRingPolygonsGeoJson,
  circleRing,
  collectSensorFootprints,
  FIXED_SENSOR_SITES,
  isSensorEntityFact,
  isWithinSensorRange,
  nearestSensor,
  triangleRing,
  type SensorFootprint,
} from "../../scene/sensors";
import {
  clampLngLatToTheater,
  factToLngLat,
  formatCoordLabel,
  TAIWAN_BOUNDS,
  TAIWAN_CENTER,
  TAIWAN_MAX_BOUNDS,
} from "../../scene/theater";
import type { OverviewTrack } from "../ops/types";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./SituationalMap.module.css";
import { registerWargameIcons as registerWargameIconSet } from "./wargameIcons";
import { WARGAME_ICON_URLS, type WargameIconKey } from "./wargameIconUrls";

let wargameIconsRegistered = false;

async function registerWargameIcons(map: maplibregl.Map): Promise<void> {
  if (wargameIconsRegistered) return;
  await registerWargameIconSet(map, WARGAME_ICON_URLS);
  wargameIconsRegistered = true;
}

const PORT_A_CENTER = TAIWAN_CENTER;
const LIGHT_OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};
const DARK_OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    },
  },
  layers: [
    {
      id: "carto-dark",
      type: "raster",
      source: "carto",
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};
const protocol = new Protocol();
let pmtilesProtocolRegistered = false;

const MAP_STYLE_MODE =
  (import.meta.env.VITE_MAP_STYLE_MODE as string | undefined) ?? "osm-dark";
const PMTILES_BASE_URL =
  (import.meta.env.VITE_MAP_PMTILES_BASE_URL as string | undefined) ??
  "http://localhost:3000/satellite.pmtiles";
const PMTILES_DEM_URL =
  (import.meta.env.VITE_MAP_PMTILES_DEM_URL as string | undefined) ??
  "http://localhost:3000/dem.pmtiles";

function terrainPmtilesStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      "offline-tiles": {
        type: "raster",
        url: `pmtiles://${PMTILES_BASE_URL}`,
        tileSize: 256,
      },
      terrainSource: {
        type: "raster-dem",
        url: `pmtiles://${PMTILES_DEM_URL}`,
        tileSize: 256,
      },
      hillshadeSource: {
        type: "raster-dem",
        url: `pmtiles://${PMTILES_DEM_URL}`,
        tileSize: 256,
      },
    },
    layers: [
      {
        id: "offline-layer",
        type: "raster",
        source: "offline-tiles",
      },
      {
        id: "hills",
        type: "hillshade",
        source: "hillshadeSource",
        layout: { visibility: "visible" },
        paint: { "hillshade-shadow-color": "#333" },
      },
    ],
    terrain: {
      source: "terrainSource",
      exaggeration: 1.6,
    },
  };
}

export type MapLayerMode = "main" | "sensors" | "threats" | "zones";

type SituationalMapProps = {
  facts: ObservedFact[];
  tracks?: OverviewTrack[];
  selectedTrackId?: string;
  focusFactId?: string;
  focusNonce?: number;
  /** Facts highlighted from logistics matrix selection. */
  highlightedFactIds?: string[];
  actionPreview?: GeoJSON.FeatureCollection | null;
  onFactIconClick?: (factId: string) => void;
  onPinnedCoordUpdate?: (factId: string, coord: [number, number]) => void;
  layerMode?: MapLayerMode;
  /** During COA execution playback, keep sensor coverage visible alongside task links. */
  executionPlaybackActive?: boolean;
};

export function SituationalMap({
  facts,
  tracks,
  selectedTrackId,
  focusFactId,
  focusNonce,
  highlightedFactIds = [],
  actionPreview = null,
  onFactIconClick,
  onPinnedCoordUpdate,
  layerMode = "main",
  executionPlaybackActive = false,
}: SituationalMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const activePopupRef = useRef<maplibregl.Popup | null>(null);
  const onFactIconClickRef = useRef(onFactIconClick);
  const onPinnedCoordUpdateRef = useRef(onPinnedCoordUpdate);
  const trackInteractionsBoundRef = useRef(false);
  const hasAutoFramedRef = useRef(false);
  const lastHandledFocusNonceRef = useRef<number | undefined>(undefined);
  const scenePick = useScenePickOptional();
  const composer = useTaskComposerOptional();
  const mapPickActive = Boolean(scenePick?.activeFieldId) || Boolean(composer?.pickMode);

  onFactIconClickRef.current = onFactIconClick;
  onPinnedCoordUpdateRef.current = onPinnedCoordUpdate;
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [mapTracksReady, setMapTracksReady] = useState(false);
  const sensorFootprints = useMemo(() => collectSensorFootprints(facts), [facts]);
  const points = useMemo(
    () => buildFactPoints(facts, sensorFootprints),
    [facts, sensorFootprints]
  );
  const availableDomains = useMemo(
    () => Array.from(new Set(points.map((point) => point.domain))),
    [points]
  );
  const activeDomains = useMemo(() => {
    if (availableDomains.length === 0) return [];
    const next = selectedDomains.filter((domain) =>
      availableDomains.includes(domain)
    );
    return next.length > 0 ? next : availableDomains;
  }, [availableDomains, selectedDomains]);

  const domainFilteredPoints = useMemo(
    () =>
      points.filter(
        (point) =>
          activeDomains.length === 0 || activeDomains.includes(point.domain)
      ),
    [points, activeDomains]
  );

  const visiblePoints = useMemo(() => {
    let scoped = domainFilteredPoints;
    if (layerMode === "threats") {
      scoped = scoped.filter((point) => point.kind === "threat");
    } else if (layerMode === "sensors") {
      scoped = scoped.filter((point) => point.kind === "sensor");
    }
    return scoped;
  }, [domainFilteredPoints, layerMode]);

  const factsKey = useMemo(
    () => facts.map((fact) => `${fact.id}:${fact.coordinates?.lat ?? ""}:${fact.coordinates?.lng ?? ""}`).join("|"),
    [facts]
  );

  useEffect(() => {
    hasAutoFramedRef.current = false;
  }, [factsKey]);
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    if (MAP_STYLE_MODE === "terrain-pmtiles" && !pmtilesProtocolRegistered) {
      maplibregl.addProtocol("pmtiles", protocol.tile);
      pmtilesProtocolRegistered = true;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style:
        MAP_STYLE_MODE === "terrain-pmtiles"
          ? terrainPmtilesStyle()
          : MAP_STYLE_MODE === "osm-light"
            ? LIGHT_OSM_STYLE
            : DARK_OSM_STYLE,
      center: PORT_A_CENTER,
      zoom: 9.5,
      maxBounds: TAIWAN_MAX_BOUNDS,
      minZoom: 6,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    mapRef.current = map;

    const onLoad = () => {
      void ensureOperationalLayers(map).then(() => setMapTracksReady(true));
    };
    if (map.isStyleLoaded()) onLoad();
    else map.once("load", onLoad);

    const resizeObserver = new ResizeObserver(() => {
      // MapLibre needs an explicit resize when its container changes size
      map.resize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      activePopupRef.current?.remove();
      activePopupRef.current = null;
      map.remove();
      mapRef.current = null;
      trackInteractionsBoundRef.current = false;
      wargameIconsRegistered = false;
      setMapTracksReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapTracksReady || !map?.getLayer("track-icons")) return;

    const TRACK_PICK_LAYERS = ["track-icons", "track-halo"];
    const PICK_HIT_PAD_PX = 12;

    const resolvePickFactId = (event: maplibregl.MapMouseEvent): string | undefined => {
      const layers = TRACK_PICK_LAYERS.filter((id) => Boolean(map.getLayer(id)));
      if (layers.length === 0) return undefined;

      const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [event.point.x - PICK_HIT_PAD_PX, event.point.y - PICK_HIT_PAD_PX],
        [event.point.x + PICK_HIT_PAD_PX, event.point.y + PICK_HIT_PAD_PX],
      ];
      const features = map.queryRenderedFeatures(bbox, { layers });
      const feature =
        features.find((item) => item.layer.id === "track-icons") ?? features[0];
      const raw = feature?.properties?.factId;
      return raw === undefined || raw === null ? undefined : String(raw);
    };

    const handleTrackPick = (event: maplibregl.MapMouseEvent) => {
      const factId = resolvePickFactId(event);
      if (!factId) return;
      onFactIconClickRef.current?.(factId);
    };

    const onMouseEnter = () => {
      map.getCanvas().style.cursor = mapPickActive ? "crosshair" : "pointer";
    };
    const onMouseLeave = () => {
      map.getCanvas().style.cursor = mapPickActive ? "crosshair" : "";
    };

    map.on("click", handleTrackPick);
    map.on("mouseenter", "track-icons", onMouseEnter);
    map.on("mouseenter", "track-halo", onMouseEnter);
    map.on("mouseleave", "track-icons", onMouseLeave);
    map.on("mouseleave", "track-halo", onMouseLeave);

    return () => {
      map.off("click", handleTrackPick);
      map.off("mouseenter", "track-icons", onMouseEnter);
      map.off("mouseenter", "track-halo", onMouseEnter);
      map.off("mouseleave", "track-icons", onMouseLeave);
      map.off("mouseleave", "track-halo", onMouseLeave);
    };
  }, [mapTracksReady, mapPickActive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapTracksReady || !map) return;
    if (mapPickActive) {
      map.getCanvas().style.cursor = "crosshair";
      map.dragPan.disable();
    } else {
      map.getCanvas().style.cursor = "";
      map.dragPan.enable();
    }
  }, [mapTracksReady, mapPickActive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapTracksReady || !map?.getSource("tracks-points")) return;

    const pointsSource = map.getSource("tracks-points") as maplibregl.GeoJSONSource;
    const ringsSource = map.getSource("tracks-rings") as maplibregl.GeoJSONSource;
    pointsSource.setData(
      buildTracksPointGeoJson(visiblePoints, selectedTrackId, highlightedFactIds)
    );
    ringsSource.setData(
      buildTrackRingPolygonsGeoJson(visiblePoints, {
        includeFixedSites: layerMode === "sensors",
      })
    );

    if (!hasAutoFramedRef.current) {
      const theaterBounds = new maplibregl.LngLatBounds(
        [TAIWAN_BOUNDS.minLng, TAIWAN_BOUNDS.minLat],
        [TAIWAN_BOUNDS.maxLng, TAIWAN_BOUNDS.maxLat]
      );
      map.fitBounds(theaterBounds, { padding: 40, maxZoom: 10, duration: 500 });
      hasAutoFramedRef.current = true;
    }

    syncPinnedTrackPopup(
      map,
      visiblePoints,
      selectedTrackId,
      activePopupRef,
      onPinnedCoordUpdateRef
    );
  }, [visiblePoints, selectedTrackId, highlightedFactIds, layerMode, mapTracksReady]);

  useEffect(() => {
    if (!focusFactId) return;
    if (focusNonce === undefined) return;
    if (lastHandledFocusNonceRef.current === focusNonce) return;

    const map = mapRef.current;
    const point = visiblePoints.find((p) => p.factId === focusFactId);
    if (!map || !point) return;
    lastHandledFocusNonceRef.current = focusNonce;

    map.easeTo({
      center: point.coord,
      zoom: map.getZoom(),
      duration: 550,
      essential: true,
    });
    syncPinnedTrackPopup(
      map,
      visiblePoints,
      focusFactId,
      activePopupRef,
      onPinnedCoordUpdateRef
    );
  }, [focusFactId, focusNonce, visiblePoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapTracksReady || !map?.getSource("action-preview")) return;
    const source = map.getSource("action-preview") as maplibregl.GeoJSONSource;
    source.setData(actionPreview ?? { type: "FeatureCollection", features: [] });
  }, [actionPreview, mapTracksReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("zone-blue-fill")) return;
    applyLayerVisibility(map, layerMode, executionPlaybackActive);
  }, [layerMode, executionPlaybackActive]);

  const toggleDomain = (domain: string) => {
    setSelectedDomains((prev) =>
      prev.includes(domain)
        ? prev.filter((value) => value !== domain)
        : [...prev, domain]
    );
  };

  const contactCount = tracks?.length ?? visiblePoints.length;
  const layerHint =
    layerMode === "sensors"
      ? "Light blue rings: notional radar/SIGINT coverage (~18 km) at fixed sites."
      : layerMode === "zones"
        ? "Large circles: mission surveillance / exclusion / patrol areas (not individual sensors)."
        : layerMode === "threats"
          ? "Showing threat-class contacts only."
          : "Blue = sensor. Red = threat (Target). Grey = unknown contact (Actor). Green = objective or friendly unit.";

  return (
    <div className={styles.wrapper}>
      <div ref={mapContainerRef} className={styles.map} />
      <div className={styles.mapChrome} />
      <div className={styles.mapOverlayLeft}>
        <div className={styles.overlayTitle}>Threat Situation</div>
        <div className={styles.overlayBody}>
          <span>Active contacts: {contactCount}</span>
          <span>
            Icons on map: {visiblePoints.length} · In coverage:{" "}
            {visiblePoints.filter((p) => p.inSensorRange || p.kind === "sensor").length} · Critical:{" "}
            {facts.filter((fact) => fact.severity === "critical").length} · High:{" "}
            {facts.filter((fact) => fact.severity === "high").length}
          </span>
          <span>
            Dominant domain:{" "}
            {availableDomains.length > 0 ? domainLabel(availableDomains[0] ?? "signals") : "Pending"}
          </span>
          <span className={styles.layerHint}>{layerHint}</span>
        </div>
      </div>
      <div className={styles.mapOverlayRight}>
        <div className={styles.overlayTitle}>AI Detection</div>
        <div className={styles.overlayBody}>
          {visiblePoints.slice(0, 3).map((point, index) => (
            <span key={`${point.title}-${index}`}>
              {point.kind.toUpperCase()} · {point.domain.toUpperCase()}
            </span>
          ))}
          {visiblePoints.length === 0 && <span>No contacts.</span>}
        </div>
      </div>
      {MAP_STYLE_MODE === "terrain-pmtiles" && (
        <div className={styles.modeHint}>Terrain mode: PMTiles (self-hosted)</div>
      )}
      {availableDomains.length > 0 && (
        <div className={styles.domainFilters}>
          {availableDomains.map((domain) => {
            const active = activeDomains.includes(domain);
            return (
              <button
                key={domain}
                type="button"
                className={active ? styles.domainToggleActive : styles.domainToggle}
                onClick={() => toggleDomain(domain)}
              >
                {domainLabel(domain)}
              </button>
            );
          })}
        </div>
      )}
      <div className={styles.legend}>
        <span>
          <i className={`${styles.legendDot} ${styles["marker-threat"]}`} /> Threat contact
        </span>
        <span>
          <i className={`${styles.legendDot} ${styles["marker-sensor"]}`} /> Sensor / SIGINT
        </span>
        <span>
          <i className={`${styles.legendDot} ${styles["marker-unknown"]}`} /> Unknown contact
          (Actor)
        </span>
        <span>
          <i className={`${styles.legendDot} ${styles["marker-friendly"]}`} /> Objective / unit
        </span>
        <span>
          <i className={`${styles.legendDot} ${styles.legendSensorWire}`} /> Sensor footprint
        </span>
        <span>
          <i className={`${styles.legendDot} ${styles.legendDetectRing}`} /> Detection ring
        </span>
        {layerMode === "sensors" && (
          <span>
            <i className={`${styles.legendDot} ${styles.legendSensorCoverage}`} /> Radar coverage
          </span>
        )}
        {layerMode === "zones" && (
          <>
            <span>
              <i className={`${styles.legendDot} ${styles.legendZoneBlue}`} /> Surveillance zone
            </span>
            <span>
              <i className={`${styles.legendDot} ${styles.legendZoneRed}`} /> Exclusion zone
            </span>
            <span>
              <i className={`${styles.legendDot} ${styles.legendZonePatrol}`} /> Patrol zone
            </span>
          </>
        )}
      </div>
    </div>
  );
}

type FactPoint = {
  coord: [number, number];
  title: string;
  subtitle: string;
  domain: string;
  kind: "threat" | "sensor" | "friendly" | "unknown";
  factId: string;
  inSensorRange: boolean;
  detected: boolean;
  detectingSensorName?: string;
  moving: boolean;
  headingDeg: number;
  speedKts: number;
  coordinateType?: "reported" | "derived" | "stub";
};

function buildFactPoints(
  facts: ObservedFact[],
  sensors: SensorFootprint[]
): FactPoint[] {
  return facts.map((fact, index) => {
    const coord = clampLngLatToTheater(factToLngLat(fact, index));
    const kinematics = contactKinematics(fact.id);
    const baseCoord = coord;

    const kind = classifyMapDisplayKind(fact);
    const inSensorRange = kind === "sensor" || isWithinSensorRange(baseCoord, sensors);
    const sensor = inSensorRange && kind !== "sensor" ? nearestSensor(baseCoord, sensors) : undefined;

    return {
      coord,
      title: `${fact.domain.toUpperCase()} · ${fact.event}`,
      subtitle: `${fact.time}${fact.location ? ` · ${fact.location}` : ""}`,
      domain: fact.domain,
      kind,
      factId: fact.id,
      inSensorRange,
      detected: kind === "threat" && Boolean(sensor),
      detectingSensorName: sensor?.name,
      moving: kinematics.moving,
      headingDeg: kinematics.headingDeg,
      speedKts: kinematics.speedKts,
      coordinateType: fact.coordinateType,
    };
  });
}

function domainLabel(domain: string): string {
  if (domain === "UAS") return "UAS";
  if (domain === "cyber") return "Cyber";
  if (domain === "maritime") return "Maritime";
  if (domain === "information") return "Information";
  if (domain === "signals") return "Signals";
  return domain;
}

function iconKeyForPoint(point: FactPoint): WargameIconKey {
  const title = point.title.toLowerCase();
  if (title.includes("submarine")) return "submarine";
  if (title.includes("missile")) return "missile_inbound";
  if (point.domain === "UAS") return "uav_drone";
  if (point.domain === "air") return point.kind === "threat" ? "strike_aircraft" : "fighter_jet";
  if (point.domain === "maritime") return point.kind === "threat" ? "missile_boat" : "surface_warship";
  if (point.domain === "signals") return point.kind === "sensor" ? "radar" : "passive_sensor";
  if (point.domain === "cyber") return "cyber_attack";
  if (point.domain === "space") return "satellite";
  if (point.domain === "logistics") return "logistics_depot";
  if (point.domain === "information") return "civilian_marker";
  if (point.domain === "ground") return "command_node";
  return "unknown_contact";
}

function buildTracksPointGeoJson(
  points: FactPoint[],
  selectedTrackId?: string,
  highlightedFactIds: string[] = []
): GeoJSON.FeatureCollection {
  const highlightSet = new Set(highlightedFactIds);
  return {
    type: "FeatureCollection",
    features: points.map((point) => ({
      type: "Feature",
      properties: {
        factId: point.factId,
        iconKey: iconKeyForPoint(point),
        kind: point.kind,
        selected: point.factId === selectedTrackId,
        logisticsLinked: highlightSet.has(point.factId) ? 1 : 0,
        dimmed: !point.inSensorRange && point.kind !== "sensor",
        headingDeg: point.headingDeg,
        moving: point.moving ? 1 : 0,
        title: point.title,
        subtitle: point.subtitle,
        speedKts: point.speedKts,
        detectingSensorName: point.detectingSensorName ?? "",
        detected: point.detected ? 1 : 0,
      },
      geometry: { type: "Point", coordinates: point.coord },
    })),
  };
}

function trackPopupHtml(point: FactPoint): string {
  const motionLine =
    point.moving && point.speedKts
      ? `<div class="${styles.popupSubtitle}">HDG ${point.headingDeg}° · ${Math.round(point.speedKts)} kts</div>`
      : "";
  const detectLine =
    point.kind === "threat" && point.detected
      ? `<div class="${styles.popupSubtitle}">Detected by ${escapeHtml(point.detectingSensorName ?? "sensor net")}</div>`
      : "";
  const coordLine = `<div class="${styles.popupCoord}">${escapeHtml(formatCoordLabel(point.coord))}</div>`;
  const syntheticBadge =
    point.coordinateType === "stub"
      ? `<div class="${styles.popupSubtitle}">SYNTHETIC POSITION</div>`
      : "";
  return `<div class="${styles.popupBody}">
    <div class="${styles.popupTitle}">${escapeHtml(point.title)}</div>
    <div class="${styles.popupSubtitle}">${escapeHtml(point.subtitle)}</div>
    ${syntheticBadge}
    ${coordLine}
    ${motionLine}
    ${detectLine}
  </div>`;
}

function syncPinnedTrackPopup(
  map: maplibregl.Map,
  points: FactPoint[],
  pinnedFactId: string | undefined,
  popupRef: React.MutableRefObject<maplibregl.Popup | null>,
  onCoordUpdate?: React.MutableRefObject<
    ((factId: string, coord: [number, number]) => void) | undefined
  >
): void {
  if (!pinnedFactId) {
    popupRef.current?.remove();
    popupRef.current = null;
    return;
  }

  const point = points.find((p) => p.factId === pinnedFactId);
  if (!point) {
    popupRef.current?.remove();
    popupRef.current = null;
    return;
  }

  onCoordUpdate?.current?.(point.factId, point.coord);

  const html = trackPopupHtml(point);
  const lngLat: [number, number] = [point.coord[0], point.coord[1]];

  if (!popupRef.current) {
    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      closeOnMove: false,
      anchor: "bottom",
      offset: [0, -16],
      className: "situational-popup-dark situational-popup-pinned",
      maxWidth: "300px",
    })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(map);
    return;
  }

  popupRef.current.setLngLat(lngLat).setHTML(html);
}

function factPointFromFeature(feature: GeoJSON.Feature): FactPoint | undefined {
  const props = feature.properties;
  if (!props || feature.geometry.type !== "Point") return undefined;
  return {
    coord: feature.geometry.coordinates as [number, number],
    factId: String(props.factId),
    title: String(props.title),
    subtitle: String(props.subtitle),
    domain: "",
    kind: props.kind as FactPoint["kind"],
    inSensorRange: !props.dimmed,
    detected: Number(props.detected) === 1,
    detectingSensorName: String(props.detectingSensorName || ""),
    moving: Number(props.moving) === 1,
    headingDeg: Number(props.headingDeg),
    speedKts: Number(props.speedKts),
  };
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function ensureOperationalLayers(map: maplibregl.Map) {
  if (map.getSource("operational-zones")) return;

  const zones: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { kind: "surveillance" },
        geometry: { type: "Polygon", coordinates: [circleRing(PORT_A_CENTER, 45)] },
      },
      {
        type: "Feature",
        properties: { kind: "exclusion" },
        geometry: { type: "Polygon", coordinates: [circleRing([120.65, 24.35], 35)] },
      },
      {
        type: "Feature",
        properties: { kind: "patrol" },
        geometry: { type: "Polygon", coordinates: [circleRing([121.2, 24.8], 28)] },
      },
    ],
  };

  const sensorCoverage: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: FIXED_SENSOR_SITES.map((site) => ({
      type: "Feature",
      properties: { name: site.name },
      geometry: { type: "Polygon", coordinates: [circleRing(site.coord, site.radiusKm)] },
    })),
  };

  const sensorSites: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: FIXED_SENSOR_SITES.map((site) => ({
      type: "Feature",
      properties: { name: site.name },
      geometry: { type: "Point", coordinates: site.coord },
    })),
  };

  map.addSource("operational-zones", { type: "geojson", data: zones });
  map.addSource("sensor-coverage", { type: "geojson", data: sensorCoverage });
  map.addSource("sensor-sites", { type: "geojson", data: sensorSites });
  map.addSource("tracks-points", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource("tracks-rings", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource("action-preview", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "action-preview-fill",
    type: "fill",
    source: "action-preview",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": [
        "match",
        ["get", "previewKind"],
        "secure-ring",
        "#22c55e",
        "defend-ring",
        "#60a5fa",
        "screen-area",
        "#a78bfa",
        "observe-area",
        "#38bdf8",
        "suppress-area",
        "#f97316",
        "disrupt-area",
        "#ef4444",
        "#38bdf8",
      ],
      "fill-opacity": [
        "case",
        ["==", ["get", "pendingTask"], 1],
        0.1,
        0.16,
      ],
    },
  });
  map.addLayer({
    id: "action-preview-line",
    type: "line",
    source: "action-preview",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: {
      "line-color": [
        "match",
        ["get", "previewKind"],
        "attack-line",
        "#ef4444",
        "movement",
        "#22c55e",
        "logistics-line",
        "#fbbf24",
        "disrupt-line",
        "#f87171",
        "execution-link",
        "#67e8f9",
        "#67e8f9",
      ],
      "line-width": 3,
      "line-opacity": [
        "case",
        ["==", ["get", "pendingTask"], 1],
        0.55,
        0.9,
      ],
      "line-dasharray": [
        "case",
        ["any", ["==", ["get", "dashed"], 1], ["==", ["get", "pendingTask"], 1]],
        ["literal", [2, 2]],
        ["literal", [1, 0]],
      ],
    },
  });
  map.addLayer({
    id: "action-preview-point",
    type: "circle",
    source: "action-preview",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 8,
      "circle-color": "#fbbf24",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });

  map.addLayer({
    id: "zone-blue-fill",
    type: "fill",
    source: "operational-zones",
    filter: ["==", ["get", "kind"], "surveillance"],
    paint: { "fill-color": "#38bdf8", "fill-opacity": 0.12 },
  });
  map.addLayer({
    id: "zone-blue-line",
    type: "line",
    source: "operational-zones",
    filter: ["==", ["get", "kind"], "surveillance"],
    paint: { "line-color": "#38bdf8", "line-opacity": 0.55, "line-width": 1.5 },
  });
  map.addLayer({
    id: "zone-red-fill",
    type: "fill",
    source: "operational-zones",
    filter: ["==", ["get", "kind"], "exclusion"],
    paint: { "fill-color": "#ef4444", "fill-opacity": 0.14 },
  });
  map.addLayer({
    id: "zone-red-line",
    type: "line",
    source: "operational-zones",
    filter: ["==", ["get", "kind"], "exclusion"],
    paint: {
      "line-color": "#ef4444",
      "line-opacity": 0.7,
      "line-width": 1.5,
      "line-dasharray": [2, 2],
    },
  });
  map.addLayer({
    id: "zone-patrol-fill",
    type: "fill",
    source: "operational-zones",
    filter: ["==", ["get", "kind"], "patrol"],
    paint: { "fill-color": "#22c55e", "fill-opacity": 0.1 },
  });
  map.addLayer({
    id: "zone-patrol-line",
    type: "line",
    source: "operational-zones",
    filter: ["==", ["get", "kind"], "patrol"],
    paint: { "line-color": "#22c55e", "line-opacity": 0.55, "line-width": 1.5 },
  });
  map.addLayer({
    id: "sensor-coverage-fill",
    type: "fill",
    source: "sensor-coverage",
    paint: { "fill-color": "#67b6ff", "fill-opacity": 0.18 },
  });
  map.addLayer({
    id: "sensor-coverage-line",
    type: "line",
    source: "sensor-coverage",
    paint: { "line-color": "#67b6ff", "line-opacity": 0.45, "line-width": 1 },
  });
  map.addLayer({
    id: "sensor-sites-circle",
    type: "circle",
    source: "sensor-sites",
    paint: {
      "circle-radius": 7,
      "circle-color": "#67b6ff",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "track-ring-sensor-line",
    type: "line",
    source: "tracks-rings",
    filter: ["in", ["get", "ringType"], ["literal", ["sensor", "sensor-site"]]],
    paint: {
      "line-color": "#67b6ff",
      "line-opacity": 0.9,
      "line-width": 1.5,
    },
  });
  map.addLayer({
    id: "track-ring-detection-line",
    type: "line",
    source: "tracks-rings",
    filter: ["==", ["get", "ringType"], "detection"],
    paint: {
      "line-color": "#93c5fd",
      "line-opacity": 0.75,
      "line-width": 1.25,
      "line-dasharray": [2, 2],
    },
  });
  map.addLayer({
    id: "track-halo",
    type: "circle",
    source: "tracks-points",
    paint: {
      "circle-radius": [
        "case",
        ["==", ["get", "logisticsLinked"], 1],
        20,
        ["boolean", ["get", "selected"], false],
        16,
        12,
      ],
      "circle-color": [
        "match",
        ["get", "kind"],
        "threat",
        "rgba(127, 29, 29, 0.85)",
        "sensor",
        "rgba(30, 58, 138, 0.85)",
        "unknown",
        "rgba(55, 65, 81, 0.9)",
        "rgba(20, 83, 45, 0.85)",
      ],
      "circle-stroke-color": [
        "case",
        ["==", ["get", "logisticsLinked"], 1],
        "#fbbf24",
        ["match",
          ["get", "kind"],
          "threat",
          "#f87171",
          "sensor",
          "#67b6ff",
          "unknown",
          "#9ca3af",
          "#5fd68b",
        ],
      ],
      "circle-stroke-width": [
        "case",
        ["==", ["get", "logisticsLinked"], 1],
        3.5,
        ["boolean", ["get", "selected"], false],
        3,
        2,
      ],
      "circle-opacity": [
        "case",
        ["==", ["get", "logisticsLinked"], 1],
        1,
        ["boolean", ["get", "dimmed"], false],
        0.4,
        0.92,
      ],
    },
  });

  await registerWargameIcons(map);

  map.addLayer({
    id: "track-icons",
    type: "symbol",
    source: "tracks-points",
    layout: {
      "icon-image": ["concat", "wg-", ["get", "iconKey"]],
      "icon-size": [
        "case",
        ["==", ["get", "logisticsLinked"], 1],
        0.66,
        ["boolean", ["get", "selected"], false],
        0.56,
        0.44,
      ],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-rotate": [
        "case",
        ["==", ["get", "moving"], 1],
        ["get", "headingDeg"],
        0,
      ],
      "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "map",
    },
  });

  applyLayerVisibility(map, "main", false);
}

function setLayerVisible(map: maplibregl.Map, layerId: string, visible: boolean) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

function applyLayerVisibility(
  map: maplibregl.Map,
  mode: MapLayerMode,
  executionPlaybackActive = false
) {
  const showZones = mode === "zones";
  const showSensors = mode === "sensors" || executionPlaybackActive;
  const showTrackRings = mode === "main" || showSensors;

  setLayerVisible(map, "zone-blue-fill", showZones);
  setLayerVisible(map, "zone-blue-line", showZones);
  setLayerVisible(map, "zone-red-fill", showZones);
  setLayerVisible(map, "zone-red-line", showZones);
  setLayerVisible(map, "zone-patrol-fill", showZones);
  setLayerVisible(map, "zone-patrol-line", showZones);
  setLayerVisible(map, "sensor-coverage-fill", showSensors);
  setLayerVisible(map, "sensor-coverage-line", showSensors);
  setLayerVisible(map, "sensor-sites-circle", showSensors);
  setLayerVisible(map, "track-ring-sensor-line", showTrackRings);
  setLayerVisible(map, "track-ring-detection-line", mode === "main" || executionPlaybackActive);
  setLayerVisible(map, "track-halo", true);
  setLayerVisible(map, "track-icons", true);
  setLayerVisible(map, "action-preview-fill", true);
  setLayerVisible(map, "action-preview-line", true);
  setLayerVisible(map, "action-preview-point", true);
}

