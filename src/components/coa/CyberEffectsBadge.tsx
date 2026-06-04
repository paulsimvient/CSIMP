import type { CyberEffectsAnnotation } from "@coa/types";
import {
  cyberExecutionBadgeLabel,
  normalizeCyberExecutionMode,
} from "../../coa/cyberEmulation/executionMode";
import styles from "../../App.module.css";

type CyberEffectsBadgeProps = {
  cyberEffects: CyberEffectsAnnotation | undefined;
  compact?: boolean;
};

function executionBadge(mode: CyberEffectsAnnotation["executionMode"]): {
  className: string;
  label: string;
} {
  const normalized = normalizeCyberExecutionMode(mode);
  switch (normalized) {
    case "simulation":
      return { className: styles.cyberSimBadge ?? "", label: cyberExecutionBadgeLabel(normalized) };
    case "lab-executed":
      return { className: styles.cyberLabBadge ?? "", label: cyberExecutionBadgeLabel(normalized) };
    case "in-process-simulation":
      return {
        className: styles.cyberInProcessBadge ?? "",
        label: cyberExecutionBadgeLabel(normalized),
      };
    case "lab-unavailable":
      return {
        className: styles.cyberUnavailableBadge ?? "",
        label: cyberExecutionBadgeLabel(normalized),
      };
  }
}

export function CyberEffectsBadge({ cyberEffects, compact }: CyberEffectsBadgeProps) {
  if (!cyberEffects) return null;

  const { className: badgeClass, label } = executionBadge(cyberEffects.executionMode);
  const techniques = cyberEffects.techniquesEvaluated
    .map((t) => t.techniqueId)
    .slice(0, compact ? 2 : 4)
    .join(", ");

  return (
    <div className={styles.cyberEffectsBlock}>
      <span className={badgeClass} title={cyberEffects.explanation}>
        {label}
      </span>
      {!compact && (
        <span className={styles.cyberEffectsMeta}>
          {cyberEffects.provider} · residual risk{" "}
          {Math.round(cyberEffects.residualRisk * 100)}%
          {techniques ? ` · ${techniques}` : ""}
          {cyberEffects.atomicTestsExecuted && cyberEffects.atomicTestsExecuted.length > 0
            ? ` · ${cyberEffects.atomicTestsExecuted.length} atomic test(s)`
            : ""}
        </span>
      )}
      {!compact &&
        cyberEffects.atomicTestsExecuted?.map((test) => (
          <span key={test.testId} className={styles.cyberEffectsMeta}>
            {test.testId}: {test.detectionObserved ? "detected" : "not detected"} (
            {test.harness})
          </span>
        ))}
    </div>
  );
}
