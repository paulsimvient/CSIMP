import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { CoaSelector } from "@components/CoaSelector";
import { LogisticsMatrix } from "@components/LogisticsMatrix";
import { EnvironmentBanner } from "./components/ops/EnvironmentBanner";
import { OpsHeader } from "./components/ops/OpsHeader";
import { RestartConfirmDialog } from "./components/ops/RestartConfirmDialog";
import { OpsWorkspace } from "./components/ops/OpsWorkspace";
import { OpsWindowsProvider } from "./components/ops/OpsWindowsContext";
import type { MessageTrafficItem, OverviewTrack, ShowOrderItem } from "./components/ops/types";

const NonOpsViews = lazy(() =>
  import("./components/views/NonOpsViews").then((module) => ({ default: module.NonOpsViews }))
);
import { contactKinematics } from "./scene/kinematics";
import {
  collectSensorFootprints,
  filterFactsInSensorRange,
  isSensorEntityFact,
} from "./scene/sensors";
import { factToLngLat, normalizeFactsForTheater } from "./scene/theater";
import type { IntelFidelityScore, LogisticsPlan } from "@coa/types";
import {
  useDisplayedPlan,
  usePipelineError,
  useResetCoa,
  usePipelineStatus,
  useRankedCandidates,
  useRunMetadata,
  useRunPipeline,
  useCreateOperatorDraft,
  useSelectCoa,
  useSelectedCoa,
} from "@coa/store";
import type { CyberEmulationRunOptions } from "./coa/cyberEmulation";
import {
  useGroundingResult,
  useIntelStatus,
  useIntelStore,
  useObservedFacts,
  useRawModelText,
  useRawInterpretation,
  useResetIntel,
  useRunIntel,
  useScenarioPacket,
  useValidatedActions,
  useValidatedDecisionPoints,
} from "./intel/pipeline";
import type { ObservedFact } from "./intel/types";
import { stubPortAFacts } from "./intel/facts";
import { buildInterpreterPrompt } from "./intel/scenarioPacket";
import { getLlmConfig, getLlmStatus } from "./intel/llmConfig";
import {
  exportSqlDatabaseBytes,
  getSqlStorageBytes,
  importSqlDatabaseBytes,
  listSqlSnapshotMeta,
  type SqlSnapshotMeta,
} from "./persistence/sqlState";
import styles from "./App.module.css";

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
          Impact {pct(impact)} · Confidence {pct(confidence)}
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

function IntelFidelityPanel({
  fidelity,
}: {
  fidelity: IntelFidelityScore;
}) {
  const explanation = explainAlignment(fidelity);
  return (
    <div className={styles.fidelityPanel}>
      <div className={styles.effectsHeader}>
        <span>Intel Fidelity Breakdown</span>
        <span className={styles.effectsMeta}>
          Alignment {pct(fidelity.alignment)} · Urgency {pct(fidelity.urgency)}
        </span>
      </div>
      <p className={styles.effectsExplanation}>{explanation}</p>
      <div className={styles.fidelityGrid}>
        <MetricRow label="Confidence factor" value={fidelity.confidence} />
        <MetricRow label="Resource pressure" value={fidelity.resourcePressure} />
        <MetricRow
          label="Effects adjustment"
          value={fidelity.effectsAdjustment}
          signed
        />
        <MetricRow label="Risk adjustment" value={fidelity.riskAdjustment} signed />
      </div>
      <div className={styles.fidelityTags}>
        <span className={styles.fidelityTagLabel}>Intel focus:</span>
        {fidelity.focusTypes.length > 0
          ? fidelity.focusTypes.map((type) => (
              <span key={`focus-${type}`} className={styles.fidelityTag}>
                {type}
              </span>
            ))
          : <span className={styles.fidelityTagMuted}>none</span>}
      </div>
      <div className={styles.fidelityTags}>
        <span className={styles.fidelityTagLabel}>Matched actions:</span>
        {fidelity.matchedActionTypes.length > 0
          ? fidelity.matchedActionTypes.map((type) => (
              <span key={`match-${type}`} className={styles.fidelityTag}>
                {type}
              </span>
            ))
          : <span className={styles.fidelityTagMuted}>none</span>}
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  signed = false,
}: {
  label: string;
  value: number;
  signed?: boolean;
}) {
  return (
    <div className={styles.fidelityMetricRow}>
      <span>{label}</span>
      <span className={styles.fidelityMetricValue}>
        {signed ? signedPct(value) : pct(value)}
      </span>
    </div>
  );
}

