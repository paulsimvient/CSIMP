import { useCallback } from "react";
import styles from "../../App.module.css";

export type WorkflowStepId = "event" | "generate" | "select" | "matrix" | "execute";

export type WorkflowStep = {
  id: WorkflowStepId;
  number: string;
  label: string;
  shortLabel: string;
};

export const WORKFLOW_STEPS: WorkflowStep[] = [
  { id: "event", number: "1", label: "Event", shortLabel: "Event" },
  { id: "generate", number: "2", label: "Generate", shortLabel: "Generate" },
  { id: "select", number: "3", label: "Select", shortLabel: "Select" },
  { id: "matrix", number: "4", label: "Refine Matrix", shortLabel: "Matrix" },
  { id: "execute", number: "5", label: "Validate & Execute", shortLabel: "Execute" },
];

export type WorkflowStepperProps = {
  currentStep: WorkflowStepId;
  completedSteps: ReadonlySet<WorkflowStepId>;
  onStepSelect: (step: WorkflowStepId) => void;
};

export function deriveWorkflowStepState(input: {
  hasEventContext: boolean;
  coaRunning: boolean;
  candidateCount: number;
  selectedCoaId?: string;
  logisticsReady: boolean;
  canExecute: boolean;
  isExecuting: boolean;
}): { current: WorkflowStepId; completed: Set<WorkflowStepId> } {
  const completed = new Set<WorkflowStepId>();

  if (input.hasEventContext) completed.add("event");
  if (input.candidateCount > 0 || input.coaRunning) completed.add("generate");
  if (input.selectedCoaId) completed.add("select");
  if (input.selectedCoaId && (input.logisticsReady || input.candidateCount > 0)) {
    completed.add("matrix");
  }

  let current: WorkflowStepId = "event";
  if (input.isExecuting || input.canExecute) {
    current = "execute";
  } else if (input.selectedCoaId) {
    current = "matrix";
  } else if (input.candidateCount > 0) {
    current = "select";
  } else if (input.coaRunning || input.hasEventContext) {
    current = "generate";
  }

  return { current, completed };
}

export function WorkflowStepper({
  currentStep,
  completedSteps,
  onStepSelect,
}: WorkflowStepperProps) {
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, stepId: WorkflowStepId) => {
      const index = WORKFLOW_STEPS.findIndex((step) => step.id === stepId);
      if (index < 0) return;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        const next = WORKFLOW_STEPS[Math.min(index + 1, WORKFLOW_STEPS.length - 1)];
        if (next) onStepSelect(next.id);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        const prev = WORKFLOW_STEPS[Math.max(index - 1, 0)];
        if (prev) onStepSelect(prev.id);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onStepSelect(stepId);
      }
    },
    [onStepSelect]
  );

  return (
    <nav className={styles.workflowStepper} aria-label="Decision workflow">
      <ol className={styles.workflowStepperList}>
        {WORKFLOW_STEPS.map((step, index) => {
          const isCurrent = step.id === currentStep;
          const isComplete = completedSteps.has(step.id) && !isCurrent;
          return (
            <li key={step.id} className={styles.workflowStepperItem}>
              {index > 0 ? (
                <span className={styles.workflowStepperConnector} aria-hidden="true" />
              ) : null}
              <button
                type="button"
                className={
                  isCurrent
                    ? styles.workflowStepperButtonActive
                    : isComplete
                      ? styles.workflowStepperButtonComplete
                      : styles.workflowStepperButton
                }
                aria-current={isCurrent ? "step" : undefined}
                onClick={() => onStepSelect(step.id)}
                onKeyDown={(event) => handleKeyDown(event, step.id)}
              >
                <span className={styles.workflowStepperNumber}>{step.number}</span>
                <span className={styles.workflowStepperLabel}>{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
