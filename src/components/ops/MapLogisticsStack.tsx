import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { LogisticsMatrix } from "@components/LogisticsMatrix";
import { SyncMatrix, type BarPatch, type MatrixTimelineSeekTarget } from "@components/SyncMatrix";
import type { ManualSyncEntry } from "../../coa/manualSync";
import type { SyncDecisionPointInput, SyncMatrixBar } from "../../coa/syncMatrix";
import type { SyncGridRowKey } from "../../coa/syncGridSchema";
import type { LogisticsChip } from "@coa/types";
import type { ObservedFact } from "../../intel/types";
import type { LogisticsEmptyContext } from "@components/LogisticsMatrix";
import type { useDisplayedPlan } from "@coa/store";
import type { MessageTrafficItem } from "./types";
import styles from "../../App.module.css";

type DisplayedPlan = ReturnType<typeof useDisplayedPlan>;

export type MapLogisticsStackProps = {
  map: ReactNode;
  displayedPlan: DisplayedPlan | { kind: "empty"; reason: string };
  selectedCoaLabel?: string;
  selectedChipId?: string;
  onChipSelect?: (chip: LogisticsChip) => void;
  emptyContext?: LogisticsEmptyContext;
  provisional?: boolean;
  defaultLogisticsHeight?: number;
  defaultLowerRatio?: number;
  minLogisticsHeight?: number;
  minMapHeight?: number;
  variant?: "default" | "harpoon";
  logisticsTitle?: string;
  logisticsDescription?: string;
  logisticsStepNumber?: string;
  manualEntries?: ManualSyncEntry[];
  barPatches?: Record<string, BarPatch>;
  hiddenBarIds?: string[];
  modifiedBarIds?: string[];
  selectedSyncBarId?: string;
  onSyncBarSelect?: (bar: SyncMatrixBar) => void;
  onBarPatch?: (barId: string, patch: BarPatch) => void;
  onManualEntryUpdate?: (entry: ManualSyncEntry) => void;
  onManualEntryDelete?: (entryId: string) => void;
  onManualEntryDuplicate?: (entry: ManualSyncEntry) => void;
  onSystemBarDelete?: (barId: string) => void;
  onCreateManualAtCell?: (rowKey: SyncGridRowKey, startSec: number) => void;
  commanderIntent?: string;
  decisionPoints?: SyncDecisionPointInput[];
  onAddTask?: () => void;
  observedFacts?: ObservedFact[];
  externalEditor?: boolean;
  autoExpandRowKey?: SyncGridRowKey;
  onExecute?: () => void;
  canExecute?: boolean;
  executing?: boolean;
  executeHint?: string;
  executeBlocker?: string;
  onValidate?: () => void;
  validating?: boolean;
  validationFeedback?: { kind: "success" | "error"; messages: string[] };
  executionBanner?: ReactNode;
  executionActiveBarIds?: Set<string>;
  executionCompletedBarIds?: Set<string>;
  executionPlaybackPhase?: "playing" | "paused" | "committed";
  executionPlayheadSec?: number;
  onTimelineSeek?: (timeSec: number, target: MatrixTimelineSeekTarget) => void;
  onMatrixFocus?: () => void;
  focusedSectionId?: string;
  timelineEvents?: MessageTrafficItem[];
  selectedTimelineEventId?: string;
  onTimelineEventSelect?: (event: MessageTrafficItem) => void;
};

function resizeStep(event: KeyboardEvent): number {
  return event.shiftKey ? 48 : 20;
}

