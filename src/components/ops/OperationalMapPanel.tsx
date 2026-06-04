import { lazy, Suspense, useState } from "react";
import type { ObservedFact } from "../../intel/types";
import type { MessageTrafficItem, OverviewTrack } from "./types";
import styles from "../../App.module.css";

const SituationalMap = lazy(() =>
  import("@components/SituationalMap").then((module) => ({ default: module.SituationalMap }))
);

type MapLayerMode = "main" | "sensors" | "threats" | "zones";

type OperationalMapPanelProps = {
  mapFacts: ObservedFact[];
  tracks: OverviewTrack[];
  selectedTrack: OverviewTrack | undefined;
  focusFactId?: string;
  focusNonce?: number;
  highlightedFactIds?: string[];
  actionPreview?: GeoJSON.FeatureCollection | null;
  onFactIconClick: (factId: string) => void;
  onPinnedCoordUpdate?: (factId: string, coord: [number, number]) => void;
  usingScenarioData?: boolean;
  /** Map toolbar lives in MapLogisticsStack; hide duplicate title row */
  embeddedInStack?: boolean;
};

export function OperationalMapPanel({
  mapFacts,
  tracks,
  selectedTrack,
  focusFactId,
  focusNonce,
  highlightedFactIds,
  actionPreview,
  onFactIconClick,
  onPinnedCoordUpdate,
  usingScenarioData,
  embeddedInStack,
}: OperationalMapPanelProps) {
  const [layerMode, setLayerMode] = useState<MapLayerMode>("main");
  const layerSelect = (
    <select
      className={styles.layersSelect}
      value={layerMode}
      onChange={(e) => setLayerMode(e.target.value as MapLayerMode)}
    >
      <option value="main">Contacts</option>
      <option value="sensors">Sensor Coverage</option>
      <option value="zones">Mission Zones</option>
      <option value="threats">Threat Tracks</option>
    </select>
  );
  return (
    <section className={`${styles.dashboardCard} ${styles.mapCardStretch} ${styles.mapCardFill}`}>
      {embeddedInStack ? (
        <div className={styles.mapEmbeddedControls}>
          {usingScenarioData ? (
            <span
              className={styles.scenarioDataBadge}
              title="Bundled demo scenario — run intel pipeline for live facts"
            >
              SCENARIO DATA
            </span>
          ) : null}
          <div className={styles.mapPanelControls}>{layerSelect}</div>
        </div>
      ) : (
        <div className={styles.panelHeaderRow}>
          <h3 className={styles.dashboardTitle}>Operational Map</h3>
          {usingScenarioData && (
            <span
              className={styles.scenarioDataBadge}
              title="Bundled demo scenario — run intel pipeline for live facts"
            >
              SCENARIO DATA
            </span>
          )}
          <div className={styles.mapPanelControls}>{layerSelect}</div>
        </div>
      )}
      <div className={styles.mapPanel}>
        <div className={styles.mapLibreHost}>
          <Suspense fallback={<div className={styles.mapLoading}>Loading map…</div>}>
            <SituationalMap
              facts={mapFacts}
              tracks={tracks}
              selectedTrackId={selectedTrack?.id}
              focusFactId={focusFactId}
              focusNonce={focusNonce}
              highlightedFactIds={highlightedFactIds}
              actionPreview={actionPreview}
              onFactIconClick={onFactIconClick}
              onPinnedCoordUpdate={onPinnedCoordUpdate}
              layerMode={layerMode}
            />
          </Suspense>
        </div>
      </div>
    </section>
  );
}
