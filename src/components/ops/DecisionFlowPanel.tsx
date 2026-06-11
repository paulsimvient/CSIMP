import { useMemo, useState } from "react";
import {
  candidateBadgeLabel,
  canSelectCandidate,
  coaOrigin,
  hasOverlayChanges,
  isOperatorCandidate,
} from "@coa/store";
import type { CoaCandidate, MatrixOverlay, PreparedExecution } from "../../coa/types";
import type { MessageTrafficItem } from "./types";
import { DomainTerm } from "./DomainTerm";
import styles from "../../App.module.css";

import type { ExecutionPlaybackStatus as HookPlaybackStatus } from "./useExecutionPlayback";

export type ExecutionStatusMessage = {
  title: string;
  detail: string;
};

export interface DecisionFlowPanelProps {
  summaryText: string;
  summaryTime: string;
  phase: string;
  timelineItems: MessageTrafficItem[];
  focusFactId?: string;
  resolveEventTargetFactId: (event: MessageTrafficItem) => string | undefined;
  onTimelineEvent: (event: MessageTrafficItem, factId?: string) => void;
  candidates: CoaCandidate[];
  selectedCoaId: string | undefined;
  onSelectCoa: (id: string) => void;
  onRunCoaEvaluation: () => void;
  coaRunning: boolean;
  coaPipelineStatus: "idle" | "running" | "ready" | "error";
  generationBlockerDetail?: string;
  generationError?: string;
  matrixOverlay: MatrixOverlay;
  onForkOperatorModified: (parentId: string) => void;
  onMergeOperatorIntoParent: (variantId: string) => void;
  onRebaseOperatorCoa: (operatorId: string, parentId: string) => void;
  onRemoveCoa: (coaId: string) => void;
  canClickExecute: boolean;
  blockingExecute: string[];
  playbackStatus: HookPlaybackStatus;
  onExecuteCoa: () => void;
  onTogglePlayback?: () => void;
  preparedExecution: PreparedExecution | undefined;
}