function explainAlignment(
  fidelity: IntelFidelityScore
): string {
  if (fidelity.focusTypes.length === 0) {
    return "No specific intel focus domains were detected, so alignment uses a neutral baseline.";
  }

  const missed = fidelity.focusTypes.filter(
    (type) => !fidelity.matchedActionTypes.includes(type)
  );
  if (fidelity.alignment >= 0.7) {
    return `Selected actions align well with intel focus domains (${fidelity.matchedActionTypes.join(", ")}), which supports higher urgency-weighted effects scoring.`;
  }
  if (fidelity.alignment >= 0.4) {
    return `Selected actions partially align with intel focus (${fidelity.matchedActionTypes.join(", ")}), but miss some domains (${missed.join(", ")}).`;
  }
  return `Selected actions show low alignment with intel focus domains (${fidelity.focusTypes.join(", ")}), so the model applies conservative effects and risk adjustments.`;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function signedPct(v: number): string {
  const rounded = Math.round(v * 100);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function llmProgressFromStatus(
  intelStatus: ReturnType<typeof useIntelStatus>
): { percent: number; label: string } {
  switch (intelStatus) {
    case "collecting":
      return { percent: 20, label: "Collecting facts" };
    case "interpreting":
      return { percent: 62, label: "LLM interpreting" };
    case "validating":
      return { percent: 86, label: "Grounding validation" };
    case "ready":
      return { percent: 100, label: "LLM complete" };
    case "error":
      return { percent: 100, label: "LLM error" };
    case "idle":
    default:
      return { percent: 0, label: "Idle" };
  }
}

function solverProgressFromStatus(
  coaStatus: ReturnType<typeof usePipelineStatus>,
  intelStatus: ReturnType<typeof useIntelStatus>
): { percent: number; label: string } {
  if (
    coaStatus === "idle" &&
    (intelStatus === "collecting" ||
      intelStatus === "interpreting" ||
      intelStatus === "validating")
  ) {
    return { percent: 10, label: "Waiting on LLM" };
  }
  switch (coaStatus) {
    case "running":
      return { percent: 58, label: "Solver running" };
    case "ready":
      return { percent: 100, label: "Solver complete" };
    case "error":
      return { percent: 100, label: "Solver error" };
    case "idle":
    default:
      return { percent: 0, label: "Idle" };
  }
}

export function App() {
  const [activeView, setActiveView] = useState<
    | "overview"
    | "signals"
    | "actions"
    | "coas"
    | "logistics"
    | "reports"
    | "trace"
  >("overview");
  const [showFixSteps, setShowFixSteps] = useState(false);
  const [snapshotMeta, setSnapshotMeta] = useState<SqlSnapshotMeta[]>([]);
  const [storageBytes, setStorageBytes] = useState(0);
  const [persistenceError, setPersistenceError] = useState<string | undefined>(undefined);
  const [solverBlockedReason, setSolverBlockedReason] = useState<
    | {
        code:
          | "intel-not-ready"
          | "blocking-validation-issues"
          | "no-executable-explicit-options";
        detail: string;
      }
    | undefined
  >(undefined);
  const [selectedOverviewTrackId, setSelectedOverviewTrackId] = useState<
    string | undefined
  >(undefined);
  const [overviewTrackFilter, setOverviewTrackFilter] = useState<
    "all" | OverviewTrack["side"]
  >("all");
  const [overviewTrackSort, setOverviewTrackSort] = useState<
    "freshest" | "confidence"
  >("freshest");
  const [contactLifecycleEvents, setContactLifecycleEvents] = useState<MessageTrafficItem[]>([]);
  const [reportFilter, setReportFilter] = useState<
    "all" | MessageTrafficItem["channel"]
  >("all");
  const [ackedReportIds, setAckedReportIds] = useState<string[]>([]);
  const previousTrackLifecycleRef = useRef<Record<string, string>>({});
  const previousOrderStatusRef = useRef<Record<string, ShowOrderItem["status"]>>({});
  const llmStatus = getLlmStatus();
  const llmConfig = getLlmConfig();
  const intelStatus = useIntelStatus();
  const intelError = useIntelStore((s) => s.error);
  const facts = useObservedFacts();
  const packet = useScenarioPacket();
  const rawModelText = useRawModelText();
  const interpretation = useRawInterpretation();
  const groundingResult = useGroundingResult();
  const validatedActions = useValidatedActions();
  const validatedDecisionPoints = useValidatedDecisionPoints();
  const runIntel = useRunIntel();
  const resetIntel = useResetIntel();

  const coaStatus = usePipelineStatus();
  const coaError = usePipelineError();
  const candidates = useRankedCandidates();
  const selectedCoa = useSelectedCoa();
  const displayedPlan = useDisplayedPlan();
  const runPipeline = useRunPipeline();
  const runMetadata = useRunMetadata();
  const resetCoa = useResetCoa();
  const selectCoa = useSelectCoa();
  const createOperatorDraft = useCreateOperatorDraft();
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const handleFullRun = async () => {
    setSolverBlockedReason(undefined);
    await runIntel();
    await executeValidatedCoaPipeline();
  };

  const handleLabCoaValidation = async (cyberEmulation: CyberEmulationRunOptions) => {
    setSolverBlockedReason(undefined);
    await executeValidatedCoaPipeline(cyberEmulation);
  };

  const executeValidatedCoaPipeline = async (
    cyberEmulation?: CyberEmulationRunOptions
  ) => {
    const intelState = useIntelStore.getState();
    if (intelState.status !== "ready") {
      setSolverBlockedReason({
        code: "intel-not-ready",
        detail: "Intel pipeline did not reach ready state; solver run was skipped.",
      });
      return;
    }

    const payload = buildSolverPayload(
      intelState.validatedActions,
      intelState.validatedDecisionPoints,
      intelState.scenarioPacket
    );
    if (payload.intelActions.length === 0) {
      const blockingIssues = intelState.groundingResult?.blockingIssues ?? 0;
      setSolverBlockedReason({
        code:
          blockingIssues > 0
            ? "blocking-validation-issues"
            : "no-executable-explicit-options",
        detail:
          blockingIssues > 0
            ? `Grounding reported ${blockingIssues} blocking issue(s); no executable grounded actions remained for the solver.`
            : "No executable grounded actions remained after gating; solver run was skipped.",
      });
      return;
    }
    await runPipeline({
      intelActions: payload.intelActions,
      mode: "validated-intel",
      observedFacts: intelState.scenarioPacket?.observedFacts,
      scenarioId: "port-a",
      cyberEmulation,
    });
  };

  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);

  const requestRestartScenario = () => {
    setRestartConfirmOpen(true);
  };

  const handleResetStoredState = () => {
    requestRestartScenario();
  };

  const handleRestartScenario = () => {
    setRestartConfirmOpen(false);
    resetIntel();
    resetCoa();
    setContactLifecycleEvents([]);
    previousTrackLifecycleRef.current = {};
    previousOrderStatusRef.current = {};
    setSelectedOverviewTrackId(undefined);
    setAckedReportIds([]);
    setReportFilter("all");
    setSolverBlockedReason(undefined);
    setOverviewTrackFilter("all");
    setShowFixSteps(false);
    void refreshPersistenceStatus();
  };

  const refreshPersistenceStatus = async () => {
    const meta = await listSqlSnapshotMeta();
    setSnapshotMeta(meta);
    setStorageBytes(getSqlStorageBytes());
  };

  useEffect(() => {
    void refreshPersistenceStatus();
  }, [intelStatus, coaStatus, selectedCoa?.id]);

  const handleExportDb = () => {
    const bytes = exportSqlDatabaseBytes();
    if (!bytes || bytes.length === 0) {
      setPersistenceError("No persisted database found to export.");
      return;
    }
    setPersistenceError(undefined);
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: "application/x-sqlite3" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `coda2-state-${Date.now()}.sqlite`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImportDbClick = () => {
    importInputRef.current?.click();
  };

  const handleImportDbFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      await importSqlDatabaseBytes(new Uint8Array(buffer));
      setPersistenceError(undefined);
      window.location.reload();
    } catch (err) {
      setPersistenceError(err instanceof Error ? err.message : String(err));
    } finally {
      event.target.value = "";
    }
  };

  const isRunning =
    intelStatus === "collecting" ||
    intelStatus === "interpreting" ||
    coaStatus === "running";
  const llmProgress = llmProgressFromStatus(intelStatus);
  const solverProgress = solverProgressFromStatus(coaStatus, intelStatus);
  const prioritizedFacts = [...facts].sort((a, b) => {
    const severity = severityWeight(b.severity) - severityWeight(a.severity);
    if (severity !== 0) return severity;
    return b.time.localeCompare(a.time);
  });
  const topActions = validatedActions.slice(0, 3);
  const mapFacts = useMemo(() => {
    const usingScenario = prioritizedFacts.length === 0;
    const source = usingScenario
      ? stubPortAFacts().map((fact) => ({ ...fact, sourceType: "scenario-demo" as const }))
      : prioritizedFacts.map((fact) => ({ ...fact, sourceType: "loaded-fact" as const }));
    return normalizeFactsForTheater(source);
  }, [prioritizedFacts]);
  const nowLabel = new Date().toLocaleString();
  const recommended = selectedCoa ?? candidates[0];
  const factDomains = Array.from(new Set(facts.map((fact) => fact.domain)));
  const phase = prioritizedFacts.some((f) => f.severity === "critical")
    ? "Strike Window"
    : prioritizedFacts.some((f) => ["high", "critical"].includes(f.severity))
      ? "Gray-Zone Pressure"
      : "Information Contest";
  const summaryTime = prioritizedFacts[0]?.time ?? "--:--";
  const environmentLabel = factDomains.join(" & ") || "Pending";
  const summaryText =
    prioritizedFacts[0]?.event ??
    "Run pipeline to load scenario facts and recommendations.";
  const logisticsScore = recommended ? pct(recommended.scores.logistics) : "--";
  const criticalShortfalls =
    displayedPlan.kind === "populated"
      ? String(Math.max(0, 3 - displayedPlan.lanes.length))
      : "0";
  const atRisk =
    displayedPlan.kind === "populated" ? String(displayedPlan.chips.length) : "0";
  const threatLevel = prioritizedFacts.some((f) => f.severity === "critical")
    ? "CRITICAL"
    : prioritizedFacts.some((f) => f.severity === "high")
      ? "CONTESTED"
      : "GUARDED";
  const messageTraffic = useMemo(
    () => buildMessageTraffic(prioritizedFacts, topActions, groundingResult?.issues.length ?? 0),
    [prioritizedFacts, topActions, groundingResult?.issues.length]
  );
  // Active contacts = in sensor coverage (friendly sensors always listed).
  const overviewTracks = useMemo(() => {
    const tracks = buildSceneContacts(mapFacts);
    return [...tracks].sort((a, b) =>
      overviewTrackSort === "confidence"
        ? b.confidence - a.confidence
        : a.stalenessMinutes - b.stalenessMinutes
    );
  }, [mapFacts, overviewTrackSort]);
  /** Every map marker is pickable as a contact track (incl. out-of-sensor / grey unknown). */
  const scenePickTracks = useMemo(
    () => buildSceneContacts(mapFacts, 0, { includeAllFacts: true }),
    [mapFacts]
  );
  const filteredOverviewTracks = useMemo(() => {
    if (overviewTrackFilter === "all") return overviewTracks;
    return overviewTracks.filter((track) => track.side === overviewTrackFilter);
  }, [overviewTrackFilter, overviewTracks]);
  const selectedOverviewTrack = useMemo(() => {
    if (selectedOverviewTrackId) {
      const matched = overviewTracks.find((track) => track.id === selectedOverviewTrackId);
      if (matched) return matched;
      const factIndex = mapFacts.findIndex((f) => f.id === selectedOverviewTrackId);
      const fact = factIndex >= 0 ? mapFacts[factIndex] : undefined;
      if (fact) {
        const fromFact = buildSceneContacts([fact], factIndex, { includeAllFacts: true });
        if (fromFact[0]) return fromFact[0];
      }
    }
    if (selectedOverviewTrackId) return undefined;
    return filteredOverviewTracks[0] ?? overviewTracks[0];
  }, [selectedOverviewTrackId, overviewTracks, filteredOverviewTracks, mapFacts]);
  const confidenceLevel =
    selectedOverviewTrack && selectedOverviewTrack.confidence >= 0.7 ? "MEDIUM" : "LOW";
  const showOrders = useMemo(
    () =>
      buildShowOrders({
        topActions,
        selectedTrack: selectedOverviewTrack,
        displayedPlan,
      }),
    [topActions, selectedOverviewTrack, displayedPlan]
  );
  const reportWindowItems = useMemo(
    () => [...contactLifecycleEvents, ...messageTraffic].slice(0, 14),
    [contactLifecycleEvents, messageTraffic]
  );
  const filteredReportWindowItems = useMemo(
    () =>
      reportWindowItems.filter((item) =>
        reportFilter === "all" ? true : item.channel === reportFilter
      ),
    [reportWindowItems, reportFilter]
  );
  const unackedAlertCount = useMemo(
    () =>
      reportWindowItems.filter(
        (item) => item.severity === "alert" && !ackedReportIds.includes(item.id)
      ).length,
    [reportWindowItems, ackedReportIds]
  );
  const solverPayload = buildSolverPayload(
    validatedActions,
    validatedDecisionPoints,
    packet
  );
  const interpretationActionIds = interpretation?.candidateActions.map((action) => action.id) ?? [];
  const validatedActionIdSet = new Set(groundingResult?.validatedActionIds ?? []);
  const droppedActionIds = interpretationActionIds.filter(
    (id) => !validatedActionIdSet.has(id)
  );
  const interpretationOptionKeys =
    interpretation?.decisionPoints.flatMap((dp) =>
      dp.options.map((option) => `${dp.id}:${option.id}`)
    ) ?? [];
  const unsupportedOptionKeys = new Set(
    (groundingResult?.issues ?? [])
      .filter((issue) => issue.kind === "unsupported-decision-option")
      .map((issue) => `${issue.decisionPointId}:${issue.optionId}`)
  );
  const droppedUnsupportedOptionKeys = interpretationOptionKeys.filter((key) =>
    unsupportedOptionKeys.has(key)
  );
  const blockingIssues = (groundingResult?.issues ?? []).filter(
    (issue) => issue.kind !== "degraded-grounding"
  );
  const blockingIssueDetails = blockingIssues.map((issue) => {
    if (issue.kind === "unsupported-inference") {
      return {
        title: `Unsupported inference: ${issue.claim}`,
        hint:
          "Add supportingFacts and whyNotHigher for non-high confidence, or lower confidence appropriately.",
      };
    }
    if (issue.kind === "unsupported-action") {
      return {
        title: `Action ${issue.actionId}: ${issue.reason}`,
        hint:
          "Ensure cited facts/inferences are valid and authority + required assets are supported.",
      };
    }
    if (issue.kind === "unsupported-decision-option") {
      return {
        title: `Decision option ${issue.decisionPointId}:${issue.optionId}: ${issue.reason}`,
        hint:
          "Provide explicit citedFacts and valid required assets/authorities for this option.",
      };
    }
    if (issue.kind === "hallucinated-fact-id") {
      return {
        title: `Hallucinated fact ID: ${issue.id}`,
        hint: "Use only fact IDs from observedFacts.",
      };
    }
    if (issue.kind === "unknown-asset") {
      return {
        title: `Unknown asset in action ${issue.actionId}: ${issue.asset}`,
        hint: "Replace with an asset listed in knownAssets.",
      };
    }
    if (issue.kind === "missing-authority-state") {
      return {
        title: `Unknown authority in action ${issue.actionId}: ${issue.authority}`,
        hint: "Use an authority present in knownAuthorities with non-prohibited state.",
      };
    }
    if (issue.kind === "constraint-violation") {
      return {
        title: `Constraint violation: ${issue.constraint}`,
        hint: "Revise content to comply with scenario constraints and remove attribution overreach.",
      };
    }
    if (issue.kind === "hedge-violation") {
      return {
        title: `Forbidden certainty language: "${issue.forbiddenWord}"`,
        hint: "Use hedge language (may indicate / could suggest / requires confirmation).",
      };
    }
    if (issue.kind === "invented-entity") {
      return {
        title: `Invented entity: ${issue.entity}`,
        hint: "Reference only entities/locations present in observed facts.",
      };
    }
    return {
      title: "Blocking issue",
      hint: "Inspect grounding issue details for remediation.",
    };
  });
  const reviewIssueDetails = (groundingResult?.issues ?? [])
    .filter((issue) => issue.kind === "degraded-grounding")
    .map((issue) => ({
      title: `Decision option ${issue.decisionPointId}:${issue.optionId}: inherited citations`,
      hint: issue.reason,
    }));
  const topBlockingIssueDetails = blockingIssueDetails.slice(0, 2);
  const hiddenBlockingIssueCount = Math.max(0, blockingIssueDetails.length - topBlockingIssueDetails.length);
  const topReviewIssueDetails = reviewIssueDetails.slice(0, 2);
  const hiddenReviewIssueCount = Math.max(0, reviewIssueDetails.length - topReviewIssueDetails.length);
  const solverEligibleOptionKeys = validatedDecisionPoints.flatMap((dp) =>
    dp.options
      .filter(
        (option) =>
          option.status === "executable" &&
          (option.grounding === "explicit" || option.grounding === "inherited")
      )
      .map((option) => `${dp.id}:${option.id}`)
  );
  const filteredOutForSolverOptionKeys = validatedDecisionPoints.flatMap((dp) =>
    dp.options
      .filter(
        (option) =>
          !(
            option.status === "executable" &&
            (option.grounding === "explicit" || option.grounding === "inherited")
          )
      )
      .map((option) => `${dp.id}:${option.id}`)
  );
  const interpreterPrompt = packet
    ? buildInterpreterPrompt(packet)
    : "No scenario packet yet. Run pipeline to generate prompt.";
  useEffect(() => {
    const hasAnyTracks =
      filteredOverviewTracks.length > 0 || overviewTracks.length > 0;
    if (!hasAnyTracks) {
      if (selectedOverviewTrackId !== undefined) {
        setSelectedOverviewTrackId(undefined);
      }
      return;
    }

    const currentStillValid =
      selectedOverviewTrackId !== undefined &&
      (mapFacts.some((fact) => fact.id === selectedOverviewTrackId) ||
        overviewTracks.some((track) => track.id === selectedOverviewTrackId));

    const nextId = currentStillValid
      ? selectedOverviewTrackId
      : (filteredOverviewTracks[0] ?? overviewTracks[0])?.id;

    if (nextId !== selectedOverviewTrackId) {
      setSelectedOverviewTrackId(nextId);
    }
  }, [filteredOverviewTracks, overviewTracks, mapFacts, selectedOverviewTrackId]);

  useEffect(() => {
    const validIds = new Set(reportWindowItems.map((item) => item.id));
    setAckedReportIds((current) => {
      const next = current.filter((id) => validIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [reportWindowItems]);

  useEffect(() => {
    const nextLifecycle: Record<string, string> = {};
    const nextEvents: MessageTrafficItem[] = [];
    const clock = formatClock(new Date().toISOString());
    for (const track of overviewTracks) {
      const lifecycle = inferOverviewLifecycle(track);
      nextLifecycle[track.id] = lifecycle;
      const previous = previousTrackLifecycleRef.current[track.id];
      if (!previous) {
        nextEvents.push({
          id: `lifecycle-${track.id}-new`,
          time: clock,
          kind: "track",
          channel: "contact",
          severity: "warn",
          text: `${track.callsign} NEW CONTACT (${track.classification})`,
          factId: track.id,
        });
      } else if (previous !== lifecycle) {
        nextEvents.push({
          id: `lifecycle-${track.id}-${previous}-${lifecycle}`,
          time: clock,
          kind: "track",
          channel: "contact",
          severity:
            lifecycle === "lost"
              ? "alert"
              : lifecycle === "new"
                ? "warn"
                : "info",
          text: `${track.callsign} ${previous.toUpperCase()} -> ${lifecycle.toUpperCase()}`,
          factId: track.id,
        });
      }
    }
    for (const [trackId, previous] of Object.entries(previousTrackLifecycleRef.current)) {
      if (nextLifecycle[trackId]) continue;
      nextEvents.push({
        id: `lifecycle-${trackId}-lost`,
        time: clock,
        kind: "track",
        channel: "contact",
        severity: "alert",
        text: `${trackId} ${previous.toUpperCase()} -> LOST`,
        factId: trackId,
      });
    }
    previousTrackLifecycleRef.current = nextLifecycle;
    if (nextEvents.length === 0) return;
    setContactLifecycleEvents((current) => [...nextEvents, ...current].slice(0, 24));
  }, [overviewTracks]);

  useEffect(() => {
    const clock = formatClock(new Date().toISOString());
    const nextEvents: MessageTrafficItem[] = [];
    for (const order of showOrders) {
      const previous = previousOrderStatusRef.current[order.id];
      if (previous === undefined) {
        previousOrderStatusRef.current[order.id] = order.status;
        continue;
      }
      if (previous === order.status) continue;
      previousOrderStatusRef.current[order.id] = order.status;
      if (order.status === "active" && previous === "queued") {
        nextEvents.push({
          id: `order-exec-${order.id}`,
          time: clock,
          kind: "ops",
          channel: "orders",
          severity: "info",
          text: `ORDER EXEC: ${order.order}`,
        });
      }
      if (order.status === "hold" && previous === "active") {
        nextEvents.push({
          id: `order-hold-${order.id}`,
          time: clock,
          kind: "ops",
          channel: "orders",
          severity: "warn",
          text: `ORDER HOLD: ${order.order}`,
        });
      }
    }
    if (nextEvents.length === 0) return;
    setContactLifecycleEvents((current) => [...nextEvents, ...current].slice(0, 24));
  }, [showOrders]);

  const rejectedDecisionOptionCount =
    groundingResult?.issues.filter((issue) => issue.kind === "unsupported-decision-option")
      .length ?? 0;
  const degradedGroundingCount =
    groundingResult?.issues.filter((issue) => issue.kind === "degraded-grounding").length ??
    0;
  const executableGroundedOptionCount = validatedDecisionPoints.reduce(
    (sum, dp) =>
      sum +
      dp.options.filter(
        (option) =>
          option.status === "executable" &&
          (option.grounding === "explicit" || option.grounding === "inherited")
      ).length,
    0
  );
  const runtimeStatus = groundingResult
    ? {
        status:
          groundingResult.issues.length > 0 ||
          groundingResult.validatedDecisionPointIds.length === 0
            ? "VALIDATED_PARTIAL"
            : "VALIDATED",
        stage: "validation",
        model: llmStatus.label,
        endpoint:
          llmConfig.provider === "ollama"
            ? llmConfig.ollamaBaseUrl
            : llmConfig.openaiEndpoint,
        reason:
          groundingResult.issues.length > 0
            ? "Pipeline completed with validation issues."
            : "Validation completed.",
        validationRan: true,
        solverRan: candidates.length > 0 || coaStatus === "ready",
        safeToExecute:
          groundingResult.issues.length === 0 &&
          groundingResult.validatedActionIds.length > 0 &&
          groundingResult.validatedDecisionPointIds.length > 0,
        solverBlockedReason:
          solverBlockedReason ??
          ((groundingResult.blockingIssues > 0 &&
            !(candidates.length > 0 || coaStatus === "ready")) ||
          (groundingResult.blockingIssues === 0 &&
            groundingResult.validatedActionIds.length === 0 &&
            executableGroundedOptionCount === 0 &&
            !(candidates.length > 0 || coaStatus === "ready"))
            ? {
                code:
                  groundingResult.blockingIssues > 0
                    ? "blocking-validation-issues"
                    : "no-executable-explicit-options",
                detail:
                  groundingResult.blockingIssues > 0
                    ? `Grounding reported ${groundingResult.blockingIssues} blocking issue(s); solver did not run.`
                    : "No executable grounded actions were available for solver input.",
              }
            : undefined),
        validatedActions: groundingResult.validatedActionIds.length,
        validatedDecisionPoints: groundingResult.validatedDecisionPointIds.length,
        issues: groundingResult.issues.length,
      }
    : buildTraceRuntimeStatus({
        intelStatus,
        intelError,
        llmLabel: llmStatus.label,
        endpoint:
          llmConfig.provider === "ollama"
            ? llmConfig.ollamaBaseUrl
            : llmConfig.openaiEndpoint,
        solverRan: candidates.length > 0 || coaStatus === "ready",
      });

  const acknowledgeReportItem = (id: string) => {
    setAckedReportIds((current) =>
      current.includes(id) ? current : [...current, id]
    );
  };
  const acknowledgeAllAlerts = () => {
    const alertIds = reportWindowItems
      .filter((item) => item.severity === "alert")
      .map((item) => item.id);
    if (alertIds.length === 0) return;
    setAckedReportIds((current) =>
      Array.from(new Set([...current, ...alertIds]))
    );
  };

  return (
    <OpsWindowsProvider>
    <div className={styles.root}>
      <OpsHeader
        activeView={activeView}
        setActiveView={setActiveView}
        threatLevel={threatLevel}
        confidenceLevel={confidenceLevel}
        phase={phase}
        summaryTime={summaryTime}
        environmentLabel={environmentLabel}
        onRestartScenario={requestRestartScenario}
        onExportTrace={() => setActiveView("trace")}
      />

      <EnvironmentBanner
        usingScenarioData={prioritizedFacts.length === 0}
        groundedFactCount={prioritizedFacts.length}
        blockingIssueCount={blockingIssues.length}
        reviewIssueCount={reviewIssueDetails.length}
        lastUpdated={summaryTime}
      />

      {runtimeStatus.status === "LLM_UNAVAILABLE" && (
        <div className={styles.blockedBanner}>
          <div className={styles.blockedBannerRow}>
            <span>
              Pipeline blocked before validation: local LLM endpoint unreachable. No COAs,
              actions, or decision options were generated.
            </span>
            <button
              type="button"
              className={styles.fixStepsButton}
              onClick={() => setShowFixSteps((s) => !s)}
            >
              {showFixSteps ? "Hide fix steps" : "Fix steps"}
            </button>
          </div>
          {"connectionIssueType" in runtimeStatus &&
            "recommendedNextCheck" in runtimeStatus && (
              <div className={styles.blockedHint}>
                Likely cause: <strong>{String(runtimeStatus.connectionIssueType)}</strong>.{" "}
                Next check: {String(runtimeStatus.recommendedNextCheck)}
              </div>
            )}
          {showFixSteps && <FixStepsPanel />}
        </div>
      )}
      {runtimeStatus.status === "VALIDATED_PARTIAL" && (
        <div className={styles.partialBanner}>
          {rejectedDecisionOptionCount > 0 && degradedGroundingCount > 0
            ? `Pipeline completed with validation issues. ${rejectedDecisionOptionCount} decision option${rejectedDecisionOptionCount === 1 ? "" : "s"} rejected by grounding checks; ${degradedGroundingCount} option${degradedGroundingCount === 1 ? "" : "s"} use inherited citations and require review.`
            : rejectedDecisionOptionCount > 0
              ? `Pipeline completed with validation issues. ${rejectedDecisionOptionCount} decision option${rejectedDecisionOptionCount === 1 ? "" : "s"} rejected by grounding checks.`
              : degradedGroundingCount > 0
                ? `Pipeline completed with review flags. No decision options were rejected, but ${degradedGroundingCount} option${degradedGroundingCount === 1 ? "" : "s"} use inherited citations and require review.`
                : "Pipeline completed with validation issues. Review grounding report before execution."}
        </div>
      )}
      {"solverBlockedReason" in runtimeStatus &&
        runtimeStatus.solverBlockedReason && (
          <div className={styles.partialBanner}>
            Solver blocked: {runtimeStatus.solverBlockedReason.code}.{" "}
            {runtimeStatus.solverBlockedReason.detail}
          </div>
        )}

      <main
        className={
          activeView === "overview"
            ? `${styles.main} ${styles.mainOverview}`
            : `${styles.main} ${styles.mainScroll}`
        }
      >
        {activeView === "overview" && (
          <OpsWorkspace
            activeView={activeView}
            setActiveView={setActiveView}
            phase={phase}
            summaryTime={summaryTime}
            environmentLabel={environmentLabel}
            summaryText={summaryText}
            mapFacts={mapFacts}
            overviewTracks={overviewTracks}
            scenePickTracks={scenePickTracks}
            selectedOverviewTrack={selectedOverviewTrack}
            setSelectedOverviewTrackId={setSelectedOverviewTrackId}
            reportWindowItems={reportWindowItems}
            showOrders={showOrders}
            topActions={validatedActions}
            candidates={candidates}
            selectedCoaId={selectedCoa?.id}
            onSelectCoa={selectCoa}
            onRunCoaEvaluation={() => void handleFullRun()}
            onCreateOperatorCoa={() => createOperatorDraft()}
            coaRunning={isRunning}
            commanderIntent={packet?.commanderIntent}
            validatedDecisionPoints={validatedDecisionPoints}
            displayedPlan={displayedPlan}
            coaPipelineStatus={coaStatus}
            generationBlockerDetail={
              "solverBlockedReason" in runtimeStatus && runtimeStatus.solverBlockedReason
                ? runtimeStatus.solverBlockedReason.detail
                : undefined
            }
            generationError={coaError ?? intelError}
            knownAssets={packet?.knownAssets}
            usingScenarioData={prioritizedFacts.length === 0}
          />
        )}

        {activeView !== "overview" ? (
          <Suspense fallback={<div className={styles.viewLoading}>Loading view…</div>}>
            <NonOpsViews
          activeView={activeView}
          onRefreshSignals={() => void handleFullRun()}
          onOpenTrace={() => setActiveView("trace")}
          runtimeStatus={runtimeStatus}
          groundingResult={groundingResult}
          topBlockingIssueDetails={topBlockingIssueDetails}
          topReviewIssueDetails={topReviewIssueDetails}
          hiddenBlockingIssueCount={hiddenBlockingIssueCount}
          hiddenReviewIssueCount={hiddenReviewIssueCount}
          blockingIssueDetails={blockingIssueDetails}
          reviewIssueDetails={reviewIssueDetails}
          facts={facts}
          packet={packet}
          interpretation={interpretation}
          validatedActions={validatedActions}
          coaError={coaError}
          candidates={candidates}
          selectedCoa={selectedCoa}
          onSelectCoa={selectCoa}
          displayedPlan={displayedPlan}
          importInputRef={importInputRef}
          onImportDbFile={handleImportDbFile}
          coaStatus={coaStatus}
          llmLabel={llmStatus.label}
          validatedDecisionPoints={validatedDecisionPoints}
          snapshotMeta={snapshotMeta}
          storageBytes={storageBytes}
          formatBytes={formatBytes}
          describeSnapshotKey={describeSnapshotKey}
          formatTimestamp={formatTimestamp}
          onExportDb={handleExportDb}
          onImportDbClick={handleImportDbClick}
          onResetStoredState={handleResetStoredState}
          persistenceError={persistenceError}
          interpreterPrompt={interpreterPrompt}
          rawModelText={rawModelText}
          interpretationActionIds={interpretationActionIds}
          droppedActionIds={droppedActionIds}
          interpretationOptionKeys={interpretationOptionKeys}
          droppedUnsupportedOptionKeys={droppedUnsupportedOptionKeys}
          filteredOutForSolverOptionKeys={filteredOutForSolverOptionKeys}
          solverEligibleOptionKeys={solverEligibleOptionKeys}
          solverPayload={solverPayload}
          commanderIntent={packet?.commanderIntent}
          coaRunMetadata={runMetadata}
          onRunLabCoaValidation={(options) => void handleLabCoaValidation(options)}
            />
          </Suspense>
        ) : null}
      </main>

      {restartConfirmOpen ? (
        <RestartConfirmDialog
          onConfirm={handleRestartScenario}
          onCancel={() => setRestartConfirmOpen(false)}
        />
      ) : null}
    </div>
    </OpsWindowsProvider>
  );
}

function buildSolverPayload(
  validatedActions: ReturnType<typeof useValidatedActions>,
  validatedDecisionPoints: ReturnType<typeof useValidatedDecisionPoints>,
  packet: ReturnType<typeof useScenarioPacket>
) {
  const validatedDecisionOptions = validatedDecisionPoints.flatMap((dp) =>
    dp.options.map((option) => ({
      decisionPointId: dp.id,
      optionId: option.id,
      label: option.label,
      actionType: option.actionType,
      status: option.status ?? "unknown",
      requiredAssets: option.requiredAssets,
      requiredAuthority: option.requiredAuthority,
      citedFacts: option.citedFacts,
      confidence: option.confidence,
    }))
  );

  const optionActions = validatedDecisionPoints.flatMap((dp) =>
    dp.options
      .filter((option) => option.status === "executable")
      .filter((option) => option.grounding === "explicit" || option.grounding === "inherited")
      .map((option) => ({
        id: `${dp.id}:${option.id}`,
        description: option.label,
        citedFacts: option.citedFacts,
        actionType: option.actionType,
        requiredAssets: option.requiredAssets,
        timeSensitivity: "time-bound" as const,
        confidence: option.confidence,
      }))
  );

  return {
    validatedActions: validatedActions.map((a) => ({
      id: a.id,
      description: a.description,
      actionType: a.actionType ?? "other",
      requiredAssets: a.requiredAssets ?? [],
      requiredAuthority: a.requiredAuthority ?? [],
      citedFacts: a.citedFacts,
      confidence: a.confidence ?? "medium",
    })),
    validatedDecisionOptions,
    intelActions: [...validatedActions, ...optionActions].filter(
      (action) =>
        Array.isArray(action.citedFacts) &&
        action.citedFacts.some((id) => typeof id === "string" && id.trim() !== "")
    ),
    constraints: packet?.constraints ?? [],
    assets: packet?.knownAssets ?? [],
    authorities: packet?.knownAuthorities ?? {},
  };
}

function buildTraceRuntimeStatus({
  intelStatus,
  intelError,
  llmLabel,
  endpoint,
  solverRan,
}: {
  intelStatus: ReturnType<typeof useIntelStatus>;
  intelError: string | undefined;
  llmLabel: string;
  endpoint: string;
  solverRan: boolean;
}) {
  const llmUnavailable =
    typeof intelError === "string" &&
    (/cannot reach ollama/i.test(intelError) || /failed to fetch/i.test(intelError));

  if (llmUnavailable) {
    const diagnosis = diagnoseLlmUnreachable({
      reason: intelError ?? "",
      endpoint,
    });
    return {
      status: "LLM_UNAVAILABLE",
      stage: "model_call",
      model: llmLabel,
      endpoint,
      reason: intelError,
      connectionIssueType: diagnosis.issueType,
      recommendedNextCheck: diagnosis.nextCheck,
      validationRan: false,
      solverRan: false,
      safeToExecute: false,
    };
  }

  return {
    status: "Pipeline has not run validation",
    stage: intelStatus,
    model: llmLabel,
    endpoint,
    reason: intelError ?? "No validation result available yet.",
    validationRan: false,
    solverRan,
    safeToExecute: false,
  };
}

function diagnoseLlmUnreachable({
  reason,
  endpoint,
}: {
  reason: string;
  endpoint: string;
}): {
  issueType:
    | "connection_refused"
    | "cors_or_network_blocked"
    | "dns_or_host_mismatch"
    | "unknown_unreachable";
  nextCheck: string;
} {
  const lower = reason.toLowerCase();
  const endpointHost = safeHost(endpoint);

  if (
    lower.includes("econnrefused") ||
    lower.includes("connection refused") ||
    lower.includes("refused")
  ) {
    return {
      issueType: "connection_refused",
      nextCheck: `Run 'ollama serve' and verify curl ${endpoint.replace(/\/$/, "")}/api/tags`,
    };
  }

  if (
    lower.includes("name not resolved") ||
    lower.includes("enotfound") ||
    lower.includes("dns") ||
    lower.includes("host not found")
  ) {
    return {
      issueType: "dns_or_host_mismatch",
      nextCheck:
        endpointHost === "localhost"
          ? "If app runs in container, switch to host.docker.internal:11434"
          : "Verify endpoint host is reachable from runtime environment",
    };
  }

  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return {
      issueType: "cors_or_network_blocked",
      nextCheck:
        "Test browser fetch to /api/tags; if curl works but fetch fails, set OLLAMA_ORIGINS for app origin",
    };
  }

  return {
    issueType: "unknown_unreachable",
    nextCheck: "Verify Ollama serve, endpoint URL, and browser fetch to /api/tags",
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function formatTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "--";
  return new Date(value).toLocaleString();
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function describeSnapshotKey(key: string): string {
  if (key === "intel_state") {
    return "Intel pipeline state: facts, interpretation, grounding, and trace artifacts.";
  }
  if (key === "coa_state") {
    return "COA pipeline state: ranked COAs, solver/logistics outputs, and selection.";
  }
  return "Custom snapshot key.";
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toISOString().slice(11, 19);
}

function inferOverviewLifecycle(track: OverviewTrack): "new" | "tracking" | "lost" {
  if (track.stalenessState === "stale") return "lost";
  if (track.classification === "unknown-air") return "new";
  return "tracking";
}

function buildShowOrders({
  topActions,
  selectedTrack,
  displayedPlan,
}: {
  topActions: ReturnType<typeof useValidatedActions>;
  selectedTrack: OverviewTrack | undefined;
  displayedPlan: LogisticsPlan | { kind: "empty"; reason: string };
}): ShowOrderItem[] {
  const selectedTrackOrder: ShowOrderItem | null = selectedTrack
    ? {
        id: `order-track-${selectedTrack.id}`,
        factId: selectedTrack.id,
        order: `Maintain ${selectedTrack.callsign} track quality (${selectedTrack.stalenessState}).`,
        status: selectedTrack.stalenessState === "stale" ? "hold" : "active",
        eta: selectedTrack.stalenessState === "stale" ? "Reacquire" : "<2m",
      }
    : null;

  const actionOrders = topActions.slice(0, 3).map((action, index) => ({
    id: `order-action-${action.id}`,
    factId: action.citedFacts[0],
    order: action.description,
    status: (index === 0 ? "active" : "queued") as ShowOrderItem["status"],
    eta: index === 0 ? "Executing" : "Queued",
  }));

  const logisticsOrders: ShowOrderItem[] =
    displayedPlan.kind === "populated"
      ? displayedPlan.chips.slice(0, 4).map((chip) => {
          const status: ShowOrderItem["status"] =
            chip.startOffset === 0 ? "active" : "queued";
          return {
            id: `order-log-${chip.id}`,
            factId: chip.linkedFactIds?.[0],
            order: chip.sceneSummary
              ? `${chip.label} — ${chip.sceneSummary}`
              : chip.label,
            status,
            eta:
              status === "active"
                ? `H+${Math.ceil(chip.startOffset / 60)}`
                : `H+${Math.ceil(chip.startOffset / 60)}`,
          };
        })
      : [];

  return [
    ...(selectedTrackOrder ? [selectedTrackOrder] : []),
    ...actionOrders,
    ...logisticsOrders,
  ].slice(0, 8);
}

function buildMessageTraffic(
  facts: ObservedFact[],
  topActions: ReturnType<typeof useValidatedActions>,
  validationIssueCount: number
): MessageTrafficItem[] {
  const factMessages = facts.slice(0, 8).map((fact) => ({
    id: `fact-${fact.id}`,
    time: fact.time,
    kind: "track" as const,
    channel: "contact" as const,
    severity:
      fact.severity === "critical"
        ? ("alert" as const)
        : fact.severity === "high"
          ? ("warn" as const)
          : ("info" as const),
    text: `${fact.domain} · ${fact.event}`,
    factId: fact.id,
  }));
  const actionMessages = topActions.slice(0, 2).map((action) => ({
    id: `action-${action.id}`,
    time: "OPS",
    kind: "ops" as const,
    channel: "orders" as const,
    severity: action.confidence === "high" ? ("warn" as const) : ("info" as const),
    text: action.description,
    factId: action.citedFacts?.[0],
  }));
  const validationMessage =
    validationIssueCount > 0
      ? [
          {
            id: "validation-issues",
            time: "VALIDATION",
            kind: "validation" as const,
            channel: "validation" as const,
            severity: validationIssueCount >= 3 ? ("alert" as const) : ("warn" as const),
            text: `Grounding flagged ${validationIssueCount} issue(s).`,
          },
        ]
      : [];
  return [...validationMessage, ...actionMessages, ...factMessages].slice(0, 10);
}

function confidenceFromFact(fact: ObservedFact): number {
  return fact.confidence === "high" ? 0.84 : fact.confidence === "medium" ? 0.62 : 0.41;
}

function sceneContactLabel(fact: ObservedFact): string {
  const domainTag =
    fact.domain === "UAS"
      ? "UAS"
      : fact.domain.length <= 4
        ? fact.domain.toUpperCase()
        : fact.domain.slice(0, 4).toUpperCase();
  const place = (fact.location ?? fact.entity).split(",")[0]?.trim() ?? fact.entity;
  const short = place.length > 18 ? `${place.slice(0, 17)}…` : place;
  return `${domainTag} · ${short}`;
}

/** One overview track per fact in sensor coverage — matches active map markers. */
function buildSceneContacts(
  facts: ObservedFact[],
  factIndexOffset = 0,
  options?: { includeAllFacts?: boolean }
): OverviewTrack[] {
  const sensors = collectSensorFootprints(facts);
  const activeFacts = options?.includeAllFacts
    ? facts
    : filterFactsInSensorRange(facts, sensors);

  return activeFacts.map((fact, index) => {
    const mapIndex = factIndexOffset + index;
    const [lng, lat] = factToLngLat(fact, mapIndex);
    const kinematics = contactKinematics(fact.id);
    const confidence = confidenceFromFact(fact);
    const stalenessMinutes = inferTrackStalenessMinutes(fact.time, index);
    const stalenessState: OverviewTrack["stalenessState"] =
      stalenessMinutes <= 6 ? "fresh" : stalenessMinutes <= 18 ? "warm" : "stale";
    const classification: OverviewTrack["classification"] =
      fact.domain === "UAS"
        ? "uas"
        : /signals|cyber/i.test(fact.domain)
          ? "signal-source"
          : "unknown-air";
    const side: OverviewTrack["side"] = isSensorEntityFact(fact)
      ? "friendly"
      : fact.domain === "UAS" && (fact.severity === "high" || fact.severity === "critical")
        ? "hostile"
        : fact.severity === "high" || fact.severity === "critical"
          ? "hostile"
          : "unknown";

    return {
      id: fact.id,
      callsign: sceneContactLabel(fact),
      side,
      classification,
      confidence,
      uncertaintyMeters: Math.round((1 - confidence) * 220 + stalenessMinutes * 2),
      stalenessMinutes,
      stalenessState,
      detectedBy: fact.source,
      lastUpdate: fact.time,
      summary: fact.event,
      history: [
        {
          time: fact.time,
          label: fact.event,
          confidence,
        },
      ],
      coordinates: { lat, lng },
      moving: kinematics.moving,
      headingDeg: kinematics.headingDeg,
      speedKts: kinematics.speedKts,
      inSensorRange: true,
    };
  });
}

function inferTrackStalenessMinutes(time: string, index: number): number {
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (!match) return Math.max(1, index * 4 + 2);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return Math.max(1, index * 4 + 2);
  }
  const now = new Date();
  const candidate = new Date(now);
  candidate.setHours(hour, minute, 0, 0);
  const diff = Math.round((now.getTime() - candidate.getTime()) / 60000);
  if (!Number.isFinite(diff)) return Math.max(1, index * 4 + 2);
  if (diff < 0) return Math.max(1, index * 3 + 1);
  return diff;
}

function severityWeight(severity: "low" | "medium" | "high" | "critical"): number {
  if (severity === "critical") return 4;
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function FixStepsPanel() {
  const steps = [
    "ollama serve",
    "curl http://localhost:11434/api/tags",
    "ollama list",
    "ollama pull llama3.2",
  ] as const;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // no-op: clipboard may be blocked by browser policy
    }
  };

  return (
    <div className={styles.fixStepsPanel}>
      {steps.map((cmd) => (
        <div key={cmd} className={styles.fixStepRow}>
          <code className={styles.fixStepCmd}>{cmd}</code>
          <button
            type="button"
            className={styles.fixCopyButton}
            onClick={() => void copy(cmd)}
          >
            Copy
          </button>
        </div>
      ))}
      <div className={styles.fixHint}>
        If running inside Docker, use `http://host.docker.internal:11434` for Ollama base URL.
      </div>
    </div>
  );
}
