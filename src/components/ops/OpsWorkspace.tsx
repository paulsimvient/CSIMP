import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  getExecuteBlockers,
  useExecuteCoaRevision,
  useExecutedSnapshot,
  useMatrixOverlay,
  usePreparedExecution,
  useUpdateMatrixOverlay,
  useValidateOperatorCoa,
  useRemoveCoa,
  useRebaseOperatorCoa,
  useMergeOperatorIntoParent,
  useCreateOperatorDraft,
  useForkOperatorModified,
  useCoaStore,
} from "@coa/store";
import { collectRevisionBlockers, needsMaterializedValidation } from "../../coa/materializeCoaRevision";
import { getMatrixOverlay } from "../../coa/operatorCoa";
import type { DecisionPoint } from "../../intel/types";
import type { useDisplayedPlan } from "@coa/store";
import type { ObservedFact } from "../../intel/types";
import type { CoaCandidate } from "../../coa/types";
import { factToLngLat } from "../../scene/theater";
import {
  buildExecutionInteractionMap,
  mergeFeatureCollections,
  resolveBarFallbackAnchor,
  resolveBarInteractionCoords,
} from "../../scene/executionInteractionMap";
import { buildExecutionTrackPositions } from "../../scene/executionTrackMotion";
import { orderSetTasksToSyncBars } from "../../scene/executionPlaybackScale";
import { resolveMatrixSeekMapFactId } from "../../scene/resolveMatrixSeekMapFact";
import type { MessageTrafficItem, OverviewTrack, ShowOrderItem } from "./types";
import { mergeTimelineItems } from "./timelineItems";
import { useExecutionPlayback } from "./useExecutionPlayback";
import { ExecutionFeedbackBanner } from "./ExecutionFeedbackBanner";
import { MapLogisticsStack } from "./MapLogisticsStack";
import { MatrixTaskPanel } from "./MatrixTaskPanel";
import { InspectorPanel } from "./InspectorPanel";
import type { MatrixInspectorContext } from "./MatrixInspectorDetail";
import { RightSideDock, type RightSidePanel } from "./RightSideDock";
import { ScenePickProvider, useScenePick } from "./ScenePickContext";
import { TaskComposerProvider, useTaskComposer } from "./TaskComposerContext";
import { TaskComposerLifecycle } from "./TaskComposerLifecycle";
import { ResizableLayout } from "./ResizableLayout";
import { buildLogisticsPlan } from "../../coa/logistics";
import {
  applyManualEntryPatch,
  createDraftManualEntryAtCell,
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
  manualEntryToSyncBar,
} from "../../coa/syncMatrix";
import { sectionIdForRowKey, type SyncGridRowKey } from "../../coa/syncGridSchema";
import type { BarPatch, MatrixTimelineSeekTarget } from "@components/SyncMatrix";
import { DecisionFlowPanel } from "./DecisionFlowPanel";
import { resolveTimelineFactId } from "./EventTimeline";
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
  const removeCoa = useRemoveCoa();
  const rebaseOperatorCoa = useRebaseOperatorCoa();
  const mergeOperatorIntoParent = useMergeOperatorIntoParent();
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
  const lastPannedFactIdRef = useRef<string | undefined>();
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
  const [inspectedEventId, setInspectedEventId] = useState<string | undefined>();
  const [inspectorSource, setInspectorSource] = useState<"matrix" | "scene" | "event">("matrix");
  const [matrixScrubTimeSec, setMatrixScrubTimeSec] = useState<number | undefined>();
  const [focusedMatrixSectionId, setFocusedMatrixSectionId] = useState<string | undefined>();
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
  const [validating, setValidating] = useState(false);
  const matrixExecuteBlocker = blockingExecute[0];

  const handleValidate = useCallback(async () => {
    if (!selectedCoa || !props.selectedCoaId) {
      setMatrixValidationFeedback({
        kind: "error",
        messages: ["Select a COA in Step 03 before validating."],
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

    const needsCoaValidation =
      needsMaterializedValidation(selectedCoa) &&
      (selectedCoa.validationStatus !== "validated" ||
        selectedCoa.status === "draft" ||
        selectedCoa.status === "incomplete");

    if (needsCoaValidation) {
      setValidating(true);
      try {
        const result = await validateOperatorCoa(props.selectedCoaId, materializeContext);
        if (!result.ok) {
          setMatrixValidationFeedback({
            kind: "error",
            messages: result.blockers,
          });
          return;
        }
      } finally {
        setValidating(false);
      }
    }

    const storeState = useCoaStore.getState();
    const freshCoa = storeState.candidatesById[props.selectedCoaId];
    const freshOverlay = getMatrixOverlay(storeState, props.selectedCoaId);
    const execBlockers = getExecuteBlockers({
      candidate: freshCoa,
      overlay: freshOverlay,
      preparedExecution: storeState.preparedExecution,
      coaRunning: props.coaRunning,
      logisticsReady: freshCoa?.logisticsPlan.kind === "populated",
      materializeContext,
    }).filter((reason) => !reason.includes("Prepare execution"));

    if (execBlockers.length > 0) {
      setMatrixValidationFeedback({
        kind: "success",
        messages: [
          needsCoaValidation
            ? "COA validated — matrix tasks look good."
            : "Matrix tasks look good.",
          `Execute is still blocked: ${execBlockers[0]}`,
        ],
      });
      return;
    }

    setMatrixValidationFeedback({
      kind: "success",
      messages: [
        needsCoaValidation
          ? "COA and matrix validated — use Execute to commit."
          : "Matrix validated — use Execute to commit.",
      ],
    });
  }, [
    selectedCoa,
    props.selectedCoaId,
    props.coaRunning,
    matrixOverlay,
    materializeContext,
    validateOperatorCoa,
  ]);

  useEffect(() => {
    setMatrixValidationFeedback(null);
  }, [props.selectedCoaId, matrixOverlay.revisionId]);

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
  const {
    executionEvents,
    activeExecutionTaskIds,
    completedExecutionTaskIds,
    playbackTimeSec,
    isPlaying,
    isScrubbing,
    playbackStatus,
    seekPlaybackTime,
    togglePlayback,
  } = useExecutionPlayback(executedSnapshot);
  const executionPlaybackLive =
    Boolean(executedSnapshot) &&
    (playbackStatus.phase === "playing" || playbackStatus.phase === "paused" || isScrubbing);
  const matrixPlayheadSec = executedSnapshot ? playbackTimeSec : matrixScrubTimeSec;
  const executionCompletedBarIds = useMemo(() => {
    if (!executedSnapshot) return undefined;
    if (completedExecutionTaskIds.size === 0) return undefined;
    return completedExecutionTaskIds;
  }, [executedSnapshot, completedExecutionTaskIds]);
  const executionActiveBarIds = useMemo(() => {
    if (!executedSnapshot) return undefined;
    if (
      playbackStatus.phase !== "playing" &&
      playbackStatus.phase !== "paused"
    ) {
      return undefined;
    }
    if (activeExecutionTaskIds.size === 0) return undefined;
    return activeExecutionTaskIds;
  }, [executedSnapshot, playbackStatus.phase, activeExecutionTaskIds]);
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
    setMatrixValidationFeedback(null);
    setMatrixScrubTimeSec(undefined);
    setFocusedMatrixSectionId(undefined);
    setRightSidePanel("workflow");
  }, [props.selectedCoaId, materializeContext, executeCoaRevision]);
  const timelineItems = useMemo(
    () => mergeTimelineItems(executionEvents, props.reportWindowItems),
    [executionEvents, props.reportWindowItems]
  );
  const executionBars = useMemo(() => {
    if (executedSnapshot?.orderSet.tasks.length) {
      return orderSetTasksToSyncBars(executedSnapshot.orderSet.tasks);
    }
    return syncMatrixModel?.rows.flatMap((row) => row.bars) ?? [];
  }, [executedSnapshot, syncMatrixModel]);
  const selectedSyncBarLive = useMemo(() => {
    if (!selectedSyncBar) return null;
    return executionBars.find((bar) => bar.id === selectedSyncBar.id) ?? selectedSyncBar;
  }, [selectedSyncBar, executionBars]);
  const shouldRenderTaskLinks = Boolean(
    executedSnapshot ||
      (selectedCoa?.validationStatus === "validated" &&
        selectedCoa.status === "sat" &&
        executionBars.length > 0)
  );
  const executionTrackPositionOverrides = useMemo(() => {
    if (!executedSnapshot) {
      return new Map<string, { lng: number; lat: number }>();
    }
    return buildExecutionTrackPositions({
      playbackTimeSec: matrixPlayheadSec ?? 0,
      tasks: executedSnapshot.orderSet.tasks,
      bars: executionBars,
      facts: props.mapFacts,
      tracks: props.overviewTracks,
      manualEntries,
    });
  }, [
    executedSnapshot,
    matrixPlayheadSec,
    executionBars,
    props.mapFacts,
    props.overviewTracks,
    manualEntries,
  ]);

  const executionOverviewTracks = useMemo(() => {
    if (executionTrackPositionOverrides.size === 0) return props.overviewTracks;
    return props.overviewTracks.map((track) => {
      const override = executionTrackPositionOverrides.get(track.id);
      if (!override) return track;
      return {
        ...track,
        coordinates: { lng: override.lng, lat: override.lat },
      };
    });
  }, [props.overviewTracks, executionTrackPositionOverrides]);

  const mapLinkTracks = executedSnapshot ? executionOverviewTracks : props.overviewTracks;
  const executionInteractionGeoJson = useMemo(() => {
    if (!shouldRenderTaskLinks || executionBars.length === 0) return null;
    return buildExecutionInteractionMap({
      bars: executionBars,
      facts: props.mapFacts,
      tracks: mapLinkTracks,
      manualEntries,
    });
  }, [
    shouldRenderTaskLinks,
    executionBars,
    props.mapFacts,
    mapLinkTracks,
    manualEntries,
  ]);

  const executionPlaybackActive = Boolean(executedSnapshot);

  const selectedBarMapPreview = useMemo(() => {
    if (!selectedSyncBar) return null;
    return buildExecutionInteractionMap({
      bars: [selectedSyncBar],
      facts: props.mapFacts,
      tracks: mapLinkTracks,
      manualEntries,
      useFallbackAnchors: true,
    });
  }, [selectedSyncBar, props.mapFacts, mapLinkTracks, manualEntries]);

  const mapActionPreview = useMemo(() => {
    if (actionPreviewGeoJson?.features.length) {
      return mergeFeatureCollections(selectedBarMapPreview, actionPreviewGeoJson);
    }
    if (selectedBarMapPreview) return selectedBarMapPreview;
    return executionInteractionGeoJson;
  }, [executionInteractionGeoJson, actionPreviewGeoJson, selectedBarMapPreview]);

  useEffect(() => {
    setSelectedSyncBar(null);
    setComposerDraft(null);
    setInspectedFactId(undefined);
    setInspectedEventId(undefined);
    setFocusedMatrixSectionId(undefined);
  }, [props.selectedCoaId]);

  useEffect(() => {
    setLiveTrackCoord(null);
  }, [props.selectedOverviewTrack?.id]);

  const displayedSelectedTrack = useMemo(() => {
    const baseTrack = props.selectedOverviewTrack
      ? executionOverviewTracks.find((track) => track.id === props.selectedOverviewTrack?.id) ??
        props.selectedOverviewTrack
      : undefined;
    if (!baseTrack) return undefined;
    if (!liveTrackCoord) return baseTrack;
    return {
      ...baseTrack,
      coordinates: { lat: liveTrackCoord[1], lng: liveTrackCoord[0] },
    };
  }, [props.selectedOverviewTrack, executionOverviewTracks, liveTrackCoord]);
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
      for (const bar of executionBars) {
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
  ]);

  const highlightTrackOnMap = useCallback(
    (factId: string, options?: { pan?: boolean }) => {
      const shouldPan = options?.pan ?? true;
      props.setSelectedOverviewTrackId(factId);
      setFocusFactId(factId);
      if (shouldPan && lastPannedFactIdRef.current !== factId) {
        lastPannedFactIdRef.current = factId;
        setFocusNonce((nonce) => nonce + 1);
      }
    },
    [props.setSelectedOverviewTrackId]
  );

  const activeExecutionTaskKey = useMemo(() => {
    if (!executedSnapshot || activeExecutionTaskIds.size === 0) return "";
    return [...activeExecutionTaskIds].sort().join("|");
  }, [executedSnapshot, activeExecutionTaskIds]);

  useEffect(() => {
    if (!executedSnapshot || playbackStatus.phase === "committed") return;
    if (!activeExecutionTaskKey) return;
    const activeTask = executedSnapshot.orderSet.tasks.find((task) =>
      activeExecutionTaskIds.has(task.id)
    );
    const factId = activeTask?.targetFactIds?.[0];
    if (factId) highlightTrackOnMap(factId, { pan: false });
  }, [
    executedSnapshot,
    playbackStatus.phase,
    activeExecutionTaskKey,
    activeExecutionTaskIds,
    highlightTrackOnMap,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      if (!executedSnapshot) return;
      event.preventDefault();
      togglePlayback();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [executedSnapshot, togglePlayback]);

  const focusMatrixInspector = useCallback(() => {
    setInspectorSource("matrix");
    setInspectedFactId(undefined);
    setInspectedEventId(undefined);
  }, []);

  const inspectSceneObject = (factId: string) => {
    setInspectorSource("scene");
    highlightTrackOnMap(factId);
    setInspectedFactId(factId);
    setInspectedEventId(undefined);
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

  const matrixInspectorSubtitle = isProvisionalMatrix
    ? "Provisional matrix — parallel tasks by operational element."
    : selectedCoa
      ? `${selectedCoa.label} — parallel actions on the mission timeline.`
      : "Generate courses of action to populate the synchronization matrix.";

  const matrixInspectorContext = useMemo(
    (): MatrixInspectorContext => ({
      coaLabel: selectedCoa?.label,
      commanderIntent: props.commanderIntent,
      matrixSubtitle: matrixInspectorSubtitle,
      taskCount: executionBars.length,
      selectedBar: selectedSyncBar ?? undefined,
      bars: executionBars,
      knownAssets: props.knownAssets,
      executionActiveBarIds,
      executionCompletedBarIds,
      executionPlaybackPhase:
        playbackStatus.phase === "playing" ||
        playbackStatus.phase === "paused" ||
        playbackStatus.phase === "committed"
          ? playbackStatus.phase
          : undefined,
      executionPlayheadSec: matrixPlayheadSec,
      horizonSec: syncHorizonSec,
    }),
    [
      selectedCoa?.label,
      props.commanderIntent,
      matrixInspectorSubtitle,
      executionBars,
      selectedSyncBar,
      props.knownAssets,
      executionActiveBarIds,
      executionCompletedBarIds,
      playbackStatus.phase,
      matrixPlayheadSec,
      syncHorizonSec,
    ]
  );

  const handleSelectMatrixTaskFromInspector = useCallback(
    (barId: string) => {
      const bar = executionBars.find((item) => item.id === barId);
      if (!bar) return;
      setSelectedSyncBar(bar);
      setPendingComposerBar(bar);
      focusMatrixInspector();
    },
    [executionBars, focusMatrixInspector]
  );

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
    const entry = createDraftManualEntryAtCell({
      rowKey,
      startSec,
      durationSec: syncTickIntervalSec,
    });
    setManualEntries((prev) => [...prev, entry]);
    const bar = manualEntryToSyncBar(entry);
    setSelectedSyncBar(bar);
    setPendingComposerBar(bar);
    setComposerDraft(null);
    setAuthorTarget(null);
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
    const draftEntryId = composerDraft?.entryId;
    if (draftEntryId) {
      setManualEntries((prev) => {
        const draft = prev.find((item) => item.id === draftEntryId);
        if (draft && !draft.confirmed) {
          return prev.filter((item) => item.id !== draftEntryId);
        }
        return prev;
      });
    }
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
      let stillIncomplete = true;
      if (bar.isManual) {
        const entry = manualEntries.find((item) => item.id === bar.id);
        if (!entry) return;
        const validated = validateManualEntry(
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
        );
        stillIncomplete = validated.missingFields.length > 0;
        handleManualEntryUpdate(validated);
        setSelectedSyncBar(manualEntryToSyncBar(validated));
        setPendingComposerBar(manualEntryToSyncBar(validated));
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
        stillIncomplete =
          !patch.actor?.trim() || !patch.target?.trim() || !patch.actionVerb?.trim();
      }
      if (!stillIncomplete) {
        closeMatrixEditor();
      }
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

  const inspectedEvent = useMemo(
    () =>
      inspectedEventId
        ? timelineItems.find((item) => item.id === inspectedEventId)
        : undefined,
    [inspectedEventId, timelineItems]
  );

  const inspectedEventFactId = useMemo(
    () =>
      inspectedEvent ? resolveEventTargetFactId(inspectedEvent) : undefined,
    [inspectedEvent, resolveEventTargetFactId]
  );

  const handleMatrixTimelineSeek = useCallback(
    (timeSec: number, target: MatrixTimelineSeekTarget) => {
      focusMatrixInspector();
      if (executedSnapshot) {
        seekPlaybackTime(timeSec);
      }
      setMatrixScrubTimeSec(timeSec);
      const sectionId =
        target.sectionId ??
        (target.rowKey ? sectionIdForRowKey(target.rowKey) : undefined);
      if (sectionId) {
        setFocusedMatrixSectionId(sectionId);
      }
      const mapFactId = resolveMatrixSeekMapFactId({
        timeSec,
        target,
        bars: executionBars,
        facts: props.mapFacts,
        tracks: props.overviewTracks,
      });
      if (mapFactId) {
        highlightTrackOnMap(mapFactId);
      }
    },
    [
      focusMatrixInspector,
      executedSnapshot,
      seekPlaybackTime,
      executionBars,
      props.mapFacts,
      props.overviewTracks,
      highlightTrackOnMap,
    ]
  );

  const selectTimelineEvent = useCallback(
    (event: MessageTrafficItem) => {
      setInspectorSource("event");
      setInspectedEventId(event.id);
      setInspectedFactId(undefined);
      setRightSidePanel("inspector");
    },
    []
  );

  const handleTimelineEvent = useCallback(
    (event: MessageTrafficItem, factId?: string) => {
      selectTimelineEvent(event);
      const resolved = factId ?? resolveEventTargetFactId(event);

      if (event.kind === "validation") {
        return;
      }

      if (resolved) {
        setTimelineInstructionSeed(undefined);
        highlightTrackOnMap(resolved);
      } else if (event.kind === "ops") {
        setTimelineInstructionSeed(event.text);
      }
    },
    [selectTimelineEvent, resolveEventTargetFactId, highlightTrackOnMap]
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
      <ResizableLayout
        fillParent
        className={styles.harpoonResizableLayout}
        defaultLeft={280}
        defaultRight={360}
        minLeft={240}
        minRight={280}
        minCenter={420}
        left={
          <aside className={styles.harpoonTaskDock} aria-label="Matrix task panel">
            <MatrixTaskPanel
              key={selectedSyncBarLive?.id ?? "create"}
              bar={selectedSyncBarLive ?? undefined}
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
            <div className={styles.harpoonMapStackHost}>
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
                  tracks={executionOverviewTracks}
                  selectedTrack={displayedSelectedTrack}
                  focusFactId={focusFactId}
                  focusNonce={focusNonce}
                  highlightedFactIds={highlightedFactIds}
                  actionPreview={mapActionPreview}
                  executionPlaybackActive={executionPlaybackActive}
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
                focusMatrixInspector();
                setSelectedSyncBar(bar);
                setPendingComposerBar(bar);
                setComposerDraft(null);
                setAuthorTarget(null);
                const entry = manualEntries.find((item) => item.id === bar.id);
                const factId = bar.targetFactIds?.[0] ?? entry?.targetFactId;
                if (factId) {
                  highlightTrackOnMap(factId);
                  return;
                }
                const coords = resolveBarInteractionCoords(
                  bar,
                  props.mapFacts,
                  props.overviewTracks,
                  manualEntries
                );
                const anchor =
                  coords.targetCoord ??
                  coords.actorCoord ??
                  resolveBarFallbackAnchor(bar, props.mapFacts, props.overviewTracks);
                if (!anchor) return;
                let nearestFactId: string | undefined;
                let nearestDistance = Number.POSITIVE_INFINITY;
                props.mapFacts.forEach((fact, index) => {
                  const factCoord = factToLngLat(fact, index);
                  const dx = factCoord[0] - anchor[0];
                  const dy = factCoord[1] - anchor[1];
                  const distance = Math.hypot(dx, dy);
                  if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestFactId = fact.id;
                  }
                });
                if (nearestFactId && nearestDistance < 0.25) {
                  highlightTrackOnMap(nearestFactId);
                }
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
              executing={executionPlaybackLive}
              executionCommitted={Boolean(executedSnapshot) && playbackStatus.phase === "committed"}
              onTogglePlayback={executedSnapshot ? togglePlayback : undefined}
              executionPlaybackPhase={
                playbackStatus.phase === "idle" ? undefined : playbackStatus.phase
              }
              executionActiveBarIds={executionActiveBarIds}
              executionCompletedBarIds={executionCompletedBarIds}
              executionPlayheadSec={matrixPlayheadSec}
              onTimelineSeek={handleMatrixTimelineSeek}
              onMatrixFocus={focusMatrixInspector}
              focusedSectionId={focusedMatrixSectionId}
              executionBanner={
                <ExecutionFeedbackBanner
                  status={playbackStatus}
                  error={executeError}
                  compact
                />
              }
              onValidate={() => void handleValidate()}
              validating={validating}
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
              timelineEvents={timelineItems}
              selectedTimelineEventId={inspectedEventId}
              onTimelineEventSelect={selectTimelineEvent}
              defaultLowerRatio={0.26}
              minLogisticsHeight={160}
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
                inspectorSource={inspectorSource}
                matrixContext={matrixInspectorContext}
                onSelectMatrixTask={handleSelectMatrixTaskFromInspector}
                inspectedFactId={inspectedFactId}
                fact={inspectedFact}
                track={inspectedTrack}
                inspectedEvent={inspectedEvent}
                inspectedEventFactId={inspectedEventFactId}
                onLocateFact={highlightTrackOnMap}
                onInspectEventWorkflow={() => {
                  setRightSidePanel("workflow");
                  props.setActiveView("trace");
                }}
                onInspectEventAuthorTask={(event) => {
                  handleTimelineEvent(event, inspectedEventFactId);
                  openMatrixComposer();
                }}
              />
            }
            workflow={
              <DecisionFlowPanel
                summaryText={props.summaryText}
                summaryTime={props.summaryTime}
                phase={props.phase}
                timelineItems={timelineItems}
                focusFactId={focusFactId}
                resolveEventTargetFactId={resolveEventTargetFactId}
                onTimelineEvent={handleTimelineEvent}
                candidates={props.candidates}
                selectedCoaId={props.selectedCoaId}
                onSelectCoa={props.onSelectCoa}
                onRunCoaEvaluation={props.onRunCoaEvaluation}
                coaRunning={props.coaRunning}
                coaPipelineStatus={props.coaPipelineStatus}
                generationBlockerDetail={props.generationBlockerDetail}
                generationError={props.generationError}
                matrixOverlay={matrixOverlay}
                onForkOperatorModified={forkOperatorModified}
                onMergeOperatorIntoParent={mergeOperatorIntoParent}
                onRebaseOperatorCoa={rebaseOperatorCoa}
                onRemoveCoa={removeCoa}
                canClickExecute={canClickExecute}
                blockingExecute={blockingExecute}
                playbackStatus={playbackStatus}
                onExecuteCoa={handleExecuteCoa}
                onTogglePlayback={togglePlayback}
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