function truncateText(text: string, max = 52): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function DecisionFlowPanel({
  summaryText,
  summaryTime,
  phase,
  timelineItems,
  focusFactId,
  resolveEventTargetFactId,
  onTimelineEvent,
  candidates,
  selectedCoaId,
  onSelectCoa,
  onRunCoaEvaluation,
  coaRunning,
  coaPipelineStatus,
  generationBlockerDetail,
  generationError,
  matrixOverlay,
  onForkOperatorModified,
  onMergeOperatorIntoParent,
  onRebaseOperatorCoa,
  onRemoveCoa,
  canClickExecute,
  blockingExecute,
  playbackStatus,
  onExecuteCoa,
  onTogglePlayback,
  preparedExecution,
}: DecisionFlowPanelProps) {
  const [mergeConfirmCoaId, setMergeConfirmCoaId] = useState<string | null>(null);
  const [coaDeleteConfirmId, setCoaDeleteConfirmId] = useState<string | null>(null);

  const selectedCoa = candidates.find((candidate) => candidate.id === selectedCoaId);
  const recentEvents = timelineItems.slice(0, 5);

  const staleOperatorCoas = useMemo(
    () =>
      candidates.filter(
        (c) =>
          isOperatorCandidate(c) &&
          (c.validationStatus === "stale" || c.status === "stale")
      ),
    [candidates]
  );

  const defaultAutomatedParent = useMemo(
    () => candidates.find((c) => coaOrigin(c) === "automated" && c.status === "sat"),
    [candidates]
  );

  const executionPlaybackLive =
    playbackStatus.phase === "playing" || playbackStatus.phase === "paused";
  const executionCommitted = playbackStatus.phase === "committed";

  const generationProgress = coaRunning
    ? 62
    : coaPipelineStatus === "error"
      ? 100
      : candidates.length > 0 || coaPipelineStatus === "ready"
        ? 100
        : 0;

  const generationStatusLabel = coaRunning
    ? "Generating COAs..."
    : coaPipelineStatus === "error"
      ? "Generation failed"
      : generationProgress === 100
        ? "COAs ready"
        : "Idle";

  return (
    <div className={styles.harpoonWorkflowStack}>
      <section className={styles.flowStepCard} data-workflow-step="event">
        <div className={styles.flowStepHeader}>
          <span className={styles.flowNumber}>01</span>
          <h2>Event</h2>
        </div>
        <div className={styles.eventSummaryGrid}>
          <div className={styles.eventPrimary}>
            <strong>{summaryText}</strong>
            <small>
              {summaryTime} · {phase}
            </small>
          </div>
          <div className={styles.eventFeed}>
            {recentEvents.length === 0 && (
              <p className={styles.flowMutedLine}>Run analysis to load events.</p>
            )}
            {recentEvents.map((event) => {
              const factId = resolveEventTargetFactId(event);
              return (
                <button
                  key={event.id}
                  type="button"
                  className={[
                    styles.eventFeedRow,
                    styles.eventFeedRowButton,
                    factId && focusFactId === factId ? styles.eventFeedRowHighlighted : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => onTimelineEvent(event, factId)}
                >
                  <span>{event.time.slice(-8)}</span>
                  <strong>{event.kind.toUpperCase()}</strong>
                  <p>{truncateText(event.text)}</p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className={styles.flowStepCard} data-workflow-step="generate">
        <div className={styles.flowStepHeader}>
          <span className={styles.flowNumber}>02</span>
          <h2>
            Generate <DomainTerm term="coa">COA</DomainTerm>
          </h2>
          <div className={styles.flowStepActions}>
            <button
              type="button"
              className={styles.flowPrimaryButton}
              onClick={onRunCoaEvaluation}
              disabled={coaRunning}
            >
              {coaRunning ? "Generating…" : "Generate"}
            </button>
          </div>
        </div>
        {(coaRunning ||
          generationBlockerDetail ||
          generationError ||
          coaPipelineStatus === "error" ||
          staleOperatorCoas.length > 0) && (
          <div className={styles.recommendationPanel}>
            {coaRunning && (
              <div className={styles.flowProgressWrap} aria-live="polite">
                <div className={styles.flowProgressMeta}>
                  <span>{generationStatusLabel}</span>
                  <span>{generationProgress}%</span>
                </div>
                <div className={styles.flowProgressTrack}>
                  <span
                    className={`${styles.flowProgressBar} ${styles.flowProgressBarActive}`}
                    style={{ width: `${generationProgress}%` }}
                  />
                </div>
              </div>
            )}
            {(generationBlockerDetail || generationError) && (
              <p className={styles.flowBlockedNote}>
                {generationBlockerDetail ?? generationError}
              </p>
            )}
            {staleOperatorCoas.length > 0 && (
              <div className={styles.flowStaleBanner}>
                <strong>Stale operator COA</strong>
                <span>Revalidate, rebase, or discard before execute.</span>
              </div>
            )}
          </div>
        )}
      </section>

      <section className={styles.flowStepCard} data-workflow-step="select">
        <div className={styles.flowStepHeader}>
          <span className={styles.flowNumber}>03</span>
          <h2>
            Select <DomainTerm term="coa">COA</DomainTerm>
          </h2>
          <div className={styles.flowStepActions}>
            {selectedCoa &&
              coaOrigin(selectedCoa) === "automated" &&
              !hasOverlayChanges(matrixOverlay) && (
                <button
                  type="button"
                  className={styles.flowSecondaryButton}
                  onClick={() => selectedCoaId && onForkOperatorModified(selectedCoaId)}
                  title="Create an operator-modified variant before editing tasks"
                >
                  Modify
                </button>
              )}
            {selectedCoa &&
              coaOrigin(selectedCoa) === "operator-modified" &&
              selectedCoa.validationStatus === "validated" &&
              selectedCoa.parentCoaId &&
              mergeConfirmCoaId !== selectedCoaId && (
                <button
                  type="button"
                  className={styles.flowSecondaryButton}
                  onClick={() => selectedCoaId && setMergeConfirmCoaId(selectedCoaId)}
                  title="Apply validated operator revision to the automated parent COA"
                >
                  Merge
                </button>
              )}
          </div>
        </div>
        {mergeConfirmCoaId && selectedCoa?.parentCoaId && (
          <div className={styles.flowMergeConfirm} role="status">
            <span>
              Merge into{" "}
              {candidates.find((c) => c.id === selectedCoa.parentCoaId)?.label ?? "parent"}?
            </span>
            <div className={styles.flowImportActions}>
              <button
                type="button"
                className={styles.flowPrimaryButton}
                onClick={() => {
                  const parentId = selectedCoa.parentCoaId;
                  if (!parentId) return;
                  onMergeOperatorIntoParent(mergeConfirmCoaId);
                  onSelectCoa(parentId);
                  setMergeConfirmCoaId(null);
                }}
              >
                Confirm
              </button>
              <button
                type="button"
                className={styles.flowSecondaryButton}
                onClick={() => setMergeConfirmCoaId(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {candidates.length === 0 ? (
          <div className={styles.flowEmpty}>Generate COAs to continue.</div>
        ) : (
          <div className={styles.flowCoaGrid}>
            {candidates.map((coa) => {
              const selectable = canSelectCandidate(coa);
              const actionCount = coa.selectedActions.length;
              const isSelected = selectedCoaId === coa.id;
              const deletePending = coaDeleteConfirmId === coa.id;
              const deleteImmediately = isOperatorCandidate(coa);
              return (
                <div
                  key={coa.id}
                  className={
                    isSelected ? `${styles.flowCoaCardWrap} ${styles.flowCoaCardWrapActive}` : styles.flowCoaCardWrap
                  }
                >
                  <button
                    type="button"
                    className={styles.flowCoaSelect}
                    onClick={() => selectable && !isSelected && onSelectCoa(coa.id)}
                    disabled={!selectable}
                  >
                    <div>
                      <strong>{coa.label}</strong>
                      <span
                        className={
                          coa.status === "sat" ? styles.flowBadgeReady : styles.flowBadgeBlocked
                        }
                      >
                        {candidateBadgeLabel(coa, isSelected)}
                      </span>
                    </div>
                    {coa.validationBlockers && coa.validationBlockers.length > 0 && (
                      <small className={styles.flowCoaBlocker}>{coa.validationBlockers[0]}</small>
                    )}
                    <small className={styles.flowCoaMeta}>
                      {actionCount} action{actionCount === 1 ? "" : "s"} · Score{" "}
                      {Math.round(coa.scores.overall * 100)}% · Risk{" "}
                      {Math.round(coa.scores.risk * 100)}%
                    </small>
                  </button>
                  {deletePending ? (
                    <div className={styles.flowCoaDeleteConfirm}>
                      <button
                        type="button"
                        className={styles.flowCoaDeleteConfirmYes}
                        onClick={() => {
                          onRemoveCoa(coa.id);
                          setCoaDeleteConfirmId(null);
                        }}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        className={styles.flowCoaDeleteConfirmNo}
                        onClick={() => setCoaDeleteConfirmId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.flowCoaDelete}
                      aria-label={`Delete ${coa.label}`}
                      title={deleteImmediately ? "Delete draft" : "Delete COA"}
                      onClick={() => {
                        if (deleteImmediately) {
                          onRemoveCoa(coa.id);
                          return;
                        }
                        setCoaDeleteConfirmId(coa.id);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section
        className={`${styles.flowStepCard} ${styles.executeCard} ${styles.executeCardAuthoritative}`}
        data-workflow-step="execute"
      >
        <div className={styles.flowStepHeader}>
          <span className={styles.flowNumber}>05</span>
          <h2>Execute</h2>
          <button
            type="button"
            className={styles.executeButton}
            disabled={
              executionPlaybackLive
                ? false
                : executionCommitted
                  ? !onTogglePlayback
                  : !canClickExecute
            }
            onClick={
              executionCommitted && onTogglePlayback
                ? onTogglePlayback
                : executionPlaybackLive && onTogglePlayback
                  ? onTogglePlayback
                  : onExecuteCoa
            }
          >
            {executionPlaybackLive
              ? playbackStatus.phase === "paused"
                ? "Resume"
                : "Pause"
              : executionCommitted
                ? "Replay"
                : "Execute"}
          </button>
        </div>
        {executionPlaybackLive ? (
          <div className={styles.executionStatus}>
            <strong>
              {playbackStatus.phase === "paused"
                ? "Paused"
                : playbackStatus.taskTotal
                  ? `Task ${playbackStatus.taskActiveCount ?? 0}/${playbackStatus.taskTotal}`
                  : "Executing"}
            </strong>
            {playbackStatus.currentTaskLabel && (
              <span>{truncateText(playbackStatus.currentTaskLabel, 64)}</span>
            )}
            <small className={styles.flowMutedLine}>Space toggles play/pause</small>
          </div>
        ) : executionCommitted ? (
          <div className={styles.executionStatus}>
            <strong>Committed</strong>
            <span>
              {playbackStatus.taskTotal} task{playbackStatus.taskTotal === 1 ? "" : "s"} ·{" "}
              {playbackStatus.revisionId ?? "order set active"}
            </span>
          </div>
        ) : (
          <div className={styles.executionHint}>
            {!selectedCoa
              ? "Select a COA first."
              : blockingExecute.length > 0
                ? blockingExecute[0]
                : preparedExecution
                  ? `Ready · ${preparedExecution.revisionId}`
                  : "Validate on matrix, then execute."}
            {selectedCoa && isOperatorCandidate(selectedCoa) && (
              <div className={styles.executionActions}>
                {selectedCoa.validationStatus === "stale" && defaultAutomatedParent && (
                  <button
                    type="button"
                    className={styles.flowSecondaryButton}
                    onClick={() =>
                      selectedCoaId &&
                      onRebaseOperatorCoa(selectedCoaId, defaultAutomatedParent.id)
                    }
                  >
                    Rebase
                  </button>
                )}
                {isOperatorCandidate(selectedCoa) && (
                  <button
                    type="button"
                    className={styles.flowSecondaryButton}
                    onClick={() => selectedCoaId && onRemoveCoa(selectedCoaId)}
                  >
                    Discard
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