type SharedMatrixProps = Pick<
  MapLogisticsStackProps,
  | "displayedPlan"
  | "provisional"
  | "selectedCoaLabel"
  | "commanderIntent"
  | "decisionPoints"
  | "observedFacts"
  | "emptyContext"
  | "manualEntries"
  | "barPatches"
  | "hiddenBarIds"
  | "modifiedBarIds"
  | "selectedSyncBarId"
  | "selectedChipId"
  | "onSyncBarSelect"
  | "onBarPatch"
  | "onManualEntryUpdate"
  | "onManualEntryDelete"
  | "onManualEntryDuplicate"
  | "onSystemBarDelete"
  | "onCreateManualAtCell"
  | "onAddTask"
  | "externalEditor"
  | "autoExpandRowKey"
  | "onExecute"
  | "canExecute"
  | "executing"
  | "executeHint"
  | "executeBlocker"
  | "onValidate"
  | "validating"
  | "validationFeedback"
  | "executionActiveBarIds"
  | "executionCompletedBarIds"
  | "executionPlaybackPhase"
  | "executionPlayheadSec"
  | "onTimelineSeek"
  | "onMatrixFocus"
  | "focusedSectionId"
  | "timelineEvents"
  | "selectedTimelineEventId"
  | "onTimelineEventSelect"
>;

function SyncMatrixPanel(
  props: SharedMatrixProps & {
    onExpandMatrix?: () => void;
    embedded?: boolean;
    stepNumber?: string;
    matrixSubtitle?: string;
  }
) {
  return (
    <SyncMatrix
      plan={props.displayedPlan}
      provisional={props.provisional}
      coaLabel={props.selectedCoaLabel}
      commanderIntent={props.commanderIntent}
      decisionPoints={props.decisionPoints}
      observedFacts={props.observedFacts}
      emptyContext={props.emptyContext}
      manualEntries={props.manualEntries}
      barPatches={props.barPatches}
      hiddenBarIds={props.hiddenBarIds}
      modifiedBarIds={props.modifiedBarIds}
      selectedBarId={props.selectedSyncBarId ?? props.selectedChipId}
      onBarSelect={props.onSyncBarSelect}
      onBarPatch={props.onBarPatch}
      onManualEntryUpdate={props.onManualEntryUpdate}
      onManualEntryDelete={props.onManualEntryDelete}
      onManualEntryDuplicate={props.onManualEntryDuplicate}
      onSystemBarDelete={props.onSystemBarDelete}
      onCreateManualAtCell={props.onCreateManualAtCell}
      onAddTask={props.onAddTask}
      onExpandMatrix={props.onExpandMatrix}
      externalEditor={props.externalEditor}
      autoExpandRowKey={props.autoExpandRowKey}
      onExecute={props.onExecute}
      canExecute={props.canExecute}
      executing={props.executing}
      executeHint={props.executeHint}
      executeBlocker={props.executeBlocker}
      onValidate={props.onValidate}
      validating={props.validating}
      validationFeedback={props.validationFeedback}
      executionActiveBarIds={props.executionActiveBarIds}
      executionCompletedBarIds={props.executionCompletedBarIds}
      executionPlaybackPhase={props.executionPlaybackPhase}
      executionPlayheadSec={props.executionPlayheadSec}
      onTimelineSeek={props.onTimelineSeek}
      onMatrixFocus={props.onMatrixFocus}
      focusedSectionId={props.focusedSectionId}
      timelineEvents={props.timelineEvents}
      selectedTimelineEventId={props.selectedTimelineEventId}
      onTimelineEventSelect={props.onTimelineEventSelect}
      embedded={props.embedded}
      stepNumber={props.stepNumber}
      matrixSubtitle={props.matrixSubtitle}
    />
  );
}

