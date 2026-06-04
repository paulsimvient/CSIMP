import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  executionStatusMessage,
  getExecuteBlockers,
  useExecuteCoaRevision,
  useExecutedSnapshot,
  useMatrixOverlay,
  usePreparedExecution,
  useUpdateMatrixOverlay,
  useValidateOperatorCoa,
  useDiscardOperatorCoa,
  useRebaseOperatorCoa,
  useMergeOperatorIntoParent,
  useCreateImportedOperatorDraft,
  useCreateOperatorDraft,
  useForkOperatorModified,
} from "@coa/store";
import { useCoaStore } from "@coa/store";
import type { DecisionPoint } from "../../intel/types";
import type { useDisplayedPlan } from "@coa/store";
import type { ObservedFact } from "../../intel/types";
import type { CoaCandidate } from "../../coa/types";
import {
  buildExecutionInteractionMap,
  mergeFeatureCollections,
} from "../../scene/executionInteractionMap";
import type { MessageTrafficItem, OverviewTrack, ShowOrderItem } from "./types";
import { useExecutionPlayback } from "./useExecutionPlayback";
import { ExecutionFeedbackBanner } from "./ExecutionFeedbackBanner";
import { MapLogisticsStack } from "./MapLogisticsStack";
import {
  WorkflowStepper,
  deriveWorkflowStepState,
  type WorkflowStepId,
} from "./WorkflowStepper";
import { MatrixTaskPanel } from "./MatrixTaskPanel";
import { InspectorPanel } from "./InspectorPanel";
import { RightSideDock, type RightSidePanel } from "./RightSideDock";
import { ScenePickProvider, useScenePick } from "./ScenePickContext";
import { TaskComposerProvider, useTaskComposer } from "./TaskComposerContext";
import { TaskComposerLifecycle } from "./TaskComposerLifecycle";
import { ResizableLayout } from "./ResizableLayout";
import { buildLogisticsPlan } from "../../coa/logistics";
import { collectRevisionBlockers } from "../../coa/materializeCoaRevision";
import {
  applyManualEntryPatch,
  validateManualEntry,
  type ManualSyncEntry,
  type ManualSyncTarget,
  type MatrixComposerDraft,
} from "../../coa/manualSync";
import type { SyncMatrixBar } from "../../coa/syncMatrix";
import {
  buildManualOnlySyncMatrix,
  buildSyncMatrixModel,
  formatMatrixTick,
} from "../../coa/syncMatrix";
import { type SyncGridRowKey } from "../../coa/syncGridSchema";
import type { BarPatch } from "@components/SyncMatrix";
import { DecisionFlowPanel } from "./DecisionFlowPanel";
import { EventTimeline, resolveTimelineFactId } from "./EventTimeline";
import { OperationalMapPanel } from "./OperationalMapPanel";
import type { ActiveView } from "./activeView";
import styles from "../../App.module.css";

export { OpsHeader } from "./OpsHeader";
export type { ActiveView } from "./activeView";

type OpsWorkspaceProps = {
  activeView: "overview";
  setActiveView: (view: ActiveView) => void;
  phase: string;
  summaryTime: string;
  environmentLabel: string;
  summaryText: string;
  mapFacts: ObservedFact[];
  overviewTracks: OverviewTrack[];
  scenePickTracks: OverviewTrack[];
  selectedOverviewTrack: OverviewTrack | undefined;
  setSelectedOverviewTrackId: (id: string) => void;
  reportWindowItems: MessageTrafficItem[];
  showOrders: ShowOrderItem[];
  topActions: {
    id: string;
    description: string;
    confidence?: string;
    citedFacts?: string[];
    actionType?: string;
    requiredAssets?: string[];
  }[];
  candidates: CoaCandidate[];
  selectedCoaId: string | undefined;
  onSelectCoa: (id: string) => void;
  onRunCoaEvaluation: () => void;
  onCreateOperatorCoa?: () => void;
  coaRunning: boolean;
  commanderIntent?: string;
  validatedDecisionPoints: DecisionPoint[];
  displayedPlan: ReturnType<typeof useDisplayedPlan>;
  coaPipelineStatus: "idle" | "running" | "ready" | "error";
  generationBlockerDetail?: string;
  generationError?: string;
  knownAssets?: string[];
  usingScenarioData?: boolean;
};

const EMPTY_HIGHLIGHT_FACT_IDS: string[] = [];

function MapClickBridge({
  onInspectFact,
  children,
}: {
  onInspectFact: (factId: string) => void;
  children: (onMapFactClick: (factId: string) => void) => ReactNode;
}) {
  const { handleMapFactClick, disarmFieldNow, options } = useScenePick();
  const composer = useTaskComposer();
  const onMapFactClick = useCallback(
    (factId: string) => {
      if (handleMapFactClick(factId)) {
        composer.clearPickMode();
        return;
      }

      if (composer.isPickingFromMap()) {
        const pickResult = composer.handlePassiveMapClick(factId, options);
        if (pickResult === "applied") {
          disarmFieldNow();
          return;
        }
        if (pickResult === "rejected") return;
      }

      onInspectFact(factId);
    },
    [
      handleMapFactClick,
      disarmFieldNow,
      composer.clearPickMode,
      composer.handlePassiveMapClick,
      composer.isPickingFromMap,
      options,
      onInspectFact,
    ]
  );
  return <>{children(onMapFactClick)}</>;
}

