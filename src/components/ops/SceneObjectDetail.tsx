import type { ObservedFact } from "../../intel/types";
import type { OverviewTrack } from "./types";
import styles from "./InspectorPanel.module.css";

type Props = {
  fact?: ObservedFact;
  track?: OverviewTrack;
  onLocate?: () => void;
};

function provenanceLabel(fact: ObservedFact): string | undefined {
  if (fact.sourceType === "scenario-demo") return "Scenario data";
  if (fact.coordinateType === "stub") return "Synthetic position";
  if (fact.coordinateType === "derived") return "Derived coordinates";
  if (fact.coordinateType === "reported") return "Reported coordinates";
  return undefined;
}

export function SceneObjectDetail({ fact, track, onLocate }: Props) {
  if (!fact && !track) {
    return (
      <div className={styles.emptyState}>
        <strong>No selection</strong>
        <p>Click a contact or object on the map to inspect it here.</p>
      </div>
    );
  }

  const title = track?.callsign ?? fact?.entity ?? "Unknown object";
  const subtitle = fact?.event ?? track?.summary;

  return (
    <div className={styles.sceneDetail}>
      <div className={styles.sceneDetailHeader}>
        <div>
          <strong>{title}</strong>
          {subtitle ? <p className={styles.sceneDetailSubtitle}>{subtitle}</p> : null}
        </div>
        {onLocate && (fact?.coordinates || track?.coordinates) ? (
          <button type="button" className={styles.inspectorSecondaryBtn} onClick={onLocate}>
            Locate
          </button>
        ) : null}
      </div>

      {track ? (
        <dl className={styles.sceneDetailGrid}>
          <div>
            <dt>Classification</dt>
            <dd>{track.classification}</dd>
          </div>
          <div>
            <dt>Side</dt>
            <dd>{track.side}</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{Math.round(track.confidence * 100)}%</dd>
          </div>
          <div>
            <dt>Staleness</dt>
            <dd>
              {track.stalenessState} · {track.stalenessMinutes}m
            </dd>
          </div>
          <div>
            <dt>Detected by</dt>
            <dd>{track.detectedBy}</dd>
          </div>
          <div>
            <dt>Last update</dt>
            <dd>{track.lastUpdate}</dd>
          </div>
          {track.moving != null ? (
            <div>
              <dt>Motion</dt>
              <dd>
                {track.moving
                  ? `Moving${track.headingDeg != null ? ` · ${track.headingDeg}°` : ""}${
                      track.speedKts != null ? ` · ${track.speedKts} kts` : ""
                    }`
                  : "Stationary"}
              </dd>
            </div>
          ) : null}
          {track.uncertaintyMeters > 0 ? (
            <div>
              <dt>Uncertainty</dt>
              <dd>±{track.uncertaintyMeters} m</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {fact ? (
        <>
          <div className={styles.sceneDetailSection}>Observed fact</div>
          <dl className={styles.sceneDetailGrid}>
            <div>
              <dt>Domain</dt>
              <dd>{fact.domain}</dd>
            </div>
            <div>
              <dt>Entity</dt>
              <dd>{fact.entity}</dd>
            </div>
            <div className={styles.sceneDetailWide}>
              <dt>Event</dt>
              <dd>{fact.event}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{fact.time}</dd>
            </div>
            {fact.location ? (
              <div>
                <dt>Location</dt>
                <dd>{fact.location}</dd>
              </div>
            ) : null}
            <div>
              <dt>Source</dt>
              <dd>{fact.source}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{fact.confidence}</dd>
            </div>
            <div>
              <dt>Severity</dt>
              <dd>{fact.severity}</dd>
            </div>
            {fact.coordinates ? (
              <div className={styles.sceneDetailWide}>
                <dt>Coordinates</dt>
                <dd>
                  {fact.coordinates.lat.toFixed(4)}, {fact.coordinates.lng.toFixed(4)}
                </dd>
              </div>
            ) : null}
            {provenanceLabel(fact) ? (
              <div>
                <dt>Provenance</dt>
                <dd>{provenanceLabel(fact)}</dd>
              </div>
            ) : null}
            {fact.rawEvidenceRef ? (
              <div className={styles.sceneDetailWide}>
                <dt>Evidence ref</dt>
                <dd>{fact.rawEvidenceRef}</dd>
              </div>
            ) : null}
          </dl>
        </>
      ) : null}

      {track?.history?.length ? (
        <>
          <div className={styles.sceneDetailSection}>Track history</div>
          <ul className={styles.sceneHistoryList}>
            {track.history.map((item) => (
              <li key={`${item.time}-${item.label}`}>
                <span>{item.time}</span>
                <strong>{item.label}</strong>
                <small>{Math.round(item.confidence * 100)}%</small>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