function HarpoonMapLogisticsStack(props: MapLogisticsStackProps) {
  const {
    map,
    executionBanner,
    logisticsTitle = "Synchronization Matrix",
    logisticsDescription,
    logisticsStepNumber,
    defaultLogisticsHeight = 220,
    defaultLowerRatio = 0.26,
    minLogisticsHeight = 160,
    minMapHeight = 220,
  } = props;

  const [lowerPanelHeight, setLowerPanelHeight] = useState(defaultLogisticsHeight);
  const [introCollapsed, setIntroCollapsed] = useState(true);
  const stackRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  const clampLowerHeight = useCallback(
    (target: number) => {
      const containerH = stackRef.current?.offsetHeight ?? 800;
      const maxLower = containerH - minMapHeight - 12;
      return Math.max(minLogisticsHeight, Math.min(target, maxLower));
    },
    [minLogisticsHeight, minMapHeight]
  );

  useLayoutEffect(() => {
    const el = stackRef.current;
    if (!el || initializedRef.current) return;
    const applyRatio = () => {
      const h = el.offsetHeight;
      if (h < 200) return;
      setLowerPanelHeight(clampLowerHeight(Math.round(h * defaultLowerRatio)));
      initializedRef.current = true;
    };
    applyRatio();
    const observer = new ResizeObserver(applyRatio);
    observer.observe(el);
    return () => observer.disconnect();
  }, [clampLowerHeight, defaultLowerRatio]);

  const mapSharePercent = useCallback(() => {
    const containerH = stackRef.current?.offsetHeight ?? 0;
    if (containerH <= 0) return 0;
    return Math.round(((containerH - lowerPanelHeight) / containerH) * 100);
  }, [lowerPanelHeight]);

  const [mapPercent, setMapPercent] = useState(64);
  useEffect(() => {
    setMapPercent(mapSharePercent());
  }, [lowerPanelHeight, mapSharePercent]);

  const adjustLower = useCallback(
    (delta: number) => {
      setLowerPanelHeight((prev) => clampLowerHeight(prev + delta));
    },
    [clampLowerHeight]
  );

  const startLowerDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startY = e.clientY;
      const startLower = lowerPanelHeight;

      const onMove = (ev: PointerEvent) => {
        // Drag down → separator moves down → more map, less matrix (matches default stack)
        const delta = startY - ev.clientY;
        setLowerPanelHeight(clampLowerHeight(startLower + delta));
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [lowerPanelHeight, clampLowerHeight]
  );

  const handleSeparatorKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step = resizeStep(event);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        adjustLower(-step);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        adjustLower(step);
      } else if (event.key === "Home") {
        event.preventDefault();
        setLowerPanelHeight(minLogisticsHeight);
      } else if (event.key === "End") {
        event.preventDefault();
        const containerH = stackRef.current?.offsetHeight ?? 800;
        setLowerPanelHeight(clampLowerHeight(containerH - minMapHeight - 12));
      }
    },
    [adjustLower, clampLowerHeight, minLogisticsHeight, minMapHeight]
  );

  const expandMapFull = useCallback(() => {
    setLowerPanelHeight(minLogisticsHeight);
  }, [minLogisticsHeight]);

  const expandMatrixFull = useCallback(() => {
    const containerH = stackRef.current?.offsetHeight ?? 800;
    setLowerPanelHeight(clampLowerHeight(containerH - minMapHeight - 12));
  }, [clampLowerHeight, minMapHeight]);

  const resetSplit = useCallback(() => {
    const containerH = stackRef.current?.offsetHeight ?? 800;
    setLowerPanelHeight(clampLowerHeight(Math.round(containerH * defaultLowerRatio)));
  }, [clampLowerHeight, defaultLowerRatio]);

  return (
    <div className={`${styles.opsCenterStack} ${styles.harpoonMapStack}`} ref={stackRef}>
      {!introCollapsed ? (
        <div className={styles.harpoonMapIntro}>
          <div className={styles.harpoonMapIntroRow}>
            <span>Persistent operational picture</span>
            <button
              type="button"
              className={styles.headerButton}
              onClick={() => setIntroCollapsed(true)}
            >
              Hide
            </button>
          </div>
          <strong>
            Drag the bar below the map to size the matrix. Map + / Map − adjust quickly; arrow keys
            work when the bar is focused.
          </strong>
        </div>
      ) : (
        <button
          type="button"
          className={styles.harpoonMapIntroToggle}
          onClick={() => setIntroCollapsed(false)}
        >
          Show layout hint
        </button>
      )}

      <div className={styles.opsMapSlot}>
        <div className={`${styles.stackSectionToolbar} ${styles.stackSectionToolbarCompact}`}>
          <strong>Operational Map</strong>
          <div className={styles.inlineActions}>
            <span className={styles.splitPercentBadge}>Map {mapPercent}%</span>
            <button
              type="button"
              className={styles.headerButton}
              onClick={() => adjustLower(-80)}
              title="Give more space to the map"
            >
              Map +
            </button>
            <button
              type="button"
              className={styles.headerButton}
              onClick={() => adjustLower(80)}
              title="Give more space to the matrix"
            >
              Map −
            </button>
            <button type="button" className={styles.headerButton} onClick={expandMapFull}>
              Max Map
            </button>
            <button type="button" className={styles.headerButton} onClick={resetSplit}>
              Reset
            </button>
          </div>
        </div>
        {map}
      </div>

      {executionBanner ? (
        <div className={styles.executionBannerSlot}>{executionBanner}</div>
      ) : null}

      <div
        className={styles.opsRowHandle}
        onPointerDown={startLowerDrag}
        onKeyDown={handleSeparatorKey}
        title="Drag to resize — pull down for more map, up for more matrix"
        role="separator"
        aria-orientation="horizontal"
        aria-valuenow={lowerPanelHeight}
        aria-valuemin={minLogisticsHeight}
        aria-valuemax={(stackRef.current?.offsetHeight ?? 800) - minMapHeight - 12}
        aria-label="Resize map and synchronization matrix"
        tabIndex={0}
      >
        <span className={styles.opsRowHandleLabel}>
          Resize map / matrix · Map {mapPercent}% · Matrix {100 - mapPercent}%
        </span>
      </div>

      <section
        className={`${styles.opsLowerDock} ${styles.opsLowerDockHarpoon}`}
        style={{ height: lowerPanelHeight, flexShrink: 0 }}
        aria-label="Commander synchronization matrix"
      >
        <section
          className={`${styles.opsLogisticsDock} ${styles.opsLogisticsDockHarpoon}`}
          aria-label="Synchronization matrix"
        >
          <div className={styles.logisticsMatrixHostDock}>
            <SyncMatrixPanel
              {...props}
              embedded
              stepNumber={logisticsStepNumber ?? "04"}
              matrixSubtitle={logisticsDescription}
              onExpandMatrix={expandMatrixFull}
            />
          </div>
        </section>
      </section>
    </div>
  );
}