export function OpsWorkspace(props: OpsWorkspaceProps) {
  const selectedCoa = props.candidates.find((candidate) => candidate.id === props.selectedCoaId);
  const fallbackCandidate = selectedCoa ?? props.candidates.find((candidate) => candidate.selectedActions.length > 0);
  const executedSnapshot = useExecutedSnapshot();
  const preparedExecution = usePreparedExecution();
  const updateMatrixOverlay = useUpdateMatrixOverlay();
  const validateOperatorCoa = useValidateOperatorCoa();
  const executeCoaRevision = useExecuteCoaRevision();
  const discardOperatorCoa = useDiscardOperatorCoa();
  const rebaseOperatorCoa = useRebaseOperatorCoa();
  const mergeOperatorIntoParent = useMergeOperatorIntoParent();
  const createImportedOperatorDraft = useCreateImportedOperatorDraft();
  const createOperatorDraft = useCreateOperatorDraft();
  const forkOperatorModified = useForkOperatorModified();
  const storeSelectedCoaId = useCoaStore((s) => s.selectedCoaId);
  const overlayCoaId = storeSelectedCoaId ?? props.selectedCoaId;
  const matrixOverlay = useMatrixOverlay(overlayCoaId);
  const manualEntries = matrixOverlay.manualEntries;
  const barPatches = matrixOverlay.barPatches;
  const hiddenBarIds = matrixOverlay.hiddenBarIds;
  const modifiedBarIds = matrixOverlay.modifiedBarIds;
  const [focusFactId, setFocusFactId] = useState<string | undefined>();
  const [focusNonce, setFocusNonce] = useState(0);
  const [liveTrackCoord, setLiveTrackCoord] = useState<[number, number] | null>(null);
  const [composerDraft, setComposerDraft] = useState<MatrixComposerDraft | null>(null);
  const setManualEntries = (
    updater: ManualSyncEntry[] | ((prev: ManualSyncEntry[]) => ManualSyncEntry[])
  ) => {
    let coaId = overlayCoaId;
    if (!coaId) {
      coaId = createOperatorDraft();
    }
    if (!coaId) return;
    updateMatrixOverlay(coaId, (prev) => {
      const current = prev.manualEntries;
      const next = typeof updater === "function" ? updater(current) : updater;
      return { ...prev, manualEntries: next };
    });
  };
  const [authorTarget, setAuthorTarget] = useState<ManualSyncTarget | null>(null);
  const [selectedSyncBar, setSelectedSyncBar] = useState<SyncMatrixBar | null>(null);
  const [composerPreviewFactIds, setComposerPreviewFactIds] = useState<string[]>([]);
  const [actionPreviewGeoJson, setActionPreviewGeoJson] =
    useState<GeoJSON.FeatureCollection | null>(null);
  const [composerResetNonce, setComposerResetNonce] = useState(0);
  const [pendingComposerBar, setPendingComposerBar] = useState<SyncMatrixBar | null>(null);
  const [inspectedFactId, setInspectedFactId] = useState<string | undefined>();
  const [rightSidePanel, setRightSidePanel] = useState<RightSidePanel>("workflow");
  const feasibleCoas = props.candidates.filter((candidate) => candidate.status === "sat");
  const logisticsReady = props.displayedPlan.kind === "populated";
  const materializeContext = useMemo(
    () => ({
      intelActions: props.topActions.map((action) => ({
        id: action.id,
        description: action.description,
        citedFacts: action.citedFacts ?? [],
        actionType: action.actionType,
        requiredAssets: action.requiredAssets,
      })),
      observedFacts: props.mapFacts,
      coaLabel: selectedCoa?.label,
    }),
    [props.topActions, props.mapFacts, selectedCoa?.label]
  );
  const executeBlockers = useMemo(
    () =>
      getExecuteBlockers({
        candidate: selectedCoa,
        overlay: matrixOverlay,
        preparedExecution,
        coaRunning: props.coaRunning,
        logisticsReady,
        materializeContext,
      }),
    [
      selectedCoa,
      matrixOverlay,
      preparedExecution,
      props.coaRunning,
      logisticsReady,
      materializeContext,
    ]
  );
  const blockingExecute = executeBlockers.filter(
    (reason) => !reason.includes("Prepare execution")
  );
  const canClickExecute = Boolean(
    selectedCoa && blockingExecute.length === 0 && !props.coaRunning
  );
  const [matrixValidationFeedback, setMatrixValidationFeedback] = useState<{
    kind: "success" | "error";
    messages: string[];
  } | null>(null);
  const [operatorValidationFeedback, setOperatorValidationFeedback] = useState<{
    kind: "success" | "error";
    messages: string[];
  } | null>(null);
  const matrixExecuteBlocker = blockingExecute[0];

  const handleMatrixValidate = useCallback(() => {
    if (!selectedCoa) {
      setMatrixValidationFeedback({
        kind: "error",
        messages: ["Select a COA in Step 03 before validating the matrix."],
      });
      return;
    }
    const taskBlockers = collectRevisionBlockers(
      selectedCoa,
      matrixOverlay,
      materializeContext
    );
    if (taskBlockers.length > 0) {
      setMatrixValidationFeedback({
        kind: "error",
        messages: taskBlockers,
      });
      return;
    }
    if (matrixExecuteBlocker) {
      setMatrixValidationFeedback({
        kind: "success",
        messages: [
          "Matrix tasks look good.",
          `Execute is still blocked: ${matrixExecuteBlocker}`,
        ],
      });
      return;
    }
    setMatrixValidationFeedback({
      kind: "success",
      messages: [
        preparedExecution
          ? "Matrix is ready — use Execute (next to Validate) to commit."
          : "Matrix is ready — use Execute (next to Validate) to prepare and commit.",
      ],
    });
  }, [
    selectedCoa,
    matrixOverlay,
    materializeContext,
    matrixExecuteBlocker,
    preparedExecution,
  ]);

  const handleValidateOperator = useCallback(async () => {
    if (!props.selectedCoaId) {
      setOperatorValidationFeedback({
        kind: "error",
        messages: ["No COA selected. Choose an operator draft in Step 03."],
      });
      setRightSidePanel("workflow");
      return;
    }
    setOperatorValidationFeedback(null);
    setRightSidePanel("workflow");
    const result = await validateOperatorCoa(props.selectedCoaId, materializeContext);
    if (result.ok) {
      setOperatorValidationFeedback({
        kind: "success",
        messages: ["Operator COA validated. Execute is available when the matrix has no blockers."],
      });
      return;
    }
    setOperatorValidationFeedback({
      kind: "error",
      messages: result.blockers,
    });
  }, [props.selectedCoaId, validateOperatorCoa, materializeContext]);
  useEffect(() => {
    setMatrixValidationFeedback(null);
    setOperatorValidationFeedback(null);
  }, [props.selectedCoaId, matrixOverlay.revisionId]);
  const executionMessage = executionStatusMessage(executedSnapshot, selectedCoa);
  const recommendation =
    "Generate COAs from the event, then select a feasible response to load its complete order set.";
  const generationProgress = props.coaRunning
    ? 62
    : props.coaPipelineStatus === "error"
      ? 100
      : props.candidates.length > 0 || props.coaPipelineStatus === "ready"
        ? 100
        : 0;
  const generationStatusLabel = props.coaRunning
    ? "Generating COAs..."
    : props.coaPipelineStatus === "error"
      ? "Generation failed"
      : generationProgress === 100
        ? "COAs ready"
        : "Idle";
  const logisticsEmptyContext = useMemo(
    () => ({
      pipelineStatus: props.coaPipelineStatus,
      selectedCoaLabel: selectedCoa?.label,
      selectedCoaStatus: selectedCoa?.status,
      satCount: feasibleCoas.length,
      blockedDetail: props.generationBlockerDetail,
      generationError: props.generationError,
    }),
    [
      props.coaPipelineStatus,
      selectedCoa?.label,
      selectedCoa?.status,
      feasibleCoas.length,
      props.generationBlockerDetail,
      props.generationError,
    ]
  );

  const syncDecisionPoints = useMemo(
    () =>
      props.validatedDecisionPoints.map((dp) => ({
        id: dp.id,
        question: dp.question,
        triggerFacts: dp.triggerFacts,
      })),
    [props.validatedDecisionPoints]
  );
  const intelActionContext = useMemo(
    () =>
      props.topActions.map((action) => ({
        id: action.id,
        description: action.description,
        citedFacts: action.citedFacts ?? [],
        actionType: action.actionType,
        requiredAssets: action.requiredAssets,
      })),
    [props.topActions]
  );

  const provisionalPlan = useMemo(() => {
    if (props.displayedPlan.kind === "populated") return null;
    if (!fallbackCandidate || fallbackCandidate.selectedActions.length === 0) return null;
    return buildLogisticsPlan({
      coaId: fallbackCandidate.id,
      actions: fallbackCandidate.selectedActions,
      source: "validated-intel",
      intelActions: intelActionContext,
      observedFacts: props.mapFacts,
    });
  }, [
    props.displayedPlan.kind,
    fallbackCandidate,
    intelActionContext,
    props.mapFacts,
  ]);
  const matrixPlan = props.displayedPlan.kind === "populated" ? props.displayedPlan : provisionalPlan ?? props.displayedPlan;
  const isProvisionalMatrix = props.displayedPlan.kind !== "populated" && matrixPlan.kind === "populated";

  const visibleMatrixBars = useMemo((): SyncMatrixBar[] => {
    const baseInput = {
      qualityContext: logisticsEmptyContext,
      provisional: isProvisionalMatrix,
      manualEntries,
      modifiedBarIds,
      barPatches,
      hiddenBarIds,
      commanderIntent: props.commanderIntent,
      decisionPoints: syncDecisionPoints,
      observedFacts: props.mapFacts,
      coaLabel: selectedCoa?.label,
    };
    const model =
      matrixPlan.kind === "populated"
        ? buildSyncMatrixModel({ plan: matrixPlan, ...baseInput })
        : manualEntries.length > 0
          ? buildManualOnlySyncMatrix(manualEntries, baseInput)
          : null;
    if (!model) return [];
    return model.rows.flatMap((row) => row.bars).filter((bar) => !bar.isManual);
  }, [
    logisticsEmptyContext,
    isProvisionalMatrix,
    manualEntries,
    modifiedBarIds,
    barPatches,
    hiddenBarIds,
    props.commanderIntent,
    syncDecisionPoints,
    props.mapFacts,
    selectedCoa?.label,
    matrixPlan,
  ]);

  const syncMatrixModel = useMemo(() => {
    const baseInput = {
      qualityContext: logisticsEmptyContext,
      provisional: isProvisionalMatrix,
      manualEntries,
      modifiedBarIds,
      barPatches,
      hiddenBarIds,
      commanderIntent: props.commanderIntent,
      decisionPoints: syncDecisionPoints,
      observedFacts: props.mapFacts,
      coaLabel: selectedCoa?.label,
    };
    if (matrixPlan.kind === "populated") {
      return buildSyncMatrixModel({ plan: matrixPlan, ...baseInput });
    }
    if (manualEntries.length > 0) {
      return buildManualOnlySyncMatrix(manualEntries, baseInput);
    }
    return null;
  }, [
    logisticsEmptyContext,
    isProvisionalMatrix,
    manualEntries,
    modifiedBarIds,
    barPatches,
    hiddenBarIds,
    props.commanderIntent,
    syncDecisionPoints,
    props.mapFacts,
    selectedCoa?.label,
    matrixPlan,
  ]);
  const syncTickIntervalSec = syncMatrixModel?.tickIntervalSec ?? 900;
  const syncHorizonSec = syncMatrixModel?.horizonSec ?? 24 * 3600;
  const { executionEvents, activeExecutionTaskIds, isPlaying, playbackStatus } =
    useExecutionPlayback(executedSnapshot);
  const workflowStepState = useMemo(
    () =>
      deriveWorkflowStepState({
        hasEventContext:
          Boolean(props.summaryText) &&
          props.summaryText !== "Run pipeline to load scenario facts and recommendations.",
        coaRunning: props.coaRunning,
        candidateCount: props.candidates.length,
        selectedCoaId: props.selectedCoaId,
        logisticsReady,
        canExecute: canClickExecute,
        isExecuting: Boolean(executionMessage) || isPlaying,
      }),
    [
      props.summaryText,
      props.coaRunning,
      props.candidates.length,
      props.selectedCoaId,
      logisticsReady,
      canClickExecute,
      executionMessage,
      isPlaying,
    ]
  );
  const matrixSectionRef = useRef<HTMLDivElement>(null);
  const handleWorkflowStepSelect = useCallback((step: WorkflowStepId) => {
    if (step === "matrix") {
      matrixSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    setRightSidePanel("workflow");
    window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-workflow-step="${step}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, []);
  const executionCompletedBarIds = useMemo(() => {
    if (!executedSnapshot || isPlaying) return undefined;
    return new Set(executedSnapshot.orderSet.tasks.map((task) => task.id));
  }, [executedSnapshot, isPlaying]);
  const [executeError, setExecuteError] = useState<string | null>(null);

  const handleExecuteCoa = useCallback(() => {
    if (!props.selectedCoaId) return;
    setExecuteError(null);
    const result = executeCoaRevision(props.selectedCoaId, materializeContext);
    if (!result.ok) {
      setExecuteError(
        result.blockers[0] ??
          "Execute did not commit — validate the COA, prepare execution, and try again."
      );
      return;
    }
    setRightSidePanel("workflow");
  }, [props.selectedCoaId, materializeContext, executeCoaRevision]);
  const timelineItems = useMemo(
    () => [...executionEvents, ...props.reportWindowItems],
    [executionEvents, props.reportWindowItems]
  );
  const executionBars = useMemo(
    () => syncMatrixModel?.rows.flatMap((row) => row.bars) ?? [],
    [syncMatrixModel]
  );
  const shouldRenderTaskLinks = Boolean(
    executedSnapshot ||
      (selectedCoa?.validationStatus === "validated" &&
        selectedCoa.status === "sat" &&
        executionBars.length > 0)
  );
  const executionInteractionGeoJson = useMemo(() => {
    if (!shouldRenderTaskLinks || executionBars.length === 0) return null;
    return buildExecutionInteractionMap({
      bars: executionBars,
      facts: props.mapFacts,
      tracks: props.overviewTracks,
      manualEntries,
      activeBarIds:
        executedSnapshot && isPlaying && activeExecutionTaskIds.size > 0
          ? activeExecutionTaskIds
          : undefined,
    });
  }, [
    shouldRenderTaskLinks,
    executedSnapshot,
    executionBars,
    props.mapFacts,
    props.overviewTracks,
    manualEntries,
    isPlaying,
    activeExecutionTaskIds,
  ]);
  const mapActionPreview = useMemo(
    () => mergeFeatureCollections(executionInteractionGeoJson, actionPreviewGeoJson),
    [executionInteractionGeoJson, actionPreviewGeoJson]
  );

  useEffect(() => {
    setSelectedSyncBar(null);
    setComposerDraft(null);
    setInspectedFactId(undefined);
  }, [props.selectedCoaId]);

  useEffect(() => {
    setLiveTrackCoord(null);
  }, [props.selectedOverviewTrack?.id]);

  const displayedSelectedTrack = useMemo(() => {
    if (!props.selectedOverviewTrack) return undefined;
    if (!liveTrackCoord) return props.selectedOverviewTrack;
    return {
      ...props.selectedOverviewTrack,
      coordinates: { lat: liveTrackCoord[1], lng: liveTrackCoord[0] },
    };
  }, [props.selectedOverviewTrack, liveTrackCoord]);
  const highlightedFactIds = useMemo(() => {
    const ids = new Set<string>();
    if (focusFactId) ids.add(focusFactId);
    if (authorTarget?.factId) ids.add(authorTarget.factId);
    selectedSyncBar?.targetFactIds?.forEach((id) => ids.add(id));
    composerPreviewFactIds.forEach((id) => ids.add(id));
    manualEntries
      .filter((entry) => entry.targetFactId && focusFactId === entry.targetFactId)
      .forEach((entry) => entry.targetFactId && ids.add(entry.targetFactId));
    if (shouldRenderTaskLinks && executionBars.length > 0) {
      const activeBars =
        activeExecutionTaskIds.size > 0
          ? executionBars.filter((bar) => activeExecutionTaskIds.has(bar.id))
          : executionBars;
      for (const bar of activeBars) {
        bar.targetFactIds?.forEach((id) => ids.add(id));
        const entry = manualEntries.find((item) => item.id === bar.id);
        if (entry?.targetFactId) ids.add(entry.targetFactId);
      }
    }
    if (ids.size > 0) return [...ids];
    return props.selectedOverviewTrack?.id
      ? [props.selectedOverviewTrack.id]
      : EMPTY_HIGHLIGHT_FACT_IDS;
  }, [
    focusFactId,
    authorTarget?.factId,
    selectedSyncBar,
    composerPreviewFactIds,
    manualEntries,
    props.selectedOverviewTrack?.id,
    shouldRenderTaskLinks,
    executionBars,
    activeExecutionTaskIds,
  ]);

  const highlightTrackOnMap = useCallback(
    (factId: string) => {
      props.setSelectedOverviewTrackId(factId);
      setFocusFactId(factId);
      setFocusNonce((nonce) => nonce + 1);
    },
    [props.setSelectedOverviewTrackId]
  );

  const inspectSceneObject = (factId: string) => {
    highlightTrackOnMap(factId);
    setInspectedFactId(factId);
    setRightSidePanel("inspector");
  };

  const openMatrixComposer = useCallback(() => {
    setSelectedSyncBar(null);
    setPendingComposerBar(null);
    setComposerDraft(null);
    setAuthorTarget(null);
    setComposerPreviewFactIds([]);
    setActionPreviewGeoJson(null);
    setComposerResetNonce((nonce) => nonce + 1);
  }, []);

  const inspectedFact = useMemo(
    () =>
      inspectedFactId
        ? props.mapFacts.find((item) => item.id === inspectedFactId)
        : undefined,
    [inspectedFactId, props.mapFacts]
  );

  const inspectedTrack = useMemo(() => {
    const trackId = inspectedFactId ?? props.selectedOverviewTrack?.id;
    if (!trackId) return undefined;
    return (
      props.overviewTracks.find((track) => track.id === trackId) ??
      (props.selectedOverviewTrack?.id === trackId ? props.selectedOverviewTrack : undefined)
    );
  }, [inspectedFactId, props.overviewTracks, props.selectedOverviewTrack]);

  const sceneSelectionFactId =
    focusFactId ?? props.selectedOverviewTrack?.id ?? inspectedFactId;

  const handleBarPatch = (barId: string, patch: BarPatch) => {
    const coaId = overlayCoaId ?? createOperatorDraft();
    if (!coaId) return;
    updateMatrixOverlay(coaId, (prev) => ({
      ...prev,
      barPatches: { ...prev.barPatches, [barId]: { ...prev.barPatches[barId], ...patch } },
      modifiedBarIds: prev.modifiedBarIds.includes(barId)
        ? prev.modifiedBarIds
        : [...prev.modifiedBarIds, barId],
    }));
  };

  const handleCreateManualAtCell = (rowKey: SyncGridRowKey, startSec: number) => {
    setComposerDraft({ rowKey, startSec });
    setSelectedSyncBar(null);
    setPendingComposerBar(null);
  };

  const handleManualEntryUpdate = (entry: ManualSyncEntry) => {
    const validated = validateManualEntry(entry);
    setManualEntries((prev) =>
      prev.map((item) => (item.id === validated.id ? validated : item))
    );
    if (overlayCoaId) {
      updateMatrixOverlay(overlayCoaId, (prev) => {
        const nextPatches = { ...prev.barPatches };
        delete nextPatches[validated.id];
        return { ...prev, barPatches: nextPatches };
      });
    }
  };

  const handleConfirmManualEntry = (entry: ManualSyncEntry) => {
    const validated = validateManualEntry(entry);
    if (composerDraft?.entryId) {
      setManualEntries((prev) =>
        prev.map((item) => (item.id === composerDraft.entryId ? validated : item))
      );
    } else {
      setManualEntries((prev) => [...prev, validated]);
    }
    setComposerDraft(null);
    setAuthorTarget(null);
  };

  const handleCancelComposer = () => {
    setComposerDraft(null);
    setAuthorTarget(null);
    setSelectedSyncBar(null);
    setPendingComposerBar(null);
    setComposerPreviewFactIds([]);
    setActionPreviewGeoJson(null);
    setComposerResetNonce((nonce) => nonce + 1);
  };

  const closeMatrixEditor = () => {
    setSelectedSyncBar(null);
    setPendingComposerBar(null);
    setComposerPreviewFactIds([]);
    setActionPreviewGeoJson(null);
    setComposerResetNonce((nonce) => nonce + 1);
  };

  const handleEditBarSave = useCallback(
    (patch: {
      actor?: string;
      target?: string;
      targetFactId?: string;
      actionVerb?: string;
      startSec: number;
      durationSec: number;
      status: SyncMatrixBar["status"];
      rowKey: string;
      subLabel?: string;
      dependency?: string;
      dependencyBarId?: string;
      startCondition?: string;
    }) => {
      const bar = selectedSyncBar;
      if (!bar) return;
      if (bar.isManual) {
        const entry = manualEntries.find((item) => item.id === bar.id);
        if (entry) {
          handleManualEntryUpdate(
            validateManualEntry(
              applyManualEntryPatch(entry, {
                actor: patch.actor,
                target: patch.target,
                targetFactId: patch.targetFactId,
                actionVerb: patch.actionVerb,
                startSec: patch.startSec,
                durationSec: patch.durationSec,
                status: patch.status,
                rowKey: patch.rowKey as SyncGridRowKey,
                subLabel: patch.subLabel,
                dependency: patch.dependency,
                dependencyBarId: patch.dependencyBarId,
                startCondition: patch.startCondition,
                timingUnresolved: [],
                endTimeLabel: formatMatrixTick(
                  patch.startSec + patch.durationSec,
                  syncTickIntervalSec
                ),
              })
            )
          );
        }
      } else {
        handleBarPatch(bar.id, {
          actor: patch.actor,
          target: patch.target,
          actionVerb: patch.actionVerb,
          startSec: patch.startSec,
          durationSec: patch.durationSec,
          status: patch.status,
          rowKey: patch.rowKey,
          subLabel: patch.subLabel,
          targetFactIds: patch.targetFactId ? [patch.targetFactId] : [],
        });
      }
      closeMatrixEditor();
    },
    [selectedSyncBar, manualEntries, syncTickIntervalSec]
  );

  const handleEditBarDuplicate = useCallback(() => {
    const bar = selectedSyncBar;
    if (!bar?.isManual) return;
    const entry = manualEntries.find((item) => item.id === bar.id);
    if (!entry) return;
    const patched = barPatches[entry.id];
    setManualEntries((prev) => [
      ...prev,
      validateManualEntry(
        applyManualEntryPatch(
          {
            ...entry,
            id: `manual-${Date.now()}`,
            origin: "user-added",
          },
          {
            startSec: patched?.startSec ?? entry.startSec + entry.durationSec,
            durationSec: patched?.durationSec ?? entry.durationSec,
            rowKey: (patched?.rowKey as SyncGridRowKey | undefined) ?? entry.rowKey,
          }
        )
      ),
    ]);
    closeMatrixEditor();
  }, [selectedSyncBar, manualEntries, barPatches]);

  const handleEditBarDelete = useCallback(() => {
    const bar = selectedSyncBar;
    if (!bar) return;
    if (bar.isManual) {
      setManualEntries((prev) => prev.filter((item) => item.id !== bar.id));
    } else {
      const coaId = overlayCoaId;
      if (!coaId) return;
      updateMatrixOverlay(coaId, (prev) => ({
        ...prev,
        hiddenBarIds: prev.hiddenBarIds.includes(bar.id)
          ? prev.hiddenBarIds
          : [...prev.hiddenBarIds, bar.id],
      }));
    }
    closeMatrixEditor();
  }, [selectedSyncBar, overlayCoaId, updateMatrixOverlay]);

  const handleEditBarMarkContingent = useCallback(() => {
    const bar = selectedSyncBar;
    if (!bar) return;
    if (bar.isManual) {
      const entry = manualEntries.find((item) => item.id === bar.id);
      if (entry) {
        handleManualEntryUpdate(validateManualEntry({ ...entry, status: "contingent" }));
      }
    } else {
      handleBarPatch(bar.id, { status: "contingent" });
    }
    closeMatrixEditor();
  }, [selectedSyncBar, manualEntries]);

  const handleComposerPreviewFactIds = useCallback((ids: string[]) => {
    setComposerPreviewFactIds(ids);
  }, []);

  const handleActionPreviewChange = useCallback(
    (preview: { geojson: GeoJSON.FeatureCollection; statusLabel: string } | null) => {
      setActionPreviewGeoJson(preview?.geojson ?? null);
    },
    []
  );

  const [timelineInstructionSeed, setTimelineInstructionSeed] = useState<string | undefined>();

  const resolveEventTargetFactId = useCallback(
    (event: MessageTrafficItem): string | undefined => {
      if (event.factId) return event.factId;
      const fromTimeline = resolveTimelineFactId(event, props.overviewTracks, props.mapFacts);
      if (fromTimeline) return fromTimeline;
      const actionMatch = event.id.match(/^action-(.+)$/);
      if (actionMatch?.[1]) {
        const action = props.topActions.find((item) => item.id === actionMatch[1]);
        return action?.citedFacts?.[0];
      }
      return undefined;
    },
    [props.overviewTracks, props.mapFacts, props.topActions]
  );

  const handleTimelineEvent = useCallback(
    (event: MessageTrafficItem, factId?: string) => {
      const resolved = factId ?? resolveEventTargetFactId(event);

      if (event.kind === "validation") {
        setRightSidePanel("workflow");
        props.setActiveView("trace");
        return;
      }

      if (resolved) {
        setTimelineInstructionSeed(undefined);
        highlightTrackOnMap(resolved);
        openMatrixComposer();
        return;
      }

      if (event.kind === "ops") {
        setTimelineInstructionSeed(event.text);
        openMatrixComposer();
      }
    },
    [resolveEventTargetFactId, openMatrixComposer, props.setActiveView, highlightTrackOnMap]
  );

  return (
    <TaskComposerProvider
      facts={props.mapFacts}
      onFocusMapFact={highlightTrackOnMap}
      onPreviewFactIdsChange={handleComposerPreviewFactIds}
      onActionPreviewChange={handleActionPreviewChange}
    >
      <TaskComposerLifecycle resetNonce={composerResetNonce} pendingBar={pendingComposerBar} />
    <ScenePickProvider
      facts={props.mapFacts}
      tracks={props.scenePickTracks}
      matrixBars={visibleMatrixBars}
      manualEntries={manualEntries}
      knownAssets={props.knownAssets}
      onFocusMapFact={highlightTrackOnMap}
    >
      <MapClickBridge onInspectFact={inspectSceneObject}>
        {(onMapFactClick) => (
    <div className={styles.decisionFlowPage}>
      <WorkflowStepper
        currentStep={workflowStepState.current}
        completedSteps={workflowStepState.completed}
        onStepSelect={handleWorkflowStepSelect}
      />
      <ResizableLayout
        fillParent
        className={styles.harpoonResizableLayout}
        defaultLeft={300}
        defaultRight={380}
        minLeft={240}
        minRight={280}
        minCenter={420}
        left={
          <aside className={styles.harpoonTaskDock} aria-label="Matrix task panel">
            <MatrixTaskPanel
              key={selectedSyncBar?.id ?? "create"}
              bar={selectedSyncBar ?? undefined}
              target={authorTarget ?? undefined}
              draft={composerDraft ?? undefined}
              sceneSelectionFactId={sceneSelectionFactId}
              instructionSeed={timelineInstructionSeed}
              tickIntervalSec={syncTickIntervalSec}
              horizonSec={syncHorizonSec}
              onConfirm={handleConfirmManualEntry}
              onCancel={selectedSyncBar ? closeMatrixEditor : handleCancelComposer}
              onSaveEdit={selectedSyncBar ? handleEditBarSave : undefined}
              onDuplicate={selectedSyncBar?.isManual ? handleEditBarDuplicate : undefined}
              onDelete={selectedSyncBar ? handleEditBarDelete : undefined}
              onMarkContingent={
                selectedSyncBar ? handleEditBarMarkContingent : undefined
              }
            />
          </aside>
        }
        center={
          <aside className={styles.harpoonMapDock}>
            <div className={styles.harpoonMapStackHost} ref={matrixSectionRef}>
              <MapLogisticsStack
              variant="harpoon"
              logisticsStepNumber="04"
              logisticsTitle="Synchronization Matrix"
              logisticsDescription={
                isProvisionalMatrix
                  ? "No feasible executable plan yet. Provisional matrix shows parallel tasks by Main Effort, ISR, Security, and supporting rows."
                  : selectedCoa
                    ? `${selectedCoa.label} — parallel actions on the mission timeline, grouped by operational element.`
                    : "Generate courses of action to auto-populate the synchronization matrix."
              }
              map={
                <OperationalMapPanel
                  embeddedInStack
                  mapFacts={props.mapFacts}
                  tracks={props.overviewTracks}
                  selectedTrack={displayedSelectedTrack}
                  focusFactId={focusFactId}
                  focusNonce={focusNonce}
                  highlightedFactIds={highlightedFactIds}
                  actionPreview={mapActionPreview}
                  onFactIconClick={onMapFactClick}
                  onPinnedCoordUpdate={(factId, coord) => {
                    if (factId === props.selectedOverviewTrack?.id) setLiveTrackCoord(coord);
                  }}
                  usingScenarioData={props.usingScenarioData}
                />
              }
              displayedPlan={matrixPlan}
              selectedCoaLabel={selectedCoa?.label}
              provisional={isProvisionalMatrix}
              emptyContext={logisticsEmptyContext}
              manualEntries={manualEntries}
              barPatches={barPatches}
              hiddenBarIds={hiddenBarIds}
              modifiedBarIds={modifiedBarIds}
              selectedSyncBarId={selectedSyncBar?.id}
              onSyncBarSelect={(bar) => {
                setSelectedSyncBar(bar);
                setPendingComposerBar(bar);
                setComposerDraft(null);
                setAuthorTarget(null);
                if (bar.targetFactIds?.[0]) highlightTrackOnMap(bar.targetFactIds[0]);
              }}
              onBarPatch={handleBarPatch}
              onManualEntryUpdate={handleManualEntryUpdate}
              observedFacts={props.mapFacts}
              onManualEntryDelete={(entryId) =>
                setManualEntries((prev) => prev.filter((item) => item.id !== entryId))
              }
              onManualEntryDuplicate={(entry) =>
                setManualEntries((prev) => [...prev, entry])
              }
              onSystemBarDelete={(barId) => {
                const coaId = overlayCoaId;
                if (!coaId) return;
                updateMatrixOverlay(coaId, (prev) => ({
                  ...prev,
                  hiddenBarIds: prev.hiddenBarIds.includes(barId)
                    ? prev.hiddenBarIds
                    : [...prev.hiddenBarIds, barId],
                }));
              }}
              commanderIntent={props.commanderIntent}
              decisionPoints={syncDecisionPoints}
              onAddTask={openMatrixComposer}
              onCreateManualAtCell={handleCreateManualAtCell}
              externalEditor
              autoExpandRowKey={composerDraft?.rowKey}
              executing={Boolean(executionMessage) || isPlaying}
              executionPlaybackPhase={playbackStatus.phase === "idle" ? undefined : playbackStatus.phase}
              executionActiveBarIds={
                isPlaying ? activeExecutionTaskIds : undefined
              }
              executionCompletedBarIds={executionCompletedBarIds}
              executionBanner={
                <ExecutionFeedbackBanner status={playbackStatus} error={executeError} />
              }
              onValidate={handleMatrixValidate}
              validationFeedback={matrixValidationFeedback ?? undefined}
              onExecute={handleExecuteCoa}
              canExecute={canClickExecute}
              executeHint={
                canClickExecute
                  ? preparedExecution
                    ? `Commit prepared revision ${preparedExecution.revisionId}`
                    : "Prepare and commit the selected COA"
                  : matrixExecuteBlocker
              }
              executeBlocker={matrixExecuteBlocker}
              timeline={
                <EventTimeline
                  embedded
                  items={timelineItems}
                  tracks={props.overviewTracks}
                  facts={props.mapFacts}
                  highlightFactId={focusFactId}
                  onFocusFact={highlightTrackOnMap}
                  onEventNavigate={handleTimelineEvent}
                />
              }
              timelineExpanded={Boolean(executedSnapshot) || executionEvents.length > 0}
              defaultLowerRatio={0.34}
              minLogisticsHeight={200}
              minMapHeight={220}
            />
            </div>
          </aside>
        }
        right={
          <RightSideDock
            panel={rightSidePanel}
            onPanelChange={setRightSidePanel}
            inspector={
              <InspectorPanel
                inspectedFactId={inspectedFactId}
                fact={inspectedFact}
                track={inspectedTrack}
                onLocateFact={highlightTrackOnMap}
              />
            }
            workflow={
              <DecisionFlowPanel
                summaryText={props.summaryText}
                summaryTime={props.summaryTime}
                phase={props.phase}
                reportWindowItems={props.reportWindowItems}
                focusFactId={focusFactId}
                resolveEventTargetFactId={resolveEventTargetFactId}
                onTimelineEvent={handleTimelineEvent}
                candidates={props.candidates}
                selectedCoaId={props.selectedCoaId}
                onSelectCoa={props.onSelectCoa}
                onRunCoaEvaluation={props.onRunCoaEvaluation}
                onCreateOperatorCoa={props.onCreateOperatorCoa}
                coaRunning={props.coaRunning}
                coaPipelineStatus={props.coaPipelineStatus}
                generationBlockerDetail={props.generationBlockerDetail}
                generationError={props.generationError}
                recommendation={recommendation}
                matrixOverlay={matrixOverlay}
                onForkOperatorModified={forkOperatorModified}
                onValidateOperator={handleValidateOperator}
                operatorValidationFeedback={operatorValidationFeedback ?? undefined}
                onMergeOperatorIntoParent={mergeOperatorIntoParent}
                onRebaseOperatorCoa={rebaseOperatorCoa}
                onDiscardOperatorCoa={discardOperatorCoa}
                onCreateImportedOperatorDraft={createImportedOperatorDraft}
                canClickExecute={canClickExecute}
                blockingExecute={blockingExecute}
                executionMessage={executionMessage}
                isPlaying={isPlaying}
                playbackStatus={playbackStatus}
                onExecuteCoa={handleExecuteCoa}
                preparedExecution={preparedExecution}
              />
            }
          />
        }
      />
    </div>
        )}
      </MapClickBridge>
    </ScenePickProvider>
    </TaskComposerProvider>
  );
}
