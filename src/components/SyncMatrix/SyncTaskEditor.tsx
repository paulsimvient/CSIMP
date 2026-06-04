import { useCallback, useState } from "react";
import {
  formatMatrixTick,
  parseMissionTickToSec,
  type SyncBarStatus,
  type SyncMatrixBar,
} from "../../coa/syncMatrix";
import { MatrixTickSelect } from "../ops/MatrixTickSelect";
import {
  formatMatrixRowOption,
  SYNC_GRID_TASK_ROWS,
  type SyncGridRowKey,
} from "../../coa/syncGridSchema";
import { originLabel, resolveDependencyBarId } from "../../coa/manualSync";
import { SceneObjectSelect } from "../ops/SceneObjectSelect";
import type { SceneObjectOption } from "../ops/sceneObjects";
import styles from "./SyncMatrix.module.css";

type Props = {
  bar: SyncMatrixBar;
  tickIntervalSec: number;
  horizonSec?: number;
  embedded?: boolean;
  onSave: (patch: {
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
  }) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMarkContingent: () => void;
  onClose: () => void;
};

export function SyncTaskEditor({
  bar,
  tickIntervalSec,
  horizonSec = 24 * 3600,
  embedded = false,
  onSave,
  onDuplicate,
  onDelete,
  onMarkContingent,
  onClose,
}: Props) {
  const [actor, setActor] = useState(bar.actor ?? bar.resourceLabel ?? "");
  const [target, setTarget] = useState(bar.target ?? "");
  const [targetFactId, setTargetFactId] = useState(bar.targetFactIds?.[0]);
  const [actionVerb, setActionVerb] = useState(bar.actionVerb ?? "");
  const [startTick, setStartTick] = useState(
    formatMatrixTick(bar.startSec, tickIntervalSec)
  );
  const [endTick, setEndTick] = useState(
    formatMatrixTick(bar.startSec + bar.durationSec, tickIntervalSec)
  );
  const [startSec, setStartSec] = useState(bar.startSec);
  const [status, setStatus] = useState<SyncBarStatus>(bar.status);
  const [rowKey, setRowKey] = useState<SyncGridRowKey>(
    (bar.rowKey as SyncGridRowKey) ?? "maneuver::main-effort"
  );
  const [dependency, setDependency] = useState(bar.dependencyLabels[0] ?? "");
  const [dependencyBarId, setDependencyBarId] = useState(
    bar.dependencies[0] && bar.dependencyLabels.length > 0 ? bar.dependencies[0] : undefined
  );
  const [startCondition, setStartCondition] = useState(bar.startCondition ?? "");
  const [selectedActorId, setSelectedActorId] = useState<string | undefined>();
  const [selectedTargetId, setSelectedTargetId] = useState<string | undefined>();
  const [selectedActionId, setSelectedActionId] = useState<string | undefined>();

  const pickActor = useCallback((option: SceneObjectOption) => {
    setActor(option.entity);
    setSelectedActorId(option.id);
  }, []);

  const pickAction = useCallback((option: SceneObjectOption) => {
    setActionVerb(option.event ?? option.entity);
    setSelectedActionId(option.id);
  }, []);

  const pickTarget = useCallback((option: SceneObjectOption) => {
    setTarget(option.entity);
    setSelectedTargetId(option.id);
    setTargetFactId(
      option.factId ??
        (option.kind === "fact" ? option.id.replace(/^fact:/, "") : undefined)
    );
  }, []);

  const pickDependency = useCallback((option: SceneObjectOption) => {
    setDependency(option.kind === "task" ? option.label : option.event ?? option.entity);
    setDependencyBarId(resolveDependencyBarId(option));
  }, []);

  const pickTrigger = useCallback((option: SceneObjectOption) => {
    const label = option.event ?? option.entity;
    setStartCondition(
      /^(after|before|when)\b/i.test(label) ? label : `After ${label}`
    );
  }, []);

  const save = () => {
    const startSec = parseMissionTickToSec(startTick, tickIntervalSec) ?? bar.startSec;
    const endSec =
      parseMissionTickToSec(endTick, tickIntervalSec) ?? bar.startSec + bar.durationSec;
    onSave({
      actor,
      target,
      targetFactId,
      actionVerb,
      startSec,
      durationSec: Math.max(60, endSec - startSec),
      status,
      rowKey,
      subLabel: formatMatrixRowOption(rowKey),
      dependency: dependency.trim() || undefined,
      dependencyBarId,
      startCondition: startCondition.trim() || undefined,
    });
  };

  const shellClass = embedded ? styles.editorEmbedded : styles.editorBackdrop;
  const cardClass = embedded ? styles.editorEmbeddedCard : styles.editorCard;

  return (
    <div
      className={shellClass}
      role={embedded ? "region" : "dialog"}
      aria-label="Edit matrix task"
    >
      <div className={cardClass}>
        <div className={styles.editorHeader}>
          <strong>Edit matrix task</strong>
          <span className={styles.originBadge}>{originLabel(bar.origin)}</span>
          {!embedded ? (
            <button type="button" className={styles.toolBtn} onClick={onClose}>
              Close
            </button>
          ) : (
            <button type="button" className={styles.toolBtn} onClick={onClose}>
              Clear
            </button>
          )}
        </div>

        <p className={styles.editorMeta}>
          Focus a field or click <strong>Map</strong>, then click a track on the map. The map
          stays clickable while the editor is open.
        </p>

        <div className={styles.editorGrid}>
          <SceneObjectSelect
            fieldId={`editor-actor-${bar.id}`}
            label="Acting unit"
            value={actor}
            selectedOptionId={selectedActorId}
            onPick={pickActor}
            kinds={["contact", "asset"]}
            selectableRole="controllable"
            placeholder="Select unit…"
            fieldClassName={styles.editorField}
          />
          <SceneObjectSelect
            fieldId={`editor-action-${bar.id}`}
            label="Action"
            value={actionVerb}
            selectedOptionId={selectedActionId}
            onPick={pickAction}
            kinds={["verb"]}
            placeholder="Select action…"
            fieldClassName={styles.editorField}
            showMapPickButton={false}
          />
          <SceneObjectSelect
            fieldId={`editor-target-${bar.id}`}
            label="Target / objective"
            value={target}
            selectedOptionId={selectedTargetId}
            onPick={pickTarget}
            kinds={["fact", "contact", "task"]}
            selectableRole="objective"
            placeholder="Select target…"
            fieldClassName={styles.editorField}
          />
          <MatrixTickSelect
            label="Start"
            value={startTick}
            tickIntervalSec={tickIntervalSec}
            horizonSec={horizonSec}
            onChange={(label, sec) => {
              setStartTick(label);
              if (sec !== undefined) {
                setStartSec(sec);
                const endParsed = parseMissionTickToSec(endTick, tickIntervalSec);
                if (endParsed !== undefined && endParsed <= sec) {
                  setEndTick(formatMatrixTick(sec + tickIntervalSec, tickIntervalSec));
                }
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
          <label>
            Matrix row
            <select value={rowKey} onChange={(e) => setRowKey(e.target.value as SyncGridRowKey)}>
              {SYNC_GRID_TASK_ROWS.map((row) => (
                <option key={row.rowKey} value={row.rowKey}>
                  {formatMatrixRowOption(row.rowKey)}
                </option>
              ))}
            </select>
          </label>
          <SceneObjectSelect
            fieldId={`editor-dependency-${bar.id}`}
            label="Dependency"
            value={dependency}
            onPick={pickDependency}
            kinds={["task"]}
            placeholder="Select matrix task…"
            fieldClassName={styles.editorField}
            showMapPickButton={false}
          />
          <SceneObjectSelect
            fieldId={`editor-trigger-${bar.id}`}
            label="Trigger / start condition"
            value={startCondition.replace(/^After\s+/i, "")}
            onPick={pickTrigger}
            kinds={["task", "fact", "verb"]}
            selectableRole="objective"
            placeholder="Select trigger…"
            fieldClassName={styles.editorField}
          />
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as SyncBarStatus)}>
              <option value="planned">Planned</option>
              <option value="active">Active</option>
              <option value="complete">Complete</option>
              <option value="delayed">Delayed</option>
              <option value="blocked">Blocked</option>
              <option value="contingent">Contingent</option>
            </select>
          </label>
        </div>

        <p className={styles.editorMeta}>
          {bar.sourceLabel ? `Source: ${bar.sourceLabel}` : "Source: user matrix"}
          {bar.operationalFunction ? ` · Row: ${bar.operationalFunction}` : ""}
          {bar.missingFields.length > 0 ? ` · Missing: ${bar.missingFields.join(", ")}` : ""}
        </p>

        <div className={styles.editorActions}>
          <button type="button" className={styles.toolBtnPrimary} onClick={save}>
            Save
          </button>
          {bar.isManual && (
            <button type="button" className={styles.toolBtn} onClick={onDuplicate}>
              Duplicate
            </button>
          )}
          <button type="button" className={styles.toolBtn} onClick={onMarkContingent}>
            Mark contingent
          </button>
          <button type="button" className={styles.toolBtn} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
