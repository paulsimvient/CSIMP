import { useMemo, useState } from "react";
import {
  candidateBadgeLabel,
  canSelectCandidate,
  coaOrigin,
  hasOverlayChanges,
  isOperatorCandidate,
  overlayDiffSummary,
  EMPTY_MATRIX_OVERLAY,
} from "@coa/store";
import type { CoaCandidate, MatrixOverlay, PreparedExecution } from "../../coa/types";
import type { ManualSyncEntry } from "../../coa/manualSync";
import { createImportedManualEntriesFromText } from "../../coa/manualSync";
import { formatHeuristicRisk, formatHeuristicScore } from "../../coa/scoreLabels";
import type { MessageTrafficItem } from "./types";
import { DomainTerm } from "./DomainTerm";
import styles from "../../App.module.css";

export type ExecutionPlaybackStatus = {
  phase: string;
  taskActiveCount?: number;
  taskTotal?: number;
  currentTaskLabel?: string;
};

export type ExecutionStatusMessage = {
  title: string;
  detail: string;
};

export interface DecisionFlowPanelProps {
  summaryText: string;
  summaryTime: string;
  phase: string;
  reportWindowItems: MessageTrafficItem[];
  focusFactId?: string;
  resolveEventTargetFactId: (event: MessageTrafficItem) => string | undefined;
  onTimelineEvent: (event: MessageTrafficItem, factId?: string) => void;
  candidates: CoaCandidate[];
  selectedCoaId: string | undefined;
  onSelectCoa: (id: string) => void;
  onRunCoaEvaluation: () => void;
  onCreateOperatorCoa?: () => void;
  coaRunning: boolean;
  coaPipelineStatus: "idle" | "running" | "ready" | "error";
  generationBlockerDetail?: string;
  generationError?: string;
  recommendation: string;
  matrixOverlay: MatrixOverlay;
  onForkOperatorModified: (parentId: string) => void;
  onValidateOperator: () => void | Promise<void>;
  operatorValidationFeedback?: { kind: "success" | "error"; messages: string[] };
  onMergeOperatorIntoParent: (variantId: string) => void;
  onRebaseOperatorCoa: (operatorId: string, parentId: string) => void;
  onDiscardOperatorCoa: (operatorId: string) => void;
  onCreateImportedOperatorDraft: (entries: ManualSyncEntry[]) => string | undefined;
  canClickExecute: boolean;
  blockingExecute: string[];
  executionMessage: ExecutionStatusMessage | null;
  isPlaying: boolean;
  playbackStatus: ExecutionPlaybackStatus;
  onExecuteCoa: () => void;
  preparedExecution: PreparedExecution | undefined;
}

function timelineEventHint(
  item: MessageTrafficItem,
  factId: string | undefined
): string {
  if (factId) return "Focus contact on map and seed matrix task author";
  if (item.kind === "validation") return "Open decision trace for grounding issues";
  if (item.kind === "ops") return "Open matrix task author with this action as instruction";
  return "No linked map object for this event";
}

