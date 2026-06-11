import type { MessageTrafficItem } from "./types";
import { timelineEventHint } from "./EventTimeline";
import styles from "./InspectorPanel.module.css";

type Props = {
  event: MessageTrafficItem;
  factId?: string;
  onLocate?: () => void;
  onOpenWorkflow?: () => void;
  onAuthorTask?: () => void;
};

export function TimelineEventDetail({
  event,
  factId,
  onLocate,
  onOpenWorkflow,
  onAuthorTask,
}: Props) {
  const hint = timelineEventHint(event, factId);

  return (
    <div className={styles.sceneDetail}>
      <div className={styles.sceneDetailHeader}>
        <div>
          <strong>{event.kind.toUpperCase()} · {event.channel}</strong>
          <p className={styles.sceneDetailSubtitle}>{event.text}</p>
        </div>
      </div>

      <dl className={styles.sceneDetailGrid}>
        <div>
          <dt>Time</dt>
          <dd>{event.time}</dd>
        </div>
        <div>
          <dt>Severity</dt>
          <dd>{event.severity}</dd>
        </div>
        {event.offsetSec != null ? (
          <div>
            <dt>Mission offset</dt>
            <dd>H+{Math.floor(event.offsetSec / 60)}m</dd>
          </div>
        ) : null}
      </dl>

      <p className={styles.inspectorEventHint}>{hint}</p>

      <div className={styles.inspectorEventActions}>
        {factId && onLocate ? (
          <button type="button" className={styles.inspectorSecondaryBtn} onClick={onLocate}>
            Locate on map
          </button>
        ) : null}
        {event.kind === "validation" && onOpenWorkflow ? (
          <button type="button" className={styles.inspectorSecondaryBtn} onClick={onOpenWorkflow}>
            Open decision trace
          </button>
        ) : null}
        {event.kind === "ops" && onAuthorTask ? (
          <button type="button" className={styles.inspectorSecondaryBtn} onClick={onAuthorTask}>
            Author matrix task
          </button>
        ) : null}
      </div>
    </div>
  );
}
