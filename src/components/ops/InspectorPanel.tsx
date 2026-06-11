import type { ObservedFact } from "../../intel/types";
import { MatrixInspectorDetail, type MatrixInspectorContext } from "./MatrixInspectorDetail";
import { SceneObjectDetail } from "./SceneObjectDetail";
import { TimelineEventDetail } from "./TimelineEventDetail";
import type { MessageTrafficItem, OverviewTrack } from "./types";
import styles from "./InspectorPanel.module.css";

type Props = {
  inspectorSource?: "matrix" | "scene" | "event";
  matrixContext?: MatrixInspectorContext;
  onSelectMatrixTask?: (barId: string) => void;
  inspectedFactId?: string;
  fact?: ObservedFact;
  track?: OverviewTrack;
  inspectedEvent?: MessageTrafficItem;
  inspectedEventFactId?: string;
  onLocateFact?: (factId: string) => void;
  onInspectEventWorkflow?: () => void;
  onInspectEventAuthorTask?: (event: MessageTrafficItem) => void;
};

export function InspectorPanel({
  inspectorSource = "scene",
  matrixContext,
  onSelectMatrixTask,
  inspectedFactId,
  fact,
  track,
  inspectedEvent,
  inspectedEventFactId,
  onLocateFact,
  onInspectEventWorkflow,
  onInspectEventAuthorTask,
}: Props) {
  const showMatrix = inspectorSource === "matrix" && matrixContext;
  const showEvent = inspectorSource === "event" && Boolean(inspectedEvent);

  return (
    <aside className={styles.inspector} aria-label="Inspector">
      <div className={styles.inspectorHeader}>
        <strong>Inspector</strong>
        <span className={styles.inspectorSubtitle}>
          {showMatrix
            ? "Matrix information"
            : showEvent
              ? "Timeline event detail"
              : "Scene object detail"}
        </span>
      </div>
      <div className={styles.inspectorBody}>
        {showMatrix ? (
          <MatrixInspectorDetail context={matrixContext} onSelectTask={onSelectMatrixTask} />
        ) : showEvent && inspectedEvent ? (
          <TimelineEventDetail
            event={inspectedEvent}
            factId={inspectedEventFactId}
            onLocate={
              inspectedEventFactId && onLocateFact
                ? () => onLocateFact(inspectedEventFactId)
                : undefined
            }
            onOpenWorkflow={onInspectEventWorkflow}
            onAuthorTask={
              onInspectEventAuthorTask
                ? () => onInspectEventAuthorTask(inspectedEvent)
                : undefined
            }
          />
        ) : (
          <SceneObjectDetail
            fact={fact}
            track={track}
            onLocate={
              inspectedFactId && onLocateFact
                ? () => onLocateFact(inspectedFactId)
                : undefined
            }
          />
        )}
      </div>
    </aside>
  );
}
