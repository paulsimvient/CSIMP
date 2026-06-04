import { useEffect, useMemo, useState } from "react";
import type { ExecutedCoaSnapshot } from "../../coa/types";
import { formatClock } from "./formatClock";
import type { MessageTrafficItem } from "./types";

const TASK_EVENT_DELAY_MS = 900;

export type ExecutionPlaybackStatus = {
  phase: "idle" | "playing" | "committed";
  taskTotal: number;
  taskActiveCount: number;
  currentTaskLabel?: string;
  coaLabel?: string;
  revisionId?: string;
};

export function useExecutionPlayback(executedSnapshot: ExecutedCoaSnapshot | undefined): {
  executionEvents: MessageTrafficItem[];
  activeExecutionTaskIds: Set<string>;
  isPlaying: boolean;
  playbackStatus: ExecutionPlaybackStatus;
} {
  const [executionEvents, setExecutionEvents] = useState<MessageTrafficItem[]>([]);
  const [activeExecutionTaskIds, setActiveExecutionTaskIds] = useState<Set<string>>(new Set());
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTaskLabel, setCurrentTaskLabel] = useState<string | undefined>();

  useEffect(() => {
    if (!executedSnapshot) {
      setExecutionEvents([]);
      setActiveExecutionTaskIds(new Set());
      setIsPlaying(false);
      setCurrentTaskLabel(undefined);
      return;
    }

    const tasks = [...executedSnapshot.orderSet.tasks].sort(
      (left, right) => left.startSec - right.startSec
    );
    const startEvent: MessageTrafficItem = {
      id: `exec-${executedSnapshot.revisionId}-start`,
      time: formatClock(executedSnapshot.executedAt),
      kind: "ops",
      channel: "orders",
      severity: "info",
      text: `COA EXEC COMMIT: ${executedSnapshot.label} — ${tasks.length} task${tasks.length === 1 ? "" : "s"} on order`,
    };

    setExecutionEvents([startEvent]);
    setActiveExecutionTaskIds(new Set());
    setIsPlaying(true);
    setCurrentTaskLabel(undefined);

    const timers: number[] = [];
    for (const [index, task] of tasks.entries()) {
      const timer = window.setTimeout(() => {
        setCurrentTaskLabel(task.label);
        setExecutionEvents((current) => [
          {
            id: `exec-${executedSnapshot.revisionId}-task-${task.id}`,
            time: formatClock(new Date().toISOString()),
            kind: "ops",
            channel: "orders",
            severity: "info",
            text: `TASK ACTIVE: ${task.label} — ${task.actor ?? "unit"} → ${task.target ?? "objective"} @ H+${Math.floor(task.startSec / 60)}m`,
            factId: task.targetFactIds?.[0],
          },
          ...current,
        ]);
        setActiveExecutionTaskIds((current) => new Set([...current, task.id]));
        if (index === tasks.length - 1) {
          window.setTimeout(() => {
            setIsPlaying(false);
            setCurrentTaskLabel(undefined);
          }, TASK_EVENT_DELAY_MS);
        }
      }, 350 + index * TASK_EVENT_DELAY_MS);
      timers.push(timer);
    }

    if (tasks.length === 0) {
      setIsPlaying(false);
    }

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [
    executedSnapshot?.revisionId,
    executedSnapshot?.executedAt,
    executedSnapshot?.label,
    executedSnapshot?.orderSet.tasks,
  ]);

  const playbackStatus = useMemo((): ExecutionPlaybackStatus => {
    if (!executedSnapshot) {
      return { phase: "idle", taskTotal: 0, taskActiveCount: 0 };
    }
    const taskTotal = executedSnapshot.orderSet.tasks.length;
    const taskActiveCount = activeExecutionTaskIds.size;
    if (isPlaying) {
      return {
        phase: "playing",
        taskTotal,
        taskActiveCount,
        currentTaskLabel,
        coaLabel: executedSnapshot.label,
        revisionId: executedSnapshot.revisionId,
      };
    }
    return {
      phase: "committed",
      taskTotal,
      taskActiveCount,
      coaLabel: executedSnapshot.label,
      revisionId: executedSnapshot.revisionId,
    };
  }, [executedSnapshot, isPlaying, activeExecutionTaskIds, currentTaskLabel]);

  return { executionEvents, activeExecutionTaskIds, isPlaying, playbackStatus };
}
