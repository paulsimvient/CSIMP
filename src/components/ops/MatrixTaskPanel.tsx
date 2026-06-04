import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildManualEntryFromStructuredFields,
  originLabel,
  parseManualInstruction,
  resolveDependencyBarId,
  type ManualSyncEntry,
  type ManualSyncTarget,
  type MatrixComposerDraft,
} from "../../coa/manualSync";
import {
  formatMatrixTick,
  parseMissionTickToSec,
  type SyncBarStatus,
  type SyncMatrixBar,
} from "../../coa/syncMatrix";
import {
  formatMatrixRowOption,
  SYNC_GRID_TASK_ROWS,
  type SyncGridRowKey,
} from "../../coa/syncGridSchema";
import { MatrixTickSelect } from "./MatrixTickSelect";
import { SceneObjectSelect } from "./SceneObjectSelect";
import { useScenePick } from "./ScenePickContext";
import { useTaskComposer } from "./TaskComposerContext";
import {
  findSceneOptionForFactId,
  isSceneOptionSelectable,
  sceneSelectionComposerRole,
  type SceneObjectOption,
} from "./sceneObjects";
import styles from "../../App.module.css";

export type MatrixTaskEditPatch = {
  actor?: string;
  target?: string;
  targetFactId?: string;
  actionVerb?: string;
  startSec: number;
  durationSec: number;
  status: SyncBarStatus;
  rowKey: string;
  subLabel?: string;
  dependency?: string;
  dependencyBarId?: string;
  startCondition?: string;
};

type Props = {
  bar?: SyncMatrixBar;
  target?: ManualSyncTarget;
  draft?: MatrixComposerDraft;
  sceneSelectionFactId?: string;
  instructionSeed?: string;
  tickIntervalSec?: number;
  horizonSec?: number;
  onConfirm: (entry: ManualSyncEntry) => void;
  onCancel: () => void;
  onSaveEdit?: (patch: MatrixTaskEditPatch) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onMarkContingent?: () => void;
};

