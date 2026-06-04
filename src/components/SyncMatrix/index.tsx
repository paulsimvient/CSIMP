import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { LogisticsPlan } from "@coa/types";
import {
  buildManualOnlySyncMatrix,
  buildSyncMatrixModel,
  formatMatrixTick,
  formatMissionTick,
  formatTaskCardPrimary,
  formatTaskCardSecondary,
  syncGridRowLabel,
  matrixTimeUnitForInterval,
  MATRIX_TICK_OPTIONS,
  MATRIX_TIME_UNIT_OPTIONS,
  normalizeTickIntervalForUnit,
  defaultTickIntervalForUnit,
  snapSecToTick,
  type MatrixTimeUnit,
  type SyncDecisionPointInput,
  type SyncMatrixBar,
  type SyncMatrixRow,
} from "../../coa/syncMatrix";
import { sectionIdForRowKey, type SyncGridRowKey } from "../../coa/syncGridSchema";
import {
  applyManualEntryPatch,
  validateManualEntry,
  type ManualSyncEntry,
} from "../../coa/manualSync";
import { originLabel } from "../../coa/manualSync";
import type { ObservedFact } from "../../intel/types";
import type { MatrixQualityContext } from "../../coa/matrixQuality";
import type { LogisticsEmptyContext } from "@components/LogisticsMatrix";
import { SyncTaskEditor } from "./SyncTaskEditor";
import {
  buildDependencyPaths,
  dependencyLinkedSectionIds,
} from "./syncMatrixLayout";
import styles from "./SyncMatrix.module.css";

export type BarPatch = Partial<
  Pick<
    SyncMatrixBar,
    | "startSec"
    | "durationSec"
    | "status"
    | "rowKey"
    | "actor"
    | "target"
    | "targetFactIds"
    | "subLabel"
    | "actionVerb"
  >
>;

type SyncMatrixProps = {
  plan: LogisticsPlan | { kind: "empty"; reason: string };
  provisional?: boolean;
  emptyContext?: LogisticsEmptyContext;
  manualEntries?: ManualSyncEntry[];
  barPatches?: Record<string, BarPatch>;
  hiddenBarIds?: string[];
  modifiedBarIds?: string[];
  selectedBarId?: string;
  commanderIntent?: string;
  decisionPoints?: SyncDecisionPointInput[];
  coaLabel?: string;
  onBarSelect?: (bar: SyncMatrixBar) => void;
  onBarPatch?: (barId: string, patch: BarPatch) => void;
  onManualEntryUpdate?: (entry: ManualSyncEntry) => void;
  onManualEntryDelete?: (entryId: string) => void;
  onManualEntryDuplicate?: (entry: ManualSyncEntry) => void;
  onSystemBarDelete?: (barId: string) => void;
  onCreateManualAtCell?: (rowKey: SyncGridRowKey, startSec: number) => void;
  onAddTask?: () => void;
  onExpandMatrix?: () => void;
  observedFacts?: ObservedFact[];
  /** When set, the section containing this row is expanded for authoring. */
  autoExpandRowKey?: SyncGridRowKey;
  onExecute?: () => void;
  canExecute?: boolean;
  executing?: boolean;
  executeHint?: string;
  executeBlocker?: string;
  onValidate?: () => void;
  validating?: boolean;
  validationFeedback?: { kind: "success" | "error"; messages: string[] };
  executionActiveBarIds?: Set<string>;
  executionCompletedBarIds?: Set<string>;
  executionPlaybackPhase?: "playing" | "committed";
  /** When true, matrix task editing is handled outside this component (e.g. Inspector panel). */
  externalEditor?: boolean;
};