function DefaultMapLogisticsStack(props: MapLogisticsStackProps) {
  const {
    map,
    executionBanner,
    logisticsTitle = "Logistics Matrix",
    selectedCoaLabel,
    defaultLogisticsHeight = 140,
    minLogisticsHeight = 90,
    minMapHeight = 200,
  } = props;

  const [logisticsHeight, setLogisticsHeight] = useState(defaultLogisticsHeight);
  const [mapCollapsed, setMapCollapsed] = useState(false);
  const [logisticsCollapsed, setLogisticsCollapsed] = useState(false);
  const [matrixView, setMatrixView] = useState<"sync" | "strip">("sync");
  const stackRef = useRef<HTMLDivElement>(null);

  const clampLogisticsHeight = useCallback(
    (target: number) => {
      const containerH = stackRef.current?.offsetHeight ?? 800;
      const maxLogistics = containerH - minMapHeight - 6;
      return Math.max(minLogisticsHeight, Math.min(target, maxLogistics));
    },
    [minLogisticsHeight, minMapHeight]
  );

  const startDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (mapCollapsed || logisticsCollapsed) return;
      e.preventDefault();
      const startY = e.clientY;
      const startH = logisticsHeight;

      const onMove = (ev: PointerEvent) => {
        const delta = startY - ev.clientY;
        setLogisticsHeight(clampLogisticsHeight(startH + delta));
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [logisticsHeight, clampLogisticsHeight, mapCollapsed, logisticsCollapsed]
  );

  const expandMapFull = useCallback(() => {
    setMapCollapsed(false);
    setLogisticsCollapsed(true);
  }, []);

  const expandLogisticsFull = useCallback(() => {
    setMapCollapsed(true);
    setLogisticsCollapsed(false);
    const containerH = stackRef.current?.offsetHeight ?? 800;
    setLogisticsHeight(clampLogisticsHeight(containerH - minMapHeight - 6));
  }, [clampLogisticsHeight, minMapHeight]);

  const resetSplit = useCallback(() => {
    setMapCollapsed(false);
    setLogisticsCollapsed(false);
    setLogisticsHeight(clampLogisticsHeight(defaultLogisticsHeight));
  }, [clampLogisticsHeight, defaultLogisticsHeight]);

  const logisticsPanelHeight = logisticsCollapsed
    ? undefined
    : mapCollapsed
      ? clampLogisticsHeight((stackRef.current?.offsetHeight ?? 800) - minMapHeight - 6)
      : logisticsHeight;

  return (
    <div className={styles.opsCenterStack} ref={stackRef}>
      <div className={mapCollapsed ? styles.opsMapSlotCollapsed : styles.opsMapSlot}>
        <div className={styles.stackSectionToolbar}>
          <strong>Operational Map</strong>
          <div className={styles.inlineActions}>
            <button type="button" className={styles.headerButton} onClick={expandMapFull}>
              Expand Map
            </button>
            <button
              type="button"
              className={styles.headerButton}
              onClick={() => setMapCollapsed((value) => !value)}
            >
              {mapCollapsed ? "Show Map" : "Collapse Map"}
            </button>
          </div>
        </div>
        {!mapCollapsed ? map : null}
      </div>

      {executionBanner && !mapCollapsed ? executionBanner : null}

      {!mapCollapsed && !logisticsCollapsed ? (
        <div
          className={styles.opsRowHandle}
          onPointerDown={startDrag}
          title="Drag to resize map and logistics"
          role="separator"
          aria-orientation="horizontal"
        />
      ) : null}

      <section
        className={
          logisticsCollapsed
            ? `${styles.opsLogisticsDock} ${styles.opsLogisticsDockCollapsed}`
            : styles.opsLogisticsDock
        }
        style={
          logisticsPanelHeight !== undefined
            ? { height: logisticsPanelHeight, flexShrink: 0 }
            : { flexShrink: 0 }
        }
        aria-label="Logistics matrix"
      >
        <div className={styles.panelHeaderRow}>
          <h3 className={styles.dashboardTitle}>
            {logisticsTitle}
            {selectedCoaLabel ? (
              <span className={styles.coaNote}> — {selectedCoaLabel}</span>
            ) : null}
          </h3>
          <div className={styles.inlineActions}>
            <button
              type="button"
              className={
                matrixView === "sync" ? styles.headerButtonActive : styles.headerButton
              }
              onClick={() => setMatrixView("sync")}
            >
              Sync Matrix
            </button>
            <button
              type="button"
              className={
                matrixView === "strip" ? styles.headerButtonActive : styles.headerButton
              }
              onClick={() => setMatrixView("strip")}
            >
              Compact Strip
            </button>
            <button
              type="button"
              className={styles.headerButton}
              onClick={() =>
                setLogisticsHeight((prev) => clampLogisticsHeight(prev - 80))
              }
            >
              Larger Map
            </button>
            <button type="button" className={styles.headerButton} onClick={expandLogisticsFull}>
              Expand Logistics
            </button>
            <button
              type="button"
              className={styles.headerButton}
              onClick={() => setLogisticsCollapsed((value) => !value)}
            >
              {logisticsCollapsed ? "Show Logistics" : "Collapse Logistics"}
            </button>
            <button type="button" className={styles.headerButton} onClick={resetSplit}>
              Reset Split
            </button>
          </div>
        </div>
        {!logisticsCollapsed ? (
          <div className={styles.logisticsMatrixHostDock}>
            {matrixView === "sync" ? (
              <SyncMatrixPanel {...props} onExpandMatrix={expandLogisticsFull} />
            ) : (
              <LogisticsMatrix
                plan={props.displayedPlan}
                allowDemo
                provisional={props.provisional}
                selectedChipId={props.selectedChipId}
                onChipSelect={props.onChipSelect}
                emptyContext={props.emptyContext}
              />
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function MapLogisticsStack(props: MapLogisticsStackProps) {
  if (props.variant === "harpoon") {
    return <HarpoonMapLogisticsStack {...props} />;
  }
  return <DefaultMapLogisticsStack {...props} />;
}
