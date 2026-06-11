import styles from "../../App.module.css";
import type { ExecutionPlaybackStatus } from "./useExecutionPlayback";

type Props = {
  status: ExecutionPlaybackStatus | null;
  error?: string | null;
  compact?: boolean;
};

export function ExecutionFeedbackBanner({ status, error, compact = false }: Props) {
  if (error) {
    return (
      <div
        className={compact ? styles.executionBannerErrorCompact : styles.executionBannerError}
        role="alert"
      >
        <strong>Execute failed</strong>
        <span>{error}</span>
      </div>
    );
  }

  if (!status || status.phase === "idle") return null;

  if (status.phase === "playing" || status.phase === "paused") {
    const progress =
      status.taskTotal > 0
        ? `NOW · H+00 · ${status.taskActiveCount}/${status.taskTotal} tasks`
        : "Committing order set";
    const detail = status.currentTaskLabel ? ` · ${status.currentTaskLabel}` : "";
    const label = status.phase === "paused" ? "Paused" : "Executing";
    return (
      <div
        className={compact ? styles.executionBannerActiveCompact : styles.executionBannerActive}
        role="status"
        aria-live="polite"
      >
        {status.phase === "playing" ? (
          <span className={styles.executionBannerPulse} aria-hidden />
        ) : null}
        {compact ? (
          <span>
            <strong>{label}</strong> {progress}
            {detail}
            {status.phase === "paused" ? " · Space to resume" : ""}
          </span>
        ) : (
          <div>
            <strong>
              {label} — {status.coaLabel ?? "selected COA"}
            </strong>
            <span>
              {progress}
              {status.currentTaskLabel ? `: ${status.currentTaskLabel}` : ""}
              {status.phase === "paused" ? " · Space to resume" : ""}
            </span>
          </div>
        )}
      </div>
    );
  }

  const committedText = `${status.taskTotal} task${status.taskTotal === 1 ? "" : "s"} on order${
    status.revisionId ? ` · ${status.revisionId}` : ""
  }`;

  return (
    <div
      className={compact ? styles.executionBannerSuccessCompact : styles.executionBannerSuccess}
      role="status"
      aria-live="polite"
    >
      {compact ? (
        <span>
          <strong>Committed</strong> {committedText}
        </span>
      ) : (
        <>
          <strong>COA committed to execution</strong>
          <span>
            {status.taskTotal} task{status.taskTotal === 1 ? "" : "s"} on order
            {status.revisionId ? ` · revision ${status.revisionId}` : ""}. Watch the timeline and
            map for live task activation.
          </span>
        </>
      )}
    </div>
  );
}
