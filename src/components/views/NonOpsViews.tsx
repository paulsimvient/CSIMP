import { AgentEvolutionPanel } from "@components/agentEvolution/AgentEvolutionPanel";
import { CoaSelector } from "@components/CoaSelector";
import { CyberLabApprovalPanel } from "@components/coa/CyberLabApprovalPanel";
import { CyberEffectsBadge } from "@components/coa/CyberEffectsBadge";
import { IntelPanel } from "@components/IntelPanel";
import { CommanderMatrix } from "@components/CommanderMatrix";
import { LogisticsMatrix } from "@components/LogisticsMatrix";
import type { CoaRunMetadata } from "@coa/types";
import type { CyberEmulationRunOptions } from "../../coa/cyberEmulation";
import type { SqlSnapshotMeta } from "../../persistence/sqlState";
import styles from "../../App.module.css";

type ActiveView =
  | "overview"
  | "signals"
  | "actions"
  | "coas"
  | "logistics"
  | "reports"
  | "trace"
  | "agents";

type IssueDetail = {
  title: string;
  hint: string;
};

type NonOpsViewsProps = {
  activeView: ActiveView;
  onRefreshSignals: () => void;
  onOpenTrace: () => void;
  runtimeStatus: any;
  groundingResult: any;
  topBlockingIssueDetails: IssueDetail[];
  topReviewIssueDetails: IssueDetail[];
  hiddenBlockingIssueCount: number;
  hiddenReviewIssueCount: number;
  blockingIssueDetails: IssueDetail[];
  reviewIssueDetails: IssueDetail[];
  facts: any[];
  packet: any;
  interpretation: any;
  agentRuntime?: {
    agentId: string;
    agentVersion: string;
    releaseId?: string;
    inputHash: string;
    outputHash: string;
  };
  validatedActions: any[];
  coaError: string | undefined;
  candidates: any[];
  selectedCoa: any;
  onSelectCoa: (candidate: any) => void;
  displayedPlan: any;
  importInputRef: React.Ref<HTMLInputElement>;
  onImportDbFile: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  coaStatus: string;
  llmLabel: string;
  validatedDecisionPoints: any[];
  snapshotMeta: SqlSnapshotMeta[];
  storageBytes: number;
  formatBytes: (value: number) => string;
  describeSnapshotKey: (key: string) => string;
  formatTimestamp: (value: number) => string;
  onExportDb: () => void;
  onImportDbClick: () => void;
  onResetStoredState: () => void;
  persistenceError: string | undefined;
  interpreterPrompt: string;
  rawModelText: string | undefined;
  interpretationActionIds: string[];
  droppedActionIds: string[];
  interpretationOptionKeys: string[];
  droppedUnsupportedOptionKeys: string[];
  filteredOutForSolverOptionKeys: string[];
  solverEligibleOptionKeys: string[];
  solverPayload: any;
  commanderIntent?: string;
  coaRunMetadata?: CoaRunMetadata;
  onRunLabCoaValidation: (options: CyberEmulationRunOptions) => void;
};

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className={styles.sectionHeader}>{children}</h2>;
}

function ErrorBanner({ message }: { message: string }) {
  return <div className={styles.errorBanner}>{message}</div>;
}