export function MatrixTaskPanel({
  bar,
  target,
  draft,
  sceneSelectionFactId,
  instructionSeed,
  tickIntervalSec = 3600,
  horizonSec = 24 * 3600,
  onConfirm,
  onCancel,
  onSaveEdit,
  onDuplicate,
  onDelete,
  onMarkContingent,
}: Props) {
  const isEdit = Boolean(bar);
  const fieldPrefix = bar ? `task-${bar.id}` : "task-new";
  const composer = useTaskComposer();
  const {
    activeFieldId,
    pickMessage,
    options,
  } = useScenePick();

  const [selectedActionId, setSelectedActionId] = useState<string>();
  const [selectedDependencyId, setSelectedDependencyId] = useState<string>();
  const [startTick, setStartTick] = useState(() =>
    bar
      ? formatMatrixTick(bar.startSec, tickIntervalSec)
      : draft
        ? formatMatrixTick(draft.startSec, tickIntervalSec)
        : formatMatrixTick(0, tickIntervalSec)
  );
  const [endTick, setEndTick] = useState(() =>
    bar
      ? formatMatrixTick(bar.startSec + bar.durationSec, tickIntervalSec)
      : draft
        ? formatMatrixTick(draft.startSec + tickIntervalSec, tickIntervalSec)
        : formatMatrixTick(tickIntervalSec, tickIntervalSec)
  );
  const [startSec, setStartSec] = useState(
    () => bar?.startSec ?? draft?.startSec ?? 0
  );
  const [status, setStatus] = useState<SyncBarStatus>(bar?.status ?? "planned");
  const [dependency, setDependency] = useState(bar?.dependencyLabels[0] ?? "");
  const [dependencyBarId, setDependencyBarId] = useState(
    bar?.dependencies[0] && (bar?.dependencyLabels.length ?? 0) > 0
      ? bar.dependencies[0]
      : undefined
  );
  const [startCondition, setStartCondition] = useState(bar?.startCondition ?? "");
  const [rowKey, setRowKey] = useState<SyncGridRowKey>(
    (bar?.rowKey as SyncGridRowKey) ?? draft?.rowKey ?? "maneuver::main-effort"
  );
  const [rowKeyTouched, setRowKeyTouched] = useState(false);
  const [instruction, setInstruction] = useState("");
  const instructionSeedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!instructionSeed || instructionSeedRef.current === instructionSeed) return;
    setInstruction(instructionSeed);
    instructionSeedRef.current = instructionSeed;
  }, [instructionSeed]);

  const loadTargetSeedRef = useRef(composer.loadTargetSeed);
  loadTargetSeedRef.current = composer.loadTargetSeed;

  useEffect(() => {
    if (!target || isEdit) return;
    loadTargetSeedRef.current(target);
  }, [target, isEdit]);

  const barId = bar?.id;
  const draftAnchor = draft ? `${draft.rowKey}:${draft.startSec}` : null;
  const loadFromBarRef = useRef(composer.loadFromBar);
  loadFromBarRef.current = composer.loadFromBar;
  const resetComposerRef = useRef(composer.reset);
  resetComposerRef.current = composer.reset;

  useEffect(() => {
    if (bar) {
      loadFromBarRef.current(bar);
      setStartSec(bar.startSec);
      setStartTick(formatMatrixTick(bar.startSec, tickIntervalSec));
      setEndTick(formatMatrixTick(bar.startSec + bar.durationSec, tickIntervalSec));
      setStatus(bar.status);
      setDependency(bar.dependencyLabels[0] ?? "");
      setDependencyBarId(
        bar.dependencies[0] && bar.dependencyLabels.length > 0
          ? bar.dependencies[0]
          : undefined
      );
      setStartCondition(bar.startCondition ?? "");
      setRowKey((bar.rowKey as SyncGridRowKey) ?? "maneuver::main-effort");
      setRowKeyTouched(false);
      return;
    }

    resetComposerRef.current();
    if (draft) {
      setStartSec(draft.startSec);
      setStartTick(formatMatrixTick(draft.startSec, tickIntervalSec));
      setEndTick(formatMatrixTick(draft.startSec + tickIntervalSec, tickIntervalSec));
      setRowKey(draft.rowKey);
      setRowKeyTouched(false);
    } else {
      setStartSec(0);
      setStartTick(formatMatrixTick(0, tickIntervalSec));
      setEndTick(formatMatrixTick(tickIntervalSec, tickIntervalSec));
    }
  }, [bar, barId, draft, draftAnchor, tickIntervalSec]);

  const seededSceneFactRef = useRef<string | null>(null);
  useEffect(() => {
    if (isEdit || !sceneSelectionFactId) {
      seededSceneFactRef.current = null;
      return;
    }
    if (seededSceneFactRef.current === sceneSelectionFactId) return;
    const option = findSceneOptionForFactId(sceneSelectionFactId, options);
    if (!option) return;
    const role = sceneSelectionComposerRole(option);
    if (role === "actor") {
      if (isSceneOptionSelectable(option, "controllable", ["contact", "asset", "fact"])) {
        composer.setActorFromOption(option);
        seededSceneFactRef.current = sceneSelectionFactId;
      }
      return;
    }
    if (isSceneOptionSelectable(option, "objective", ["fact", "contact", "task"])) {
      composer.setTargetFromOption(option);
      seededSceneFactRef.current = sceneSelectionFactId;
    }
  }, [
    isEdit,
    sceneSelectionFactId,
    options,
    composer.setActorFromOption,
    composer.setTargetFromOption,
  ]);

  const actor = composer.actor?.entity ?? "";
  const targetEntity = composer.target?.entity ?? "";
  const action = composer.action;

  const manualTarget = useMemo((): ManualSyncTarget | undefined => {
    if (!composer.target) return undefined;
    return {
      factId: composer.target.factId ?? `scene-${composer.target.entity}`,
      entity: composer.target.entity,
      domain: composer.target.domain,
      event: composer.target.subtitle,
    };
  }, [composer.target]);

  const nlInstruction = useMemo(() => {
    if (instruction.trim()) return instruction.trim();
    const parts = [
      actor.trim(),
      action.trim(),
      targetEntity.trim(),
      startTick.trim() && endTick.trim() ? `from ${startTick} to ${endTick}` : "",
      dependency.trim() ? `after ${dependency.trim()}` : "",
    ].filter(Boolean);
    return parts.join(" ");
  }, [actor, action, targetEntity, startTick, endTick, dependency, instruction]);

  const parsed = useMemo(
    () =>
      parseManualInstruction(
        nlInstruction,
        manualTarget,
        actor,
        rowKeyTouched ? rowKey : undefined
      ),
    [nlInstruction, manualTarget, actor, rowKey, rowKeyTouched]
  );

  useEffect(() => {
    if (rowKeyTouched || isEdit || !nlInstruction.trim()) return;
    setRowKey((current) => (current === parsed.rowKey ? current : parsed.rowKey));
  }, [parsed.rowKey, rowKeyTouched, nlInstruction, isEdit]);

  const composerRef = useRef(composer);
  composerRef.current = composer;

  const pickActor = useCallback((option: SceneObjectOption) => {
    composerRef.current.setActorFromOption(option);
  }, []);

  const pickAction = useCallback((option: SceneObjectOption) => {
    setSelectedActionId(option.id);
    composerRef.current.setAction(option.event ?? option.entity);
  }, []);

  const pickTarget = useCallback((option: SceneObjectOption) => {
    composerRef.current.setTargetFromOption(option);
  }, []);

  const pickDependency = useCallback((option: SceneObjectOption) => {
    setSelectedDependencyId(option.id);
    setDependency(option.kind === "task" ? option.label : option.event ?? option.entity);
    setDependencyBarId(resolveDependencyBarId(option));
  }, []);

  const pickTrigger = useCallback((option: SceneObjectOption) => {
    const label = option.event ?? option.entity;
    setStartCondition(/^(after|before|when)\b/i.test(label) ? label : `After ${label}`);
  }, []);

  const canSave = Boolean(
    actor.trim() && action.trim() && targetEntity.trim() && startTick && endTick
  );

  const buildTimingPatch = () => {
    const parsedStart = parseMissionTickToSec(startTick, tickIntervalSec) ?? startSec;
    const parsedEnd = parseMissionTickToSec(endTick, tickIntervalSec);
    if (parsedEnd === undefined || parsedEnd <= parsedStart) return null;
    return {
      startSec: parsedStart,
      durationSec: Math.max(60, parsedEnd - parsedStart),
      endTimeLabel: endTick,
    };
  };

  const handlePrimary = () => {
    if (!canSave) return;
    const timing = buildTimingPatch();
    if (!timing) return;

    if (isEdit && bar && onSaveEdit) {
      onSaveEdit({
        actor,
        target: targetEntity,
        targetFactId: composer.target?.factId,
        actionVerb: action,
        startSec: timing.startSec,
        durationSec: timing.durationSec,
        status,
        rowKey,
        subLabel: formatMatrixRowOption(rowKey),
        dependency: dependency.trim() || undefined,
        dependencyBarId,
        startCondition: startCondition.trim() || undefined,
      });
      return;
    }

    const entry = buildManualEntryFromStructuredFields({
      actor,
      actionVerb: action,
      target: targetEntity,
      targetFactId: composer.target?.factId,
      rowKey: rowKeyTouched ? rowKey : parsed.rowKey,
      startSec: timing.startSec,
      durationSec: timing.durationSec,
      endTimeLabel: timing.endTimeLabel,
      dependency,
      dependencyBarId,
      instruction: nlInstruction.trim() || undefined,
      entryId: draft?.entryId,
    });
    onConfirm(entry);
    composer.reset();
  };

  const pickBanner =
    composer.pickModeLabel || (pickMessage && activeFieldId?.startsWith(fieldPrefix) ? pickMessage : null);

  return (
    <section
      className={styles.manualAuthorPanel}
      aria-label={isEdit ? "Edit matrix task" : "Create matrix task"}
    >
      <div className={styles.manualAuthorHeader}>
        <strong>{isEdit ? "Edit matrix task" : "New matrix task"}</strong>
        {isEdit && bar ? (
          <span className={styles.matrixTaskOriginBadge}>{originLabel(bar.origin)}</span>
        ) : null}
        <button type="button" className={styles.headerButton} onClick={onCancel}>
          {isEdit ? "Clear" : "Cancel"}
        </button>
      </div>

      <p className={styles.manualAuthorHint}>
        {isEdit ? (
          <>
            Editing <strong>{bar?.label}</strong>. Use <strong>Map</strong> on a field, then click
            the map.
          </>
        ) : draft ? (
          <>
            New task at <strong>{formatMatrixRowOption(draft.rowKey)}</strong> ·{" "}
            <strong>{formatMatrixTick(draft.startSec, tickIntervalSec)}</strong>
          </>
        ) : (
          <>Pick actor, action, and target. Set timing with the dropdowns below.</>
        )}
      </p>

      {pickBanner ? <p className={styles.mapPickBanner}>{pickBanner}</p> : null}

      {composer.preview?.statusLabel && !isEdit ? (
        <div className={styles.mapPreviewStatus}>
          <span>Map Preview</span>
          <strong>{composer.preview.statusLabel}</strong>
        </div>
      ) : null}

      <div className={styles.matrixTaskFormGrid}>
        <SceneObjectSelect
          fieldId={`${fieldPrefix}-actor`}
          label="Acting unit"
          value={actor}
          selectedOptionId={composer.actor?.optionId}
          onPick={pickActor}
          kinds={["contact", "asset"]}
          selectableRole="controllable"
          placeholder="Select unit…"
        />
        <SceneObjectSelect
          fieldId={`${fieldPrefix}-action`}
          label="Action"
          value={action}
          selectedOptionId={selectedActionId}
          onPick={pickAction}
          kinds={["verb"]}
          placeholder="Select action…"
          showMapPickButton={false}
        />
        <SceneObjectSelect
          fieldId={`${fieldPrefix}-target`}
          label="Target / objective"
          value={targetEntity}
          selectedOptionId={composer.target?.optionId}
          onPick={pickTarget}
          kinds={["fact", "contact", "task"]}
          selectableRole="objective"
          placeholder="Select target…"
        />
        <MatrixTickSelect
          label="Start"
          value={startTick}
          tickIntervalSec={tickIntervalSec}
          horizonSec={horizonSec}
          onChange={(label, sec) => {
            setStartTick(label);
            if (sec !== undefined) setStartSec(sec);
            const endParsed = parseMissionTickToSec(endTick, tickIntervalSec);
            if (endParsed !== undefined && sec !== undefined && endParsed <= sec) {
              setEndTick(formatMatrixTick(sec + tickIntervalSec, tickIntervalSec));
            }
          }}
        />
        <MatrixTickSelect
          label="End"
          value={endTick}
          tickIntervalSec={tickIntervalSec}
          horizonSec={horizonSec}
          minSec={startSec + tickIntervalSec}
          onChange={(label) => setEndTick(label)}
        />
        <label className={styles.manualAuthorField}>
          <span>Matrix row</span>
          <select
            value={rowKey}
            onChange={(e) => {
              setRowKeyTouched(true);
              setRowKey(e.target.value as SyncGridRowKey);
            }}
          >
            {SYNC_GRID_TASK_ROWS.map((row) => (
              <option key={row.rowKey} value={row.rowKey}>
                {formatMatrixRowOption(row.rowKey)}
              </option>
            ))}
          </select>
        </label>
        <SceneObjectSelect
          fieldId={`${fieldPrefix}-dependency`}
          label="Dependency"
          value={dependency}
          selectedOptionId={selectedDependencyId}
          onPick={pickDependency}
          kinds={["task"]}
          placeholder="Select matrix task…"
          showMapPickButton={false}
        />
        {isEdit ? (
          <>
            <SceneObjectSelect
              fieldId={`${fieldPrefix}-trigger`}
              label="Trigger / start condition"
              value={startCondition.replace(/^After\s+/i, "")}
              onPick={pickTrigger}
              kinds={["task", "fact", "verb"]}
              selectableRole="objective"
              placeholder="Select trigger…"
            />
            <label className={styles.manualAuthorField}>
              <span>Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as SyncBarStatus)}
              >
                <option value="planned">Planned</option>
                <option value="active">Active</option>
                <option value="complete">Complete</option>
                <option value="delayed">Delayed</option>
                <option value="blocked">Blocked</option>
                <option value="contingent">Contingent</option>
              </select>
            </label>
          </>
        ) : null}
      </div>

      {!isEdit ? (
        <label className={styles.manualAuthorField}>
          <span>Natural-language instruction (optional)</span>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            placeholder="ISR maintain contact from H+02 to H+06."
          />
        </label>
      ) : null}

      {isEdit && bar && bar.missingFields.length > 0 ? (
        <p className={styles.manualAuthorMissing}>
          Needs: {bar.missingFields.join(", ")}
        </p>
      ) : null}

      {!isEdit && nlInstruction.trim() && parsed.missingFields.length > 0 ? (
        <p className={styles.manualAuthorMissing}>
          Missing: {parsed.missingFields.join(", ")}
        </p>
      ) : null}

      <div className={styles.manualAuthorActions}>
        <button
          type="button"
          className={styles.flowPrimaryButton}
          onClick={handlePrimary}
          disabled={!canSave}
        >
          {isEdit ? "Save task" : "Add to Matrix"}
        </button>
        {isEdit && bar?.isManual && onDuplicate ? (
          <button type="button" className={styles.headerButton} onClick={onDuplicate}>
            Duplicate
          </button>
        ) : null}
        {isEdit && onMarkContingent ? (
          <button type="button" className={styles.headerButton} onClick={onMarkContingent}>
            Mark contingent
          </button>
        ) : null}
        {isEdit && onDelete ? (
          <button type="button" className={styles.headerButton} onClick={onDelete}>
            Delete
          </button>
        ) : null}
        <button type="button" className={styles.headerButton} onClick={onCancel}>
          {isEdit ? "Clear" : "Cancel"}
        </button>
      </div>
    </section>
  );
}
