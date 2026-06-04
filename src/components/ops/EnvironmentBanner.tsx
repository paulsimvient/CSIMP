import styles from "../../App.module.css";

export type EnvironmentBannerProps = {
  usingScenarioData: boolean;
  groundedFactCount: number;
  blockingIssueCount: number;
  reviewIssueCount: number;
  lastUpdated?: string;
};

export function EnvironmentBanner({
  usingScenarioData,
  groundedFactCount,
  blockingIssueCount,
  reviewIssueCount,
  lastUpdated,
}: EnvironmentBannerProps) {
  if (usingScenarioData) {
    return (
      <div
        className={`${styles.environmentBanner} ${styles.environmentBannerDemo}`}
        role="status"
        aria-label="Demo scenario mode"
      >
        <strong>Mode: Demo Scenario</strong>
        <span className={styles.environmentBannerSep} aria-hidden="true">
          ·
        </span>
        <span>Synthetic coordinates may be shown</span>
        <span className={styles.environmentBannerSep} aria-hidden="true">
          ·
        </span>
        <span>Scores are heuristic estimates</span>
        <span className={styles.environmentBannerSep} aria-hidden="true">
          ·
        </span>
        <span>Local browser storage only</span>
      </div>
    );
  }

  const issueParts: string[] = [];
  if (blockingIssueCount > 0) {
    issueParts.push(
      `${blockingIssueCount} blocking issue${blockingIssueCount === 1 ? "" : "s"}`
    );
  }
  if (reviewIssueCount > 0) {
    issueParts.push(`${reviewIssueCount} review issue${reviewIssueCount === 1 ? "" : "s"}`);
  }
  const issueSummary =
    issueParts.length > 0 ? issueParts.join(" · ") : "Grounding clear";

  return (
    <div
      className={`${styles.environmentBanner} ${styles.environmentBannerValidated}`}
      role="status"
      aria-label="Validated intelligence mode"
    >
      <strong>Mode: Validated Intel</strong>
      <span className={styles.environmentBannerSep} aria-hidden="true">
        ·
      </span>
      <span>
        {groundedFactCount} fact{groundedFactCount === 1 ? "" : "s"} grounded
      </span>
      <span className={styles.environmentBannerSep} aria-hidden="true">
        ·
      </span>
      <span>{issueSummary}</span>
      {lastUpdated && lastUpdated !== "--:--" ? (
        <>
          <span className={styles.environmentBannerSep} aria-hidden="true">
            ·
          </span>
          <span>Updated {lastUpdated}</span>
        </>
      ) : null}
    </div>
  );
}