function EffectsPanel({
  explanation,
  risks,
  impact,
  confidence,
}: {
  explanation: string;
  risks: string[];
  impact: number;
  confidence: number;
}) {
  return (
    <div className={styles.effects}>
      <div className={styles.effectsHeader}>
        <span>Effects Analysis</span>
        <span className={styles.effectsMeta}>
          Impact {Math.round(impact * 100)}% · Confidence {Math.round(confidence * 100)}%
        </span>
      </div>
      <p className={styles.effectsExplanation}>{explanation}</p>
      {risks.length > 0 && (
        <ul className={styles.riskList}>
          {risks.map((risk, i) => (
            <li key={i} className={styles.riskItem}>
              {risk}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TraceCard({
  title,
  subtitle,
  children,
  code,
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
  code?: string;
}) {
  return (
    <div className={styles.traceCard}>
      <div className={styles.traceTitle}>{title}</div>
      <div className={styles.traceSubtle}>{subtitle}</div>
      {children}
      {code && <pre className={styles.traceCode}>{code}</pre>}
    </div>
  );
}

export function NonOpsViews(props: NonOpsViewsProps) {
  if (props.activeView === "signals") {
    return (
      <section className={styles.viewPanel}>
        <div className={styles.viewHeaderRow}>
          <SectionHeader>Signals</SectionHeader>
          <button className={styles.secondaryMiniButton} onClick={props.onRefreshSignals} type="button">
            Refresh Signals
          </button>
        </div>
        <div className={styles.reportList}>
          <div className={styles.reportItem}>
            <strong>Run Summary</strong>
            <span>
              Status:{" "}
              {"solverBlockedReason" in props.runtimeStatus && props.runtimeStatus.solverBlockedReason
                ? "Solver blocked"
                : "Solver allowed"}{" "}
              · Blocking: {props.groundingResult?.blockingIssues ?? 0} · Review:{" "}
              {props.groundingResult?.reviewIssues ?? 0}
            </span>
            {"solverBlockedReason" in props.runtimeStatus && props.runtimeStatus.solverBlockedReason ? (
              <span>{props.runtimeStatus.solverBlockedReason.detail}</span>
            ) : (
              <span>No runtime block reported for solver in this run.</span>
            )}
            {props.topBlockingIssueDetails.map((item, index) => (
              <span key={`${item.title}-${index}`}>- {item.title}</span>
            ))}
            {props.topBlockingIssueDetails.length === 0 && (
              <span>No blocking grounding issues detected.</span>
            )}
            {props.topReviewIssueDetails.map((item, index) => (
              <span key={`${item.title}-${index}`}>- {item.title}</span>
            ))}
            {(props.hiddenBlockingIssueCount > 0 || props.hiddenReviewIssueCount > 0) && (
              <details className={styles.compactDetails}>
                <summary>
                  Show details ({props.hiddenBlockingIssueCount + props.hiddenReviewIssueCount} more issue
                  {props.hiddenBlockingIssueCount + props.hiddenReviewIssueCount === 1 ? "" : "s"})
                </summary>
                {props.blockingIssueDetails.length > 0 && (
                  <div className={styles.blockingIssueList}>
                    {props.blockingIssueDetails.map((item, index) => (
                      <div key={`${item.title}-${index}`} className={styles.blockingIssueItem}>
                        <strong>{item.title}</strong>
                        <span>{item.hint}</span>
                      </div>
                    ))}
                  </div>
                )}
                {props.reviewIssueDetails.length > 0 && (
                  <div className={styles.reviewIssueList}>
                    {props.reviewIssueDetails.map((item, index) => (
                      <div key={`${item.title}-${index}`} className={styles.reviewIssueItem}>
                        <strong>{item.title}</strong>
                        <span>{item.hint}</span>
                      </div>
                    ))}
                  </div>
                )}
              </details>
            )}
            <div className={styles.reportActions}>
              <button className={styles.secondaryMiniButton} onClick={props.onOpenTrace} type="button">
                Open Decision Trace
              </button>
            </div>
          </div>
        </div>
        <IntelPanel
          facts={props.facts}
          packet={props.packet}
          interpretation={props.interpretation}
          groundingResult={props.groundingResult}
          agentRuntime={props.agentRuntime}
        />
      </section>
    );
  }

  if (props.activeView === "actions") {
    return (
      <section className={styles.viewPanel}>
        <SectionHeader>Action Proposals</SectionHeader>
        <div className={styles.reportList}>
          {props.validatedActions.length === 0 && (
            <div className={styles.reportItem}>
              No validated actions yet. Run pipeline to populate actions.
            </div>
          )}
          {props.validatedActions.map((action) => (
            <div key={action.id} className={styles.reportItem}>
              <strong>{action.description}</strong>
              <span>
                Facts: {action.citedFacts.join(", ") || "none"} · Confidence:{" "}
                {action.confidence ?? "medium"}
              </span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (props.activeView === "coas") {
    return (
      <section className={styles.coaLayout}>
        <aside className={styles.sidebar}>
          <SectionHeader>COA Candidates</SectionHeader>
          {props.coaError && <ErrorBanner message={props.coaError} />}
          <CyberLabApprovalPanel
            disabled={props.coaStatus === "running" || props.coaStatus === "idle"}
            runMetadata={props.coaRunMetadata}
            onRunLabValidation={props.onRunLabCoaValidation}
          />
          <CoaSelector
            candidates={props.candidates}
            selectedCoaId={props.selectedCoa?.id}
            onSelect={props.onSelectCoa}
          />
        </aside>
        <section className={styles.content}>
          <SectionHeader>Commander&apos;s Matrix</SectionHeader>
          <CommanderMatrix
            candidates={props.candidates}
            selectedCoaId={props.selectedCoa?.id}
            onSelectCoa={props.onSelectCoa}
            commanderIntent={props.commanderIntent}
            decisionPoints={props.validatedDecisionPoints}
          />
          <SectionHeader>
            Logistics Matrix
            {props.selectedCoa && (
              <span className={styles.matrixSubtitle}> — {props.selectedCoa.label}</span>
            )}
          </SectionHeader>
          {props.displayedPlan.kind === "populated" && props.displayedPlan.source === "demo" && (
            <div className={styles.demoBanner}>
              DEMO COA DATA — NOT DERIVED FROM VALIDATED INTEL
            </div>
          )}
          <LogisticsMatrix plan={props.displayedPlan} allowDemo />
          {props.selectedCoa?.effects && (
            <>
              <CyberEffectsBadge cyberEffects={props.selectedCoa.effects.cyberEffects} />
              <EffectsPanel
                explanation={props.selectedCoa.effects.explanation}
                risks={props.selectedCoa.effects.risks}
                impact={props.selectedCoa.effects.expectedImpact}
                confidence={props.selectedCoa.effects.confidence}
              />
            </>
          )}
        </section>
      </section>
    );
  }

  if (props.activeView === "logistics") {
    return (
      <section className={styles.viewPanel}>
        <SectionHeader>Logistics</SectionHeader>
        {props.displayedPlan.kind === "populated" && props.displayedPlan.source === "demo" && (
          <div className={styles.demoBanner}>
            DEMO COA DATA — NOT DERIVED FROM VALIDATED INTEL
          </div>
        )}
        <LogisticsMatrix plan={props.displayedPlan} />
      </section>
    );
  }

  if (props.activeView === "reports") {
    return (
      <section className={styles.viewPanel}>
        <SectionHeader>Reports</SectionHeader>
        <input
          ref={props.importInputRef}
          type="file"
          accept=".sqlite,application/x-sqlite3"
          className={styles.hiddenFileInput}
          onChange={(event) => void props.onImportDbFile(event)}
        />
        <div className={styles.reportList}>
          <div className={styles.reportItem}>
            <strong>Signal Snapshot</strong>
            <span>
              Facts: {props.facts.length} · Validated Actions: {props.validatedActions.length} ·
              Decision Points: {props.validatedDecisionPoints.length}
            </span>
          </div>
          <div className={styles.reportItem}>
            <strong>COA Snapshot</strong>
            <span>
              Candidates: {props.candidates.length} · Selected: {props.selectedCoa?.label ?? "none"} ·
              Pipeline: {props.coaStatus}
            </span>
          </div>
          <div className={styles.reportItem}>
            <strong>LLM Status</strong>
            <span>{props.llmLabel}</span>
          </div>
          <div className={styles.reportItem}>
            <strong>Persistence Status (SQLite)</strong>
            <span>
              Snapshots: {props.snapshotMeta.length} · Stored DB: {props.formatBytes(props.storageBytes)}
            </span>
            <span>
              Snapshots = number of named app-state records currently in SQLite (normally
              `intel_state` + `coa_state`).
            </span>
            <span>
              Stored DB = total on-device SQLite size across all tables/metadata. Use this to
              monitor persistence footprint.
            </span>
            {props.snapshotMeta.map((meta) => (
              <div key={meta.key} className={styles.snapshotMetaRow}>
                <strong>{meta.key}</strong>
                <span>{props.describeSnapshotKey(meta.key)}</span>
                <span>Last saved: {props.formatTimestamp(meta.updatedAt)}</span>
                <span>Snapshot payload size: {props.formatBytes(meta.jsonBytes)}</span>
              </div>
            ))}
            {props.snapshotMeta.length === 0 && <span>No snapshots stored yet.</span>}
            <span>
              Export DB downloads the full SQLite file for backup/audit. Import DB restores a
              previously exported file and reloads app state. Reset Stored State clears all
              persisted snapshots.
            </span>
            <div className={styles.reportActions}>
              <button className={styles.secondaryMiniButton} type="button" onClick={props.onExportDb}>
                Export DB
              </button>
              <button className={styles.secondaryMiniButton} type="button" onClick={props.onImportDbClick}>
                Import DB
              </button>
              <button className={styles.secondaryMiniButton} type="button" onClick={props.onResetStoredState}>
                Reset Stored State
              </button>
            </div>
            {props.persistenceError && <span>{props.persistenceError}</span>}
          </div>
        </div>
      </section>
    );
  }

  if (props.activeView === "agents") {
    return (
      <section className={styles.viewPanel}>
        <AgentEvolutionPanel />
      </section>
    );
  }

  if (props.activeView === "trace") {
    return (
      <section className={styles.viewPanel}>
        <SectionHeader>Decision Trace</SectionHeader>
        <div className={styles.traceStack}>
          <TraceCard
            title="0) LLM Prompt"
            subtitle="Exact prompt sent to the model for this run"
            code={props.interpreterPrompt}
          />
          <TraceCard
            title="1A) Raw Model Text"
            subtitle="Exact text returned by model before JSON parsing"
            code={props.rawModelText ?? "No model response captured yet."}
          />
          <TraceCard
            title="1B) Normalized LLM Output"
            subtitle="Parsed model output after schema normalization"
            code={JSON.stringify(
              props.interpretation ?? {
                observedFactsUsed: [],
                inferences: [],
                decisionPoints: [],
                candidateActions: [],
              },
              null,
              2
            )}
          />
          <TraceCard
            title="2) Grounding / Validation Results"
            subtitle="What deterministic checks accepted or rejected"
          >
            <ul className={styles.traceList}>
              <li>Validated actions: {props.groundingResult?.validatedActionIds.length ?? 0}</li>
              <li>
                Validated decision points: {props.groundingResult?.validatedDecisionPointIds.length ?? 0}
              </li>
              <li>Issues: {props.groundingResult?.issues.length ?? 0}</li>
              <li>Blocking issues: {props.groundingResult?.blockingIssues ?? 0}</li>
              <li>Review issues: {props.groundingResult?.reviewIssues ?? 0}</li>
              <li>Usable for planning: {props.groundingResult?.usableForPlanning ? "yes" : "no"}</li>
              {"solverBlockedReason" in props.runtimeStatus && props.runtimeStatus.solverBlockedReason && (
                <li>Solver blocked reason: {props.runtimeStatus.solverBlockedReason.code}</li>
              )}
            </ul>
            <pre className={styles.traceCode}>
              {JSON.stringify(props.groundingResult ?? props.runtimeStatus, null, 2)}
            </pre>
          </TraceCard>
          <TraceCard
            title="2A) Blocking Issues (Auto-highlight)"
            subtitle="Only solver-blocking issues with direct fix hints"
          >
            {props.blockingIssueDetails.length === 0 ? (
              <div className={styles.groundingOkNote}>
                No blocking issues detected. Solver is allowed to run.
              </div>
            ) : (
              <div className={styles.blockingIssueList}>
                {props.blockingIssueDetails.map((item, index) => (
                  <div key={`${item.title}-${index}`} className={styles.blockingIssueItem}>
                    <strong>{item.title}</strong>
                    <span>{item.hint}</span>
                  </div>
                ))}
              </div>
            )}
          </TraceCard>
          <TraceCard
            title="2B) Derivation Pipeline"
            subtitle="How data is reduced from model output to solver input"
          >
            <ul className={styles.traceList}>
              <li>Observed facts in packet: {props.packet?.observedFacts.length ?? 0}</li>
              <li>Raw candidate actions: {props.interpretationActionIds.length}</li>
              <li>
                Actions dropped by grounding: {props.droppedActionIds.length}
                {props.droppedActionIds.length > 0 ? ` (${props.droppedActionIds.join(", ")})` : ""}
              </li>
              <li>Raw decision options: {props.interpretationOptionKeys.length}</li>
              <li>
                Options dropped as unsupported: {props.droppedUnsupportedOptionKeys.length}
                {props.droppedUnsupportedOptionKeys.length > 0
                  ? ` (${props.droppedUnsupportedOptionKeys.join(", ")})`
                  : ""}
              </li>
              <li>
                Options filtered before solver (non-executable/non-explicit):{" "}
                {props.filteredOutForSolverOptionKeys.length}
                {props.filteredOutForSolverOptionKeys.length > 0
                  ? ` (${props.filteredOutForSolverOptionKeys.join(", ")})`
                  : ""}
              </li>
              <li>Solver-eligible options: {props.solverEligibleOptionKeys.length}</li>
              <li>Total solver intelActions: {props.solverPayload.intelActions.length}</li>
            </ul>
          </TraceCard>
          <TraceCard
            title="4) SMT / Solver Payload"
            subtitle="Normalized object passed downstream to COA solver"
            code={JSON.stringify(props.solverPayload, null, 2)}
          />
        </div>
      </section>
    );
  }

  return null;
}