export function DecisionFlowPanel({
  summaryText,
  summaryTime,
  phase,
  reportWindowItems,
  focusFactId,
  resolveEventTargetFactId,
  onTimelineEvent,
  candidates,
  selectedCoaId,
  onSelectCoa,
  onRunCoaEvaluation,
  onCreateOperatorCoa,
  coaRunning,
  coaPipelineStatus,
  generationBlockerDetail,
  generationError,
  recommendation,
  matrixOverlay,
  onForkOperatorModified,
  onValidateOperator,
  operatorValidationFeedback,
  onMergeOperatorIntoParent,
  onRebaseOperatorCoa,
  onDiscardOperatorCoa,
  onCreateImportedOperatorDraft,
  canClickExecute,
  blockingExecute,
  executionMessage,
  isPlaying,
  playbackStatus,
  onExecuteCoa,
  preparedExecution,
}: DecisionFlowPanelProps) {
  const [importPanelOpen, setImportPanelOpen] = useState(false);
  const [importDraftText, setImportDraftText] = useState("");
  const [mergeConfirmCoaId, setMergeConfirmCoaId] = useState<string | null>(null);

  const selectedCoa = candidates.find((candidate) => candidate.id === selectedCoaId);
  const recentEvents = reportWindowItems.slice(0, 4);

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

  const overlayDiff = useMemo(
    () => overlayDiffSummary(matrixOverlay, selectedCoa),
    [matrixOverlay, selectedCoa]
  );

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
          <div>
            <h2>Event</h2>
            <p>Start with the operational change that needs a decision.</p>
          </div>
        </div>
        <div className={styles.eventSummaryGrid}>
          <div className={styles.eventPrimary}>
            <span>Current event</span>
            <strong>{summaryText}</strong>
            <small>
              {summaryTime} · {phase}
            </small>
          </div>
          <div className={styles.eventFeed}>
            {recentEvents.length === 0 && (
              <p>No event feed yet. Run analysis to load the scenario.</p>
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
                  title={timelineEventHint(event, factId)}
                >
                  <span>{event.time}</span>
                  <strong>{event.kind.toUpperCase()}</strong>
                  <p>{event.text}</p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className={styles.flowStepCard} data-workflow-step="generate">
        <div className={styles.flowStepHeader}>
          <span className={styles.flowNumber}>02</span>
          <div>
            <h2>
              Auto-Generate <DomainTerm term="coa">Course of Action (COA)</DomainTerm>
            </h2>
            <p>
              Generate system-proposed COAs from the event. You choose the option; you do not build
              the action sequence manually.
            </p>
          </div>
          <div className={styles.flowStepActions}>
            <button
              type="button"
              className={styles.flowPrimaryButton}
              onClick={onRunCoaEvaluation}
              disabled={coaRunning}
            >
              {coaRunning
                ? "Generating COAs…"
                : candidates.length > 0
                  ? "Regenerate COAs"
                  : "Generate COAs"}
            </button>
            {onCreateOperatorCoa && (
              <button
                type="button"
                className={styles.flowSecondaryButton}
                onClick={onCreateOperatorCoa}
                disabled={coaRunning}
              >
                Create Your Own COA
              </button>
            )}
            <button
              type="button"
              className={styles.flowSecondaryButton}
              onClick={() => setImportPanelOpen((open) => !open)}
              disabled={coaRunning}
            >
              {importPanelOpen ? "Close import" : "Import COA draft"}
            </button>
          </div>
        </div>
        {importPanelOpen && (
          <div className={styles.flowImportPanel}>
            <strong>Import task lines</strong>
            <p>
              One instruction per line (actor, verb, target, timing). Creates an imported COA draft
              on the <DomainTerm term="syncMatrix">synchronization matrix</DomainTerm>. Timing uses{" "}
              <DomainTerm term="hPlus">H+</DomainTerm> offsets from execution start.
            </p>
            <textarea
              className={styles.flowImportTextarea}
              rows={4}
              value={importDraftText}
              onChange={(event) => setImportDraftText(event.target.value)}
              placeholder={"Fighter 1 observe inbound track at H+0:15\nLogistics resupply port facility at H+1:00"}
              aria-label="Import task lines using H+ mission timing"
            />
            <div className={styles.flowImportActions}>
              <button
                type="button"
                className={styles.flowPrimaryButton}
                disabled={!importDraftText.trim() || coaRunning}
                onClick={() => {
                  const entries = createImportedManualEntriesFromText(importDraftText);
                  const draftId = onCreateImportedOperatorDraft(entries);
                  if (draftId) onSelectCoa(draftId);
                  setImportDraftText("");
                  setImportPanelOpen(false);
                }}
              >
                Create imported draft
              </button>
              <button
                type="button"
                className={styles.flowSecondaryButton}
                onClick={() => {
                  setImportDraftText("");
                  setImportPanelOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        <div className={styles.recommendationPanel}>
          <span>System assessment</span>
          <strong>{selectedCoa?.effects?.explanation ?? recommendation}</strong>
          <div className={styles.flowProgressWrap} aria-live="polite">
            <div className={styles.flowProgressMeta}>
              <span>{generationStatusLabel}</span>
              <span>{generationProgress}%</span>
            </div>
            <div className={styles.flowProgressTrack}>
              <span
                className={`${styles.flowProgressBar} ${coaRunning ? styles.flowProgressBarActive : ""}`}
                style={{ width: `${generationProgress}%` }}
              />
            </div>
          </div>
          {(generationBlockerDetail || generationError) && (
            <p className={styles.flowBlockedNote}>
              {generationBlockerDetail ?? generationError}
            </p>
          )}
          {staleOperatorCoas.length > 0 && (
            <div className={styles.flowStaleBanner}>
              <strong>Review required</strong>
              <span>
                New intel or regenerated automated COAs are available. Operator COA
                {staleOperatorCoas.length === 1 ? "" : "s"} may be stale — revalidate,{" "}
                <DomainTerm term="rebase">rebase</DomainTerm>, or discard. Confirm{" "}
                <DomainTerm term="grounding">grounding</DomainTerm> before revalidating.
              </span>
            </div>
          )}
        </div>
      </section>

      <section className={styles.flowStepCard} data-workflow-step="select">
        <div className={styles.flowStepHeader}>
          <span className={styles.flowNumber}>03</span>
          <div>
            <h2>
              Select a <DomainTerm term="coa">COA</DomainTerm>
            </h2>
            <p>
              Automated COAs are immutable baselines. Operator drafts and modified variants are
              separate revisions.
            </p>
          </div>
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
                  Modify as New Variant
                </button>
              )}
            {selectedCoa && isOperatorCandidate(selectedCoa) && (
              <button
                type="button"
                className={styles.flowSecondaryButton}
                onClick={() => void onValidateOperator()}
                disabled={selectedCoa.status === "validating"}
              >
                {selectedCoa.status === "validating"
                  ? "Validating…"
                  : "Validate Operator COA"}
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
                  Merge into parent COA
                </button>
              )}
          </div>
        </div>
        {operatorValidationFeedback && operatorValidationFeedback.messages.length > 0 ? (
          <div
            className={
              operatorValidationFeedback.kind === "success"
                ? styles.flowValidationSuccess
                : styles.flowValidationError
            }
            role="status"
          >
            <strong>
              {operatorValidationFeedback.kind === "success"
                ? "Operator validation passed"
                : "Operator validation issues"}
            </strong>
            <ul>
              {operatorValidationFeedback.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {mergeConfirmCoaId && selectedCoa?.parentCoaId && (
          <div className={styles.flowMergeConfirm} role="status">
            <strong>Merge into parent?</strong>
            <span>
              Apply validated revision to{" "}
              {candidates.find((c) => c.id === selectedCoa.parentCoaId)?.label ?? "parent COA"}.
              The operator variant will be removed.
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
                Confirm merge
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
          <div className={styles.flowEmpty}>
            Run event analysis to generate courses of action.
          </div>
        ) : (
          <div className={styles.flowCoaGrid}>
            {candidates.map((coa) => {
              const selectable = canSelectCandidate(coa);
              const parent = coa.parentCoaId
                ? candidates.find((c) => c.id === coa.parentCoaId)
                : undefined;
              return (
                <button
                  key={coa.id}
                  type="button"
                  className={
                    selectedCoaId === coa.id ? styles.flowCoaCardActive : styles.flowCoaCard
                  }
                  onClick={() => selectable && onSelectCoa(coa.id)}
                  disabled={!selectable}
                >
                  <div>
                    <strong>{coa.label}</strong>
                    <span
                      className={
                        coa.status === "sat" ? styles.flowBadgeReady : styles.flowBadgeBlocked
                      }
                    >
                      {candidateBadgeLabel(coa, selectedCoaId === coa.id)}
                    </span>
                  </div>
                  {parent && <small>Based on: {parent.label}</small>}
                  {coa.parentCoaId && selectedCoaId === coa.id && (
                    <small>
                      Diff: +
                      {overlayDiffSummary(
                        selectedCoaId === coa.id ? matrixOverlay : EMPTY_MATRIX_OVERLAY,
                        parent
                      ).added}{" "}
                      · ~
                      {overlayDiffSummary(
                        selectedCoaId === coa.id ? matrixOverlay : EMPTY_MATRIX_OVERLAY,
                        parent
                      ).changed}{" "}
                      · −
                      {overlayDiffSummary(
                        selectedCoaId === coa.id ? matrixOverlay : EMPTY_MATRIX_OVERLAY,
                        parent
                      ).removed}
                    </small>
                  )}
                  {coa.validationBlockers && coa.validationBlockers.length > 0 && (
                    <small>{coa.validationBlockers[0]}</small>
                  )}
                  <p>
                    {coa.effects?.explanation ??
                      `${coa.selectedActions.length} scheduled action${coa.selectedActions.length === 1 ? "" : "s"}`}
                  </p>
                  <small>
                    {formatHeuristicScore(coa.scores.overall)} ·{" "}
                    {formatHeuristicRisk(coa.scores.risk)}
                  </small>
                </button>
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
          <div>
            <h2>
              Execute
              <span className={styles.executeAuthorityBadge}>Primary control</span>
            </h2>
            <p>
              Commit the validated revision shown in the{" "}
              <DomainTerm term="syncMatrix">synchronization matrix</DomainTerm> — not an older
              generated baseline. Use this control to prepare and execute.
            </p>
          </div>
          <button
            type="button"
            className={styles.executeButton}
            disabled={!canClickExecute && !executionMessage && !isPlaying}
            onClick={onExecuteCoa}
          >
            {executionMessage || isPlaying ? "COA executing" : "Execute prepared COA"}
          </button>
        </div>
        {executionMessage || isPlaying ? (
          <div className={styles.executionStatus}>
            <strong>
              {playbackStatus.phase === "playing"
                ? `Executing — task ${playbackStatus.taskActiveCount} of ${playbackStatus.taskTotal}`
                : executionMessage?.title ?? "COA executing"}
            </strong>
            <span>
              {playbackStatus.currentTaskLabel ??
                executionMessage?.detail ??
                "Watch the banner above the timeline for live progress."}
            </span>
          </div>
        ) : (
          <div className={styles.executionHint}>
            {!selectedCoa
              ? "Choose a COA first."
              : blockingExecute.length > 0
                ? blockingExecute[0]
                : preparedExecution
                  ? `Prepared revision ${preparedExecution.revisionId} — ready to execute.`
                  : "Ready to prepare and execute."}
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
                    <DomainTerm term="rebase">Rebase</DomainTerm> on {defaultAutomatedParent.label}
                  </button>
                )}
                {isOperatorCandidate(selectedCoa) && (
                  <button
                    type="button"
                    className={styles.flowSecondaryButton}
                    onClick={() => selectedCoaId && onDiscardOperatorCoa(selectedCoaId)}
                  >
                    Discard operator COA
                  </button>
                )}
              </div>
            )}
            {selectedCoa &&
              coaOrigin(selectedCoa) === "operator-modified" &&
              hasOverlayChanges(matrixOverlay) && (
                <small>
                  Changes: +{overlayDiff.added} · ~{overlayDiff.changed} · −{overlayDiff.removed}
                </small>
              )}
            {selectedCoa?.validatedOrderSet && (
              <small>
                Validated order set: {selectedCoa.validatedOrderSet.actionCount} task
                {selectedCoa.validatedOrderSet.actionCount === 1 ? "" : "s"} · revision{" "}
                {selectedCoa.validatedOrderSet.revisionId}
              </small>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
