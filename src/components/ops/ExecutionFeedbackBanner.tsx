import styles from "../../App.module.css";
import type { ExecutionPlaybackStatus } from "./useExecutionPlayback";

type Props = {
  status: ExecutionPlaybackStatus | null;
  error?: string | null;
};

export function ExecutionFeedbackBanner({ status, error }: Props) {
  if (error) {
    return (
      <div className={styles.executionBannerError} role="alert">
        <strong>Execute failed</strong>
        <span>{error}</span>
      </div>
    );
  }

  if (!status || status.phase === "idle") return null;

  if (status.phase === "playing") {
    const progress =
      status.taskTotal > 0
        ? `Task ${status.taskActiveCount} of ${status.taskTotal}`
        : "Committing order set";
    return (
      <div className={styles.executionBannerActive} role="status" aria-live="polite">
        <span className={styles.executionBannerPulse} aria-hidden />
        <div>
          <strong>COA executing — {status.coaLabel ?? "selected COA"}</strong>
          <span>
            {progress}
            {status.currentTaskLabel ? `: ${status.currentTaskLabel}` : ""}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.executionBannerSuccess} role="status" aria-live="polite">
      <strong>COA committed to execution</strong>
      <span>
        {status.taskTotal} task{status.taskTotal === 1 ? "" : "s"} on order
        {status.revisionId ? ` · revision ${status.revisionId}` : ""}. Watch the timeline and map
        for live task activation.
      </span>
    </div>
  );
}