export function SyncMatrix({
  plan,
  provisional = false,
  emptyContext,
  manualEntries = [],
  barPatches = {},
  hiddenBarIds = [],
  modifiedBarIds = [],
  selectedBarId,
  commanderIntent,
  decisionPoints = [],
  coaLabel,
  onBarSelect,
  onBarPatch,
  onManualEntryUpdate,
  onManualEntryDelete,
  onManualEntryDuplicate,
  onSystemBarDelete,
  onCreateManualAtCell,
  onAddTask,
  onExpandMatrix,
  observedFacts = [],
  autoExpandRowKey,
  onExecute,
  canExecute = false,
  executing = false,
  executeHint,
  executeBlocker,
  onValidate,
  validating = false,
  validationFeedback,
  executionActiveBarIds,
  executionCompletedBarIds,
  executionPlaybackPhase,
  externalEditor = false,
}: SyncMatrixProps) {
  const [timeScale, setTimeScale] = useState<{
    unit?: MatrixTimeUnit;
    tickIntervalSec?: number;
  }>({});
  const [zoom, setZoom] = useState(1);
  const [density, setDensity] = useState<"compact" | "expanded">("expanded");
  const [selectedId, setSelectedId] = useState<string | undefined>(selectedBarId);
  const [editingBar, setEditingBar] = useState<SyncMatrixBar | null>(null);
  const [dependencyPaths, setDependencyPaths] = useState<string[]>([]);
  const [sectionExpandedOverrides, setSectionExpandedOverrides] = useState<
    Record<string, boolean>
  >({});
  const barRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const gridRef = useRef<HTMLDivElement>(null);

  const qualityContext = useMemo((): MatrixQualityContext | undefined => {
    if (!emptyContext) return undefined;
    return {
      blockedDetail: emptyContext.blockedDetail,
      generationError: emptyContext.generationError,
      selectedCoaStatus: emptyContext.selectedCoaStatus,
      pipelineStatus: emptyContext.pipelineStatus,
    };
  }, [
    emptyContext?.blockedDetail,
    emptyContext?.generationError,
    emptyContext?.selectedCoaStatus,
    emptyContext?.pipelineStatus,
  ]);

  const applyTimeScale = useCallback((unit: MatrixTimeUnit, tickSec?: number) => {
    const nextTick = tickSec ?? defaultTickIntervalForUnit(unit);
    setTimeScale({
      unit,
      tickIntervalSec: normalizeTickIntervalForUnit(nextTick, unit),
    });
  }, []);

  const model = useMemo(() => {
    const tickOverride = timeScale.tickIntervalSec
      ? normalizeTickIntervalForUnit(
          timeScale.tickIntervalSec,
          timeScale.unit ?? matrixTimeUnitForInterval(timeScale.tickIntervalSec)
        )
      : undefined;
    const baseInput = {
      tickIntervalSec: tickOverride,
      qualityContext,
      provisional,
      manualEntries,
      modifiedBarIds,
      barPatches,
      hiddenBarIds,
      commanderIntent,
      decisionPoints,
      observedFacts,
      coaLabel,
    };
    if (plan.kind === "populated") {
      return buildSyncMatrixModel({ plan, ...baseInput });
    }
    if (manualEntries.length > 0) {
      return buildManualOnlySyncMatrix(manualEntries, baseInput);
    }
    return null;
  }, [
    plan,
    timeScale.tickIntervalSec,
    timeScale.unit,
    qualityContext,
    provisional,
    manualEntries,
    modifiedBarIds,
    barPatches,
    hiddenBarIds,
    commanderIntent,
    decisionPoints,
    observedFacts,
    coaLabel,
  ]);

  const resolvedTickIntervalSec =
    timeScale.tickIntervalSec ??
    model?.tickIntervalSec ??
    defaultTickIntervalForUnit("minute");
  const activeTimeUnit =
    timeScale.unit ?? matrixTimeUnitForInterval(resolvedTickIntervalSec);
  const tickStepOptions = MATRIX_TICK_OPTIONS[activeTimeUnit];

  const handleScaleChange = useCallback(
    (unit: MatrixTimeUnit) => {
      applyTimeScale(unit);
    },
    [applyTimeScale]
  );

  const handleStepChange = useCallback(
    (tickSec: number) => {
      const unit = matrixTimeUnitForInterval(tickSec);
      applyTimeScale(unit, tickSec);
    },
    [applyTimeScale]
  );

  const updateBarTiming = useCallback(
    (barId: string, patch: BarPatch) => {
      const manualEntry = manualEntries.find((entry) => entry.id === barId);
      if (manualEntry && onManualEntryUpdate) {
        const entryPatch: Parameters<typeof applyManualEntryPatch>[1] = {};
        if (patch.startSec !== undefined) entryPatch.startSec = patch.startSec;
        if (patch.durationSec !== undefined) entryPatch.durationSec = patch.durationSec;
        if (patch.rowKey !== undefined) {
          entryPatch.rowKey = patch.rowKey as SyncGridRowKey;
        }
        onManualEntryUpdate(applyManualEntryPatch(manualEntry, entryPatch));
        return;
      }
      onBarPatch?.(barId, patch);
    },
    [manualEntries, onBarPatch, onManualEntryUpdate]
  );

  const registerBarRef = useCallback((barId: string, el: HTMLButtonElement | null) => {
    if (el) barRefs.current.set(barId, el);
    else barRefs.current.delete(barId);
  }, []);

  const visibleRows = useMemo(() => model?.rows ?? [], [model]);

  const sectionTaskCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of visibleRows) {
      if (row.kind === "task" && row.sectionId) {
        counts.set(row.sectionId, (counts.get(row.sectionId) ?? 0) + row.bars.length);
      }
    }
    return counts;
  }, [visibleRows]);

  const dependencyLinkedSections = useMemo(
    () => dependencyLinkedSectionIds(visibleRows),
    [visibleRows]
  );

  const isSectionPopulated = useCallback(
    (sectionId: string) => (sectionTaskCounts.get(sectionId) ?? 0) > 0,
    [sectionTaskCounts]
  );

  const isSectionExpanded = useCallback(
    (sectionId: string) => {
      if (dependencyLinkedSections.has(sectionId)) return true;
      if (sectionId in sectionExpandedOverrides) {
        return sectionExpandedOverrides[sectionId];
      }
      return isSectionPopulated(sectionId);
    },
    [dependencyLinkedSections, sectionExpandedOverrides, isSectionPopulated]
  );

  const toggleSection = useCallback(
    (sectionId: string) => {
      setSectionExpandedOverrides((prev) => ({
        ...prev,
        [sectionId]: !isSectionExpanded(sectionId),
      }));
    },
    [isSectionExpanded]
  );

  const expandAllSections = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const row of visibleRows) {
      if (row.kind === "section" && row.sectionId) {
        next[row.sectionId] = true;
      }
    }
    setSectionExpandedOverrides(next);
  }, [visibleRows]);

  const collapseEmptySections = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const row of visibleRows) {
      if (row.kind === "section" && row.sectionId) {
        next[row.sectionId] = isSectionPopulated(row.sectionId);
      }
    }
    setSectionExpandedOverrides(next);
  }, [visibleRows, isSectionPopulated]);

  const displayRows = useMemo(() => {
    return visibleRows.filter((row) => {
      if (row.kind !== "task" || !row.sectionId) return true;
      return isSectionExpanded(row.sectionId);
    });
  }, [visibleRows, isSectionExpanded]);

  useEffect(() => {
    setSectionExpandedOverrides({});
  }, [coaLabel]);

  useEffect(() => {
    if (!selectedBarId) return;
    for (const row of visibleRows) {
      if (row.kind !== "task" || !row.sectionId) continue;
      if (row.bars.some((bar) => bar.id === selectedBarId)) {
        setSectionExpandedOverrides((prev) => ({ ...prev, [row.sectionId!]: true }));
      }
    }
  }, [selectedBarId, visibleRows]);

  useEffect(() => {
    if (!autoExpandRowKey) return;
    const sectionId = sectionIdForRowKey(autoExpandRowKey);
    if (!sectionId) return;
    setSectionExpandedOverrides((prev) => ({ ...prev, [sectionId]: true }));
  }, [autoExpandRowKey]);

  useEffect(() => {
    setSelectedId(selectedBarId);
  }, [selectedBarId]);

  const findBarById = useCallback(
    (barId: string | undefined) => {
      if (!barId) return undefined;
      for (const row of visibleRows) {
        if (row.kind !== "task") continue;
        const bar = row.bars.find((item) => item.id === barId);
        if (bar) return bar;
      }
      return undefined;
    },
    [visibleRows]
  );

  const handleMatrixKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!selectedId || !model) return;
      const bar = findBarById(selectedId);
      if (!bar) return;

      const step = model.tickIntervalSec;
      if (event.key === "Enter") {
        event.preventDefault();
        if (externalEditor) {
          onBarSelect?.(bar);
        } else {
          setEditingBar(bar);
        }
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (event.shiftKey) {
          updateBarTiming(bar.id, {
            durationSec: Math.max(step, bar.durationSec - step),
          });
        } else {
          updateBarTiming(bar.id, { startSec: Math.max(0, bar.startSec - step) });
        }
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (event.shiftKey) {
          updateBarTiming(bar.id, { durationSec: bar.durationSec + step });
        } else {
          updateBarTiming(bar.id, { startSec: bar.startSec + step });
        }
      }
    },
    [selectedId, model, findBarById, externalEditor, onBarSelect, updateBarTiming]
  );

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || !model) {
      setDependencyPaths([]);
      return;
    }

    const updatePaths = () => {
      const gridRect = grid.getBoundingClientRect();
      const paths = buildDependencyPaths({
        rows: visibleRows,
        tickIntervalSec: model.tickIntervalSec,
        tickCount: model.ticks.length - 1,
        tickWidth: 96 * zoom,
        labelWidth: 220,
        density,
        gridRect,
        barElements: barRefs.current,
      });
      setDependencyPaths((prev) => {
        if (prev.length === paths.length && prev.every((path, index) => path === paths[index])) {
          return prev;
        }
        return paths;
      });
    };

    updatePaths();
    const scrollHost = grid.closest(`.${styles.scrollHost}`);
    scrollHost?.addEventListener("scroll", updatePaths, { passive: true });
    window.addEventListener("resize", updatePaths);
    return () => {
      scrollHost?.removeEventListener("scroll", updatePaths);
      window.removeEventListener("resize", updatePaths);
    };
  }, [model, visibleRows, zoom, density, displayRows]);

  if (!model) {
    return (
      <div className={styles.empty}>
        <strong>Commander&apos;s Synchronization Matrix</strong>
        <span>Generate a COA or use the Inspector to create matrix tasks.</span>
        {onAddTask && (
          <button type="button" className={styles.toolBtn} onClick={onAddTask}>
            + Add Task
          </button>
        )}
      </div>
    );
  }

  const tickCols = model.ticks.slice(0, -1);
  const tickCount = tickCols.length;
  const labelWidth = 220;
  const tickWidth = 96 * zoom;
  const gridWidth = labelWidth + tickWidth * tickCount;
  const gridColumns = `${labelWidth}px repeat(${tickCount}, ${tickWidth}px)`;

  const matrixClass =
    density === "compact"
      ? `${styles.matrix} ${styles.matrixCompact}`
      : `${styles.matrix} ${styles.matrixExpanded}`;

  const handleCellClick = (
    row: SyncMatrixRow,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    if (!onCreateManualAtCell || row.kind !== "task") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const rawSec = ratio * model.horizonSec;
    const startSec = snapSecToTick(rawSec, model.tickIntervalSec);
    onCreateManualAtCell(row.id as SyncGridRowKey, startSec);
  };

  return (
    <div className={matrixClass}>
      <div
        className={styles.toolbar}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className={styles.toolbarTitle}>Commander&apos;s Synchronization Matrix</span>
        {coaLabel && <span className={styles.toolbarCoa}>COA: {coaLabel}</span>}
        <div className={styles.toolbarGroup}>
          {(onValidate || onExecute) && (
            <div className={styles.toolbarCommitActions}>
              {onValidate && (
                <button
                  type="button"
                  className={styles.toolBtnValidate}
                  onClick={onValidate}
                  disabled={validating}
                  title="Check visible matrix tasks for blocking issues before execution"
                >
                  {validating ? "Validating…" : "Validate"}
                </button>
              )}
              {onExecute && (
                <button
                  type="button"
                  className={styles.toolBtnExecute}
                  onClick={onExecute}
                  disabled={!canExecute && !executing}
                  title={executeHint ?? "Prepare and execute the selected COA revision"}
                >
                  {executing ? "Executing…" : "Execute"}
                </button>
              )}
              {onExecute && !canExecute && !executing && executeBlocker ? (
                <span className={styles.executeBlocker}>{executeBlocker}</span>
              ) : null}
              {onExecute && executing ? (
                <span className={styles.executionProgress} role="status" aria-live="polite">
                  {executionPlaybackPhase === "playing" && executionActiveBarIds?.size
                    ? `Activating task ${executionActiveBarIds.size}…`
                    : executionPlaybackPhase === "committed"
                      ? "Committed"
                      : "Executing…"}
                </span>
              ) : null}
            </div>
          )}
          {onAddTask && (
            <button type="button" className={styles.toolBtnPrimary} onClick={onAddTask}>
              + Add Task
            </button>
          )}
          {onExpandMatrix && (
            <button type="button" className={styles.toolBtn} onClick={onExpandMatrix} title="Expand matrix panel">
              Expand ⛶
            </button>
          )}
          <button
            type="button"
            className={styles.toolBtn}
            onClick={expandAllSections}
            title="Expand every operational section"
          >
            Expand all
          </button>
          <button
            type="button"
            className={styles.toolBtn}
            onClick={collapseEmptySections}
            title="Expand only sections with tasks"
          >
            Populated only
          </button>
          <button
            type="button"
            className={density === "compact" ? styles.toolBtnActive : styles.toolBtn}
            onClick={() => setDensity("compact")}
          >
            Compact
          </button>
          <button
            type="button"
            className={density === "expanded" ? styles.toolBtnActive : styles.toolBtn}
            onClick={() => setDensity("expanded")}
          >
            Expand rows
          </button>
          <div className={styles.granularitySelect}>
            <span className={styles.granularityLabel} id="matrix-scale-label">
              Scale
            </span>
            <select
              value={activeTimeUnit}
              onChange={(e) => handleScaleChange(e.target.value as MatrixTimeUnit)}
              aria-labelledby="matrix-scale-label"
            >
              {MATRIX_TIME_UNIT_OPTIONS.map((opt) => (
                <option key={opt.unit} value={opt.unit}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.granularitySelect}>
            <span className={styles.granularityLabel} id="matrix-step-label">
              Step
            </span>
            <select
              value={String(resolvedTickIntervalSec)}
              onChange={(e) => handleStepChange(Number(e.target.value))}
              aria-labelledby="matrix-step-label"
            >
              {tickStepOptions.map((opt) => (
                <option key={opt.sec} value={String(opt.sec)}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className={styles.toolBtn}
            onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
            disabled={zoom <= 0.75}
          >
            Zoom −
          </button>
          <button
            type="button"
            className={styles.toolBtn}
            onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
            disabled={zoom >= 2}
          >
            Zoom +
          </button>
        </div>
      </div>

      {validationFeedback && validationFeedback.messages.length > 0 ? (
        <div
          className={
            validationFeedback.kind === "success"
              ? styles.validateSuccessBanner
              : styles.validateErrorBanner
          }
          role="status"
        >
          <strong>
            {validationFeedback.kind === "success"
              ? "Matrix ready"
              : "Matrix validation issues"}
          </strong>
          <ul>
            {validationFeedback.messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div
        className={styles.scrollHost}
        tabIndex={0}
        onKeyDown={handleMatrixKeyDown}
        aria-label="Synchronization matrix task grid. Select a task, then use arrow keys to adjust timing."
      >
        <div className={styles.gridWrap} ref={gridRef}>
          <svg className={styles.dependencyLayer} aria-hidden>
            {dependencyPaths.map((path, index) => (
              <path key={index} d={path} className={styles.dependencyLine} />
            ))}
          </svg>
          <div className={styles.grid} style={{ width: gridWidth }}>
            <div
              className={`${styles.sheetRow} ${styles.matrixHeaderRow}`}
              style={{ gridTemplateColumns: gridColumns }}
            >
              <div className={styles.cornerCell}>Operational Function</div>
              {tickCols.map((tick) => (
                <div key={tick.offsetSec} className={styles.timeHeader}>
                  {formatMissionTick(tick.offsetSec)}
                </div>
              ))}
            </div>

            {displayRows.map((row) => {
              if (row.kind === "section") {
                const sectionId = row.sectionId;
                const taskCount = sectionId ? (sectionTaskCounts.get(sectionId) ?? 0) : 0;
                const expanded = sectionId ? isSectionExpanded(sectionId) : true;
                const pinned = sectionId ? dependencyLinkedSections.has(sectionId) : false;
                return (
                  <div
                    key={row.id}
                    className={[
                      styles.sectionRow,
                      expanded ? styles.sectionRowExpanded : styles.sectionRowCollapsed,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{ gridTemplateColumns: gridColumns }}
                  >
                    <button
                      type="button"
                      className={styles.sectionToggle}
                      onClick={() => sectionId && !pinned && toggleSection(sectionId)}
                      aria-expanded={expanded}
                      disabled={pinned}
                      title={
                        pinned
                          ? "Section stays open while dependency connectors are active"
                          : undefined
                      }
                    >
                      <span className={styles.sectionChevron} aria-hidden>
                        {expanded ? "▾" : "▸"}
                      </span>
                      <span className={styles.sectionLabelText}>{row.label}</span>
                      <span className={styles.sectionMeta}>
                        {pinned
                          ? "Linked"
                          : taskCount > 0
                            ? `${taskCount} task${taskCount !== 1 ? "s" : ""}`
                            : "Empty"}
                      </span>
                    </button>
                    <div
                      className={styles.sectionBand}
                      style={{ gridColumn: `2 / span ${tickCount}` }}
                    >
                      {!expanded && taskCount > 0 ? (
                        <span className={styles.sectionCollapsedHint}>
                          {taskCount} task{taskCount !== 1 ? "s" : ""} hidden — click section to
                          expand
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              }

              if (row.kind === "meta") {
                return (
                  <div
                    key={row.id}
                    className={styles.sheetRow}
                    style={{ gridTemplateColumns: gridColumns }}
                  >
                    <div className={styles.rowHeaderMeta}>{row.label}</div>
                    <div
                      className={styles.metaCell}
                      style={{ gridColumn: `2 / span ${tickCount}` }}
                    >
                      {row.metaText}
                    </div>
                  </div>
                );
              }

              if (row.kind === "decision") {
                return (
                  <div
                    key={row.id}
                    className={styles.sheetRow}
                    style={{ gridTemplateColumns: gridColumns }}
                  >
                    <div className={styles.rowHeaderMeta}>{row.label}</div>
                    <div
                      className={styles.decisionTrack}
                      style={
                        {
                          gridColumn: `2 / span ${tickCount}`,
                          gridTemplateColumns: `repeat(${tickCount}, ${tickWidth}px)`,
                        } as CSSProperties
                      }
                    >
                      {tickCols.map((tick) => (
                        <div key={tick.offsetSec} className={styles.gridCell} />
                      ))}
                      {(row.decisionMarkers ?? []).map((marker) => {
                        if (marker.unresolved) {
                          return (
                            <div
                              key={marker.id}
                              className={styles.decisionMarkerUnresolved}
                              style={{ gridColumn: `1 / span ${tickCount}` }}
                              title={marker.detail}
                            >
                              ◆ {marker.label} — trigger timing required
                            </div>
                          );
                        }
                        const col =
                          Math.round((marker.offsetSec ?? 0) / model.tickIntervalSec) + 1;
                        return (
                          <div
                            key={marker.id}
                            className={styles.decisionMarker}
                            style={{ gridColumn: col }}
                            title={marker.detail ?? marker.label}
                          >
                            ◆ {marker.label}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={row.id}
                  className={styles.sheetRow}
                  style={{ gridTemplateColumns: gridColumns }}
                >
                  <div
                    className={styles.rowHeaderTask}
                    style={{ gridColumn: 1, gridRow: 1 }}
                    title={syncGridRowLabel(row.id as SyncGridRowKey)}
                  >
                    {syncGridRowLabel(row.id as SyncGridRowKey)}
                  </div>
                  <div
                    className={styles.taskTrack}
                    data-sync-row-id={row.id}
                    style={
                      {
                        gridColumn: `2 / span ${tickCount}`,
                        gridRow: 1,
                        gridTemplateColumns: `repeat(${tickCount}, ${tickWidth}px)`,
                      } as CSSProperties
                    }
                    onDoubleClick={(event) => handleCellClick(row, event)}
                    title="Double-click to add a task · drag card horizontally for time · vertically to change row"
                  >
                    {tickCols.map((tick) => (
                      <div key={tick.offsetSec} className={styles.gridCell} />
                    ))}
                    {row.bars.map((bar) => (
                      <SyncBar
                        key={bar.id}
                        bar={bar}
                        tickIntervalSec={model.tickIntervalSec}
                        tickCount={tickCount}
                        selected={selectedId === bar.id}
                        executionActive={executionActiveBarIds?.has(bar.id) ?? false}
                        executionCommitted={executionCompletedBarIds?.has(bar.id) ?? false}
                        registerRef={registerBarRef}
                        onSelect={() => {
                          setSelectedId(bar.id);
                          onBarSelect?.(bar);
                        }}
                        onOpenEditor={() => {
                          if (!externalEditor) setEditingBar(bar);
                        }}
                        onTimingChange={updateBarTiming}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className={styles.legend}>
        <span className={`${styles.legendPill} ${styles.statusPlanned}`}>Planned</span>
        <span className={`${styles.legendPill} ${styles.statusContingent}`}>Contingent</span>
        <span className={`${styles.legendPill} ${styles.statusBlocked}`}>Blocked</span>
        <span className={styles.legendOrigin}>
          Drag ↔ time · ↕ row · Click or Enter to edit · ←/→ nudge · Shift+←/→ resize duration
        </span>
      </div>

      <div className={styles.footer}>
        <span>
          {model.actionCount} task{model.actionCount !== 1 ? "s" : ""} · {manualEntries.length}{" "}
          manual ·{" "}
          {[...sectionTaskCounts.entries()].filter(([, count]) => count > 0).length} populated
          section
          {[...sectionTaskCounts.entries()].filter(([, count]) => count > 0).length !== 1
            ? "s"
            : ""}
        </span>
        <span>
          {MATRIX_TIME_UNIT_OPTIONS.find((opt) => opt.unit === activeTimeUnit)?.label ?? "Minutes"}{" "}
          · step{" "}
          {tickStepOptions.find((opt) => opt.sec === resolvedTickIntervalSec)?.label ??
            formatMatrixTick(resolvedTickIntervalSec, resolvedTickIntervalSec)}{" "}
          · horizon {formatMissionTick(model.horizonSec)}
        </span>
      </div>

      {editingBar && !externalEditor && (
        <SyncTaskEditor
          bar={editingBar}
          tickIntervalSec={model.tickIntervalSec}
          onClose={() => setEditingBar(null)}
          onSave={(patch) => {
            if (editingBar.isManual) {
              const entry = manualEntries.find((item) => item.id === editingBar.id);
              if (entry && onManualEntryUpdate) {
                onManualEntryUpdate(
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
                        model.tickIntervalSec
                      ),
                    })
                  )
                );
              }
            } else {
              onBarPatch?.(editingBar.id, {
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
            setEditingBar(null);
          }}
          onDuplicate={() => {
            const entry = manualEntries.find((item) => item.id === editingBar.id);
            if (entry && onManualEntryDuplicate) {
              const patched = barPatches[entry.id];
              onManualEntryDuplicate(
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
                )
              );
            }
            setEditingBar(null);
          }}
          onDelete={() => {
            if (editingBar.isManual) onManualEntryDelete?.(editingBar.id);
            else onSystemBarDelete?.(editingBar.id);
            setEditingBar(null);
          }}
          onMarkContingent={() => {
            if (editingBar.isManual) {
              const entry = manualEntries.find((item) => item.id === editingBar.id);
              if (entry && onManualEntryUpdate) {
                onManualEntryUpdate({ ...entry, status: "contingent", origin: "contingent" });
              }
            } else {
              onBarPatch?.(editingBar.id, { status: "contingent" });
            }
            setEditingBar(null);
          }}
        />
      )}
    </div>
  );
}

function SyncBar({
  bar,
  tickIntervalSec,
  tickCount,
  selected,
  executionActive = false,
  executionCommitted = false,
  registerRef,
  onSelect,
  onOpenEditor,
  onTimingChange,
}: {
  bar: SyncMatrixBar;
  tickIntervalSec: number;
  tickCount: number;
  selected: boolean;
  executionActive?: boolean;
  executionCommitted?: boolean;
  registerRef?: (barId: string, el: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onOpenEditor: () => void;
  onTimingChange: (barId: string, patch: BarPatch) => void;
}) {
  const startCol = Math.min(
    tickCount,
    Math.max(1, Math.round(bar.startSec / tickIntervalSec) + 1)
  );
  const span = Math.max(
    1,
    Math.min(tickCount - startCol + 1, Math.round(bar.durationSec / tickIntervalSec))
  );
  const displayStatus = executionCommitted
    ? "complete"
    : executionActive
      ? "active"
      : bar.status;
  const statusClass = statusClassFor(displayStatus);
  const hasMissing = bar.missingFields.length > 0;
  const primary = formatTaskCardPrimary(bar);
  const secondary = formatTaskCardSecondary({
    target: bar.target,
    label: bar.label,
    missingFields: bar.missingFields,
  });

  const startDrag = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const track = (e.currentTarget as HTMLElement).closest(`.${styles.taskTrack}`);
    if (!track) return;
    const trackRect = track.getBoundingClientRect();
    const colWidth = trackRect.width / tickCount;
    const startX = e.clientX;
    const start = { startSec: bar.startSec, durationSec: bar.durationSec, rowKey: bar.rowKey };

    const onMove = (ev: PointerEvent) => {
      const deltaPx = ev.clientX - startX;
      const deltaCols = Math.round(deltaPx / colWidth);
      const deltaSec = deltaCols * tickIntervalSec;
      if (mode === "move") {
        const nextStart = snapSecToTick(
          Math.max(0, start.startSec + deltaSec),
          tickIntervalSec
        );
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const rowHost = el?.closest("[data-sync-row-id]") as HTMLElement | null;
        const nextRowKey = rowHost?.dataset.syncRowId;
        const movePatch: BarPatch = { startSec: nextStart };
        if (nextRowKey && nextRowKey !== start.rowKey) {
          movePatch.rowKey = nextRowKey;
        }
        onTimingChange(bar.id, movePatch);
      } else {
        const nextDuration = Math.max(
          tickIntervalSec,
          snapSecToTick(start.durationSec + deltaSec, tickIntervalSec)
        );
        onTimingChange(bar.id, { durationSec: nextDuration });
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const title = [
    primary,
    secondary,
    originLabel(bar.origin),
    `Window: ${formatMatrixTick(bar.startSec, tickIntervalSec)} – ${formatMatrixTick(bar.startSec + bar.durationSec, tickIntervalSec)}`,
    bar.operationalFunction ? `Row: ${bar.operationalFunction}` : "",
    bar.sourceLabel ? `Source: ${bar.sourceLabel}` : "",
    bar.startCondition ? `Trigger: ${bar.startCondition}` : "",
    bar.dependencyLabels.length > 0 ? `Depends on: ${bar.dependencyLabels.join(", ")}` : "",
    ...bar.reasons.map((r) => `Issue: ${r}`),
    ...bar.fixes.map((f) => `Fix: ${f}`),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <button
      type="button"
      ref={(el) => registerRef?.(bar.id, el)}
      className={`${styles.bar} ${statusClass} ${selected ? styles.barSelected : ""} ${
        hasMissing ? styles.barMissing : ""
      } ${executionActive ? styles.barExecutionPulse : ""}`}
      style={{ gridColumn: `${startCol} / span ${span}` }}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
        onOpenEditor();
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).dataset.resize === "true") return;
        startDrag("move")(e);
      }}
    >
      <span className={styles.barPrimary}>{primary}</span>
      <span
        className={
          bar.missingFields.includes("timing")
            ? styles.barSecondaryWarn
            : styles.barSecondary
        }
      >
        {secondary}
      </span>
      {bar.sourceLabel && (
        <span className={styles.barSource}>{bar.sourceLabel}</span>
      )}
      <span
        className={styles.resizeHandle}
        data-resize="true"
        onPointerDown={startDrag("resize")}
      />
    </button>
  );
}

function statusClassFor(status: SyncMatrixBar["status"]): string {
  switch (status) {
    case "active":
      return styles.statusActive ?? "";
    case "complete":
      return styles.statusComplete ?? "";
    case "delayed":
      return styles.statusDelayed ?? "";
    case "blocked":
      return styles.statusBlocked ?? "";
    case "contingent":
      return styles.statusContingent ?? "";
    default:
      return styles.statusPlanned ?? "";
  }
}
