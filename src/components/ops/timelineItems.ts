import type { ExecutedCoaSnapshot, ValidatedOrderSetTask } from "../../coa/types";
import { formatClock } from "./formatClock";
import type { MessageTrafficItem } from "./types";

/** Execution-side events that should exist at a given mission-time playhead. */
export function buildExecutionEventsAtTime(
  snapshot: ExecutedCoaSnapshot,
  tasks: ValidatedOrderSetTask[],
  timeSec: number
): MessageTrafficItem[] {
  const clamped = Math.max(0, timeSec);
  const events: MessageTrafficItem[] = [
    {
      id: `exec-${snapshot.revisionId}-start`,
      time: formatClock(snapshot.executedAt),
      kind: "ops",
      channel: "orders",
      severity: "info",
      text: `COA EXEC COMMIT: ${snapshot.label} — ${tasks.length} task${tasks.length === 1 ? "" : "s"} on order`,
      offsetSec: 0,
    },
  ];

  for (const task of tasks) {
    if (task.startSec > clamped) continue;
    events.push({
      id: `exec-${snapshot.revisionId}-task-${task.id}`,
      time: formatClock(new Date().toISOString()),
      kind: "ops",
      channel: "orders",
      severity: "info",
      text: `TASK ACTIVE: ${task.label} — ${task.actor ?? "unit"} → ${task.target ?? "objective"} @ H+${Math.floor(task.startSec / 60)}m`,
      factId: task.targetFactIds?.[0],
      offsetSec: task.startSec,
    });
  }

  // Newest mission events first for feeds; commit line stays oldest in the exec block.
  return events.reverse();
}

/** Merge execution + situational feeds for matrix markers and workflow event panels. */
export function mergeTimelineItems(
  executionEvents: MessageTrafficItem[],
  reportWindowItems: MessageTrafficItem[]
): MessageTrafficItem[] {
  const seen = new Set<string>();
  const merged: MessageTrafficItem[] = [];
  for (const item of [...executionEvents, ...reportWindowItems]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}
