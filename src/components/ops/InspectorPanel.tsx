import type { ObservedFact } from "../../intel/types";
import { SceneObjectDetail } from "./SceneObjectDetail";
import type { OverviewTrack } from "./types";
import styles from "./InspectorPanel.module.css";

type Props = {
  inspectedFactId?: string;
  fact?: ObservedFact;
  track?: OverviewTrack;
  onLocateFact?: (factId: string) => void;
};

export function InspectorPanel({
  inspectedFactId,
  fact,
  track,
  onLocateFact,
}: Props) {
  return (
    <aside className={styles.inspector} aria-label="Inspector">
      <div className={styles.inspectorHeader}>
        <strong>Inspector</strong>
        <span className={styles.inspectorSubtitle}>Scene object detail</span>
      </div>
      <div className={styles.inspectorBody}>
        <SceneObjectDetail
          fact={fact}
          track={track}
          onLocate={
            inspectedFactId && onLocateFact
              ? () => onLocateFact(inspectedFactId)
              : undefined
          }
        />
      </div>
    </aside>
  );
}
