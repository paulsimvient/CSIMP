import type { SyncMatrixBar, SyncMatrixRow } from "../../coa/syncMatrix";

export type MatrixLayoutDensity = "compact" | "expanded";

const HEADER_HEIGHT = 38;
const META_ROW_HEIGHT = 38;
const DECISION_ROW_HEIGHT = 44;
const SECTION_ROW_HEIGHT = 36;
const SECTION_ROW_COLLAPSED_HEIGHT = 28;

function taskRowHeight(density: MatrixLayoutDensity): number {
  return density === "compact" ? 30 : 44;
}

/** Row center Y positions for the fully expanded matrix grid (grid-local coordinates). */
export function computeMatrixRowCenters(
  rows: SyncMatrixRow[],
  density: MatrixLayoutDensity
): Map<string, number> {
  const centers = new Map<string, number>();
  const taskHeight = taskRowHeight(density);
  let y = HEADER_HEIGHT;

  for (const row of rows) {
    if (row.kind === "meta") {
      y += META_ROW_HEIGHT;
      continue;
    }
    if (row.kind === "decision") {
      centers.set(row.id, y + DECISION_ROW_HEIGHT / 2);
      y += DECISION_ROW_HEIGHT;
      continue;
    }
    if (row.kind === "section") {
      y += SECTION_ROW_HEIGHT;
      continue;
    }
    if (row.kind === "task") {
      centers.set(row.id, y + taskHeight / 2);
      y += taskHeight;
    }
  }

  return centers;
}

export function computeBarHorizontalAnchors(
  bar: SyncMatrixBar,
  tickIntervalSec: number,
  tickCount: number,
  tickWidth: number,
  labelWidth: number
): { left: number; right: number } {
  const startCol = Math.min(
    tickCount,
    Math.max(1, Math.round(bar.startSec / tickIntervalSec) + 1)
  );
  const span = Math.max(
    1,
    Math.min(tickCount - startCol + 1, Math.round(bar.durationSec / tickIntervalSec))
  );
  const left = labelWidth + (startCol - 1) * tickWidth;
  const right = labelWidth + (startCol - 1 + span) * tickWidth;
  return { left, right };
}

export function findMatrixBar(
  barId: string,
  rows: SyncMatrixRow[]
): { bar: SyncMatrixBar; row: SyncMatrixRow } | undefined {
  for (const row of rows) {
    const bar = row.bars.find((item) => item.id === barId);
    if (bar) return { bar, row };
  }
  return undefined;
}

/** Sections that contain tasks linked by dependency connectors. */
export function dependencyLinkedSectionIds(rows: SyncMatrixRow[]): Set<string> {
  const linked = new Set<string>();
  const barSection = new Map<string, string>();

  for (const row of rows) {
    if (row.kind !== "task" || !row.sectionId) continue;
    for (const bar of row.bars) {
      barSection.set(bar.id, row.sectionId);
      if (bar.dependencies.length > 0) linked.add(row.sectionId);
    }
  }

  for (const row of rows) {
    if (row.kind !== "task" || !row.sectionId) continue;
    for (const bar of row.bars) {
      for (const depId of bar.dependencies) {
        const sourceSection = barSection.get(depId);
        if (sourceSection) linked.add(sourceSection);
        linked.add(row.sectionId);
      }
    }
  }

  return linked;
}

export function buildDependencyPaths(input: {
  rows: SyncMatrixRow[];
  tickIntervalSec: number;
  tickCount: number;
  tickWidth: number;
  labelWidth: number;
  density: MatrixLayoutDensity;
  gridRect: DOMRect;
  barElements: Map<string, HTMLButtonElement>;
}): string[] {
  const rowCenters = computeMatrixRowCenters(input.rows, input.density);
  const paths: string[] = [];

  for (const row of input.rows) {
    for (const bar of row.bars) {
      for (const depId of bar.dependencies) {
        const source = findMatrixBar(depId, input.rows);
        if (!source) continue;

        const fromEl = input.barElements.get(depId);
        const toEl = input.barElements.get(bar.id);

        let x1: number;
        let y1: number;
        let x2: number;
        let y2: number;

        if (fromEl && toEl) {
          const from = fromEl.getBoundingClientRect();
          const to = toEl.getBoundingClientRect();
          x1 = from.right - input.gridRect.left;
          y1 = from.top + from.height / 2 - input.gridRect.top;
          x2 = to.left - input.gridRect.left;
          y2 = to.top + to.height / 2 - input.gridRect.top;
        } else {
          const fromAnchors = computeBarHorizontalAnchors(
            source.bar,
            input.tickIntervalSec,
            input.tickCount,
            input.tickWidth,
            input.labelWidth
          );
          const toAnchors = computeBarHorizontalAnchors(
            bar,
            input.tickIntervalSec,
            input.tickCount,
            input.tickWidth,
            input.labelWidth
          );
          x1 = fromAnchors.right;
          x2 = toAnchors.left;
          y1 = rowCenters.get(source.row.id) ?? 0;
          y2 = rowCenters.get(row.id) ?? 0;
        }

        const midX = (x1 + x2) / 2;
        paths.push(`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
      }
    }
  }

  return paths;
}
