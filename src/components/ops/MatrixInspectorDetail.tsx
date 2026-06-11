import {
  formatMissionAxisTick,
  formatMissionTick,
  syncGridRowLabel,
  type SyncMatrixBar,
} from "../../coa/syncMatrix";
import type { SyncGridRowKey } from "../../coa/syncGridSchema";
import {
  buildMatrixAssetRows,
  matrixAssetStatusLabel,
  type MatrixAssetRow,
} from "./matrixInspectorAssets";
import styles from "./InspectorPanel.module.css";

export type MatrixInspectorContext = {
  coaLabel?: string;
  commanderIntent?: string;
  matrixSubtitle?: string;
  taskCount: number;
  selectedBar?: SyncMatrixBar;
  bars: SyncMatrixBar[];
  knownAssets?: string[];
  executionActiveBarIds?: Set<string>;
  executionCompletedBarIds?: Set<string>;
  executionPlaybackPhase?: "playing" | "paused" | "committed";
  executionPlayheadSec?: number;
  horizonSec?: number;
};

type Props = {
  context: MatrixInspectorContext;
  onSelectTask?: (barId: string) => void;
};

function formatTaskWindow(bar: SyncMatrixBar, playheadSec?: number): string {
  const origin = playheadSec != null ? playheadSec : undefined;
  const start = formatMissionAxisTick(bar.startSec, origin);
  const end = formatMissionAxisTick(bar.startSec + bar.durationSec, origin);
  return `${start} – ${end}`;
}

function AssetStatusCell({ row }: { row: MatrixAssetRow }) {
  const statusClass =
    row.status === "active"
      ? styles.assetStatusActive
      : row.status === "complete"
        ? styles.assetStatusComplete
        : row.status === "assigned"
          ? styles.assetStatusAssigned
          : styles.assetStatusAvailable;
  return <span className={statusClass}>{matrixAssetStatusLabel(row.status)}</span>;
}

export function MatrixInspectorDetail({ context, onSelectTask }: Props) {
  const {
    coaLabel,
    commanderIntent,
    matrixSubtitle,
    taskCount,
    selectedBar,
    bars,
    knownAssets,
    executionActiveBarIds,
    executionCompletedBarIds,
    executionPlaybackPhase,
    executionPlayheadSec,
    horizonSec,
  } = context;

  const assetRows = buildMatrixAssetRows({
    knownAssets,
    bars,
    executionActiveBarIds,
    executionCompletedBarIds,
  });

  const playbackLabel =
    executionPlaybackPhase === "playing"
      ? "Executing"
      : executionPlaybackPhase === "paused"
        ? "Paused"
        : executionPlaybackPhase === "committed"
          ? "Committed"
          : "Planning";

  return (
    <div className={styles.sceneDetail}>
      <div className={styles.sceneDetailHeader}>
        <div>
          <strong>Synchronization Matrix</strong>
          {coaLabel ? <p className={styles.sceneDetailSubtitle}>{coaLabel}</p> : null}
        </div>
      </div>

      <div className={styles.sceneDetailSection}>Information</div>
      <dl className={styles.sceneDetailGrid}>
        <div>
          <dt>Phase</dt>
          <dd>{playbackLabel}</dd>
        </div>
        <div>
          <dt>Tasks</dt>
          <dd>{taskCount}</dd>
        </div>
        <div>
          <dt>Assets</dt>
          <dd>
            {assetRows.filter((row) => row.status !== "available").length} assigned ·{" "}
            {assetRows.filter((row) => row.status === "available").length} available
          </dd>
        </div>
        {executionPlayheadSec != null ? (
          <div>
            <dt>Sim time</dt>
            <dd>NOW · H+00</dd>
          </div>
        ) : horizonSec != null ? (
          <div>
            <dt>Horizon</dt>
            <dd>{formatMissionTick(horizonSec)}</dd>
          </div>
        ) : null}
        {commanderIntent ? (
          <div className={styles.sceneDetailWide}>
            <dt>Commander&apos;s intent</dt>
            <dd>{commanderIntent}</dd>
          </div>
        ) : null}
        {matrixSubtitle ? (
          <div className={styles.sceneDetailWide}>
            <dt>Matrix</dt>
            <dd>{matrixSubtitle}</dd>
          </div>
        ) : null}
      </dl>

      {selectedBar ? (
        <>
          <div className={styles.sceneDetailSection}>Selected task</div>
          <dl className={styles.sceneDetailGrid}>
            <div className={styles.sceneDetailWide}>
              <dt>Action</dt>
              <dd>{selectedBar.actionVerb ?? selectedBar.label}</dd>
            </div>
            <div>
              <dt>Row</dt>
              <dd>{syncGridRowLabel(selectedBar.rowKey as SyncGridRowKey)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{selectedBar.status}</dd>
            </div>
            <div>
              <dt>Actor</dt>
              <dd>{selectedBar.actor ?? "—"}</dd>
            </div>
            <div>
              <dt>Target</dt>
              <dd>{selectedBar.target ?? "—"}</dd>
            </div>
            <div className={styles.sceneDetailWide}>
              <dt>Window</dt>
              <dd>{formatTaskWindow(selectedBar, executionPlayheadSec)}</dd>
            </div>
          </dl>
        </>
      ) : null}

      <div className={styles.sceneDetailSection}>Assets</div>
      {assetRows.length === 0 ? (
        <p className={styles.inspectorEventHint}>No known assets in the scenario packet.</p>
      ) : (
        <div className={styles.assetTableWrap}>
          <table className={styles.assetTable}>
            <thead>
              <tr>
                <th scope="col">Asset</th>
                <th scope="col">Status</th>
                <th scope="col">Task</th>
              </tr>
            </thead>
            <tbody>
              {assetRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className={styles.assetName}>{row.name}</span>
                    {row.kind === "assigned-unit" ? (
                      <span className={styles.assetKindHint}>unit</span>
                    ) : null}
                  </td>
                  <td>
                    <AssetStatusCell row={row} />
                  </td>
                  <td>
                    {row.taskLabel && row.taskId && onSelectTask ? (
                      <button
                        type="button"
                        className={styles.assetTaskLink}
                        onClick={() => onSelectTask(row.taskId!)}
                      >
                        {row.taskLabel}
                      </button>
                    ) : (
                      row.taskLabel ?? "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
