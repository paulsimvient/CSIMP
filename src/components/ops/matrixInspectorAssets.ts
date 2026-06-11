import type { SyncMatrixBar } from "../../coa/syncMatrix";

export type MatrixAssetStatus = "available" | "assigned" | "active" | "complete";

export type MatrixAssetRow = {
  id: string;
  name: string;
  kind: "known" | "assigned-unit";
  status: MatrixAssetStatus;
  taskLabel?: string;
  taskId?: string;
};

function normalizeAssetKey(value: string): string {
  return value.trim().toLowerCase();
}

function taskLabelForBar(bar: SyncMatrixBar): string {
  const parts = [bar.actionVerb, bar.actor, bar.target].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : bar.label;
}

function statusForBar(
  bar: SyncMatrixBar,
  executionActiveBarIds?: Set<string>,
  executionCompletedBarIds?: Set<string>
): MatrixAssetStatus {
  if (executionActiveBarIds?.has(bar.id)) return "active";
  if (executionCompletedBarIds?.has(bar.id)) return "complete";
  return "assigned";
}

function findBarForActor(actor: string, bars: SyncMatrixBar[]): SyncMatrixBar | undefined {
  const key = normalizeAssetKey(actor);
  return bars.find((bar) => bar.actor && normalizeAssetKey(bar.actor) === key);
}

export function buildMatrixAssetRows(input: {
  knownAssets?: string[];
  bars: SyncMatrixBar[];
  executionActiveBarIds?: Set<string>;
  executionCompletedBarIds?: Set<string>;
}): MatrixAssetRow[] {
  const { knownAssets = [], bars, executionActiveBarIds, executionCompletedBarIds } = input;
  const rows: MatrixAssetRow[] = [];
  const coveredActors = new Set<string>();

  for (const asset of knownAssets) {
    const trimmed = asset.trim();
    if (!trimmed) continue;
    const bar = findBarForActor(trimmed, bars);
    if (bar?.actor) coveredActors.add(normalizeAssetKey(bar.actor));
    rows.push({
      id: `asset:${normalizeAssetKey(trimmed)}`,
      name: trimmed,
      kind: "known",
      status: bar
        ? statusForBar(bar, executionActiveBarIds, executionCompletedBarIds)
        : "available",
      taskLabel: bar ? taskLabelForBar(bar) : undefined,
      taskId: bar?.id,
    });
  }

  for (const bar of bars) {
    const actor = bar.actor?.trim();
    if (!actor) continue;
    const key = normalizeAssetKey(actor);
    if (coveredActors.has(key)) continue;
    coveredActors.add(key);
    rows.push({
      id: `unit:${key}`,
      name: actor,
      kind: "assigned-unit",
      status: statusForBar(bar, executionActiveBarIds, executionCompletedBarIds),
      taskLabel: taskLabelForBar(bar),
      taskId: bar.id,
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function matrixAssetStatusLabel(status: MatrixAssetStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "complete":
      return "Complete";
    case "assigned":
      return "Assigned";
    default:
      return "Available";
  }
}
