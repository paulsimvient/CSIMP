import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExecutedCoaSnapshot, ValidatedOrderSetTask } from "../../coa/types";
import { msPerMissionSecondForPlayback } from "../../scene/executionPlaybackScale";
import { buildExecutionEventsAtTime } from "./timelineItems";
import type { MessageTrafficItem } from "./types";

function sortedTasks(snapshot: ExecutedCoaSnapshot): ValidatedOrderSetTask[] {
  return [...snapshot.orderSet.tasks].sort((left, right) => left.startSec - right.startSec);
}

export function playbackHorizonSec(tasks: ValidatedOrderSetTask[]): number {
  if (tasks.length === 0) return 60;
  return Math.max(
    60,
    ...tasks.map((task) => task.startSec + Math.max(task.durationSec, 1))
  );
}

function activeTasksAtTime(
  tasks: ValidatedOrderSetTask[],
  playbackTimeSec: number
): Set<string> {
  return new Set(
    tasks
      .filter(
        (task) =>
          playbackTimeSec >= task.startSec &&
          playbackTimeSec < task.startSec + Math.max(task.durationSec, 1)
      )
      .map((task) => task.id)
  );
}

function completedTasksAtTime(
  tasks: ValidatedOrderSetTask[],
  playbackTimeSec: number
): Set<string> {
  return new Set(
    tasks
      .filter(
        (task) => playbackTimeSec >= task.startSec + Math.max(task.durationSec, 1)
      )
      .map((task) => task.id)
  );
}

type PlaybackClock = {
  wallAnchorMs: number;
  missionAnchorSec: number;
  msPerMissionSec: number;
};

function missionTimeAt(clock: PlaybackClock, wallMs = performance.now()): number {
  return clock.missionAnchorSec + (wallMs - clock.wallAnchorMs) / clock.msPerMissionSec;
}

export type ExecutionPlaybackStatus = {
  phase: "idle" | "playing" | "paused" | "committed";
  taskTotal: number;
  taskActiveCount: number;
  currentTaskLabel?: string;
  coaLabel?: string;
  revisionId?: string;
  playbackTimeSec: number;
  playbackHorizonSec: number;
};

export function useExecutionPlayback(executedSnapshot: ExecutedCoaSnapshot | undefined): {
  executionEvents: MessageTrafficItem[];
  activeExecutionTaskIds: Set<string>;
  completedExecutionTaskIds: Set<string>;
  playbackTimeSec: number;
  isPlaying: boolean;
  isScrubbing: boolean;
  playbackStatus: ExecutionPlaybackStatus;
  seekPlaybackTime: (timeSec: number) => void;
  togglePlayback: () => void;
} {
  const [executionEvents, setExecutionEvents] = useState<MessageTrafficItem[]>([]);
  const [playbackTimeSec, setPlaybackTimeSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [currentTaskLabel, setCurrentTaskLabel] = useState<string | undefined>();
  const horizonSecRef = useRef(60);
  const rafIdRef = useRef(0);
  const isPlayingRef = useRef(false);
  const clockRef = useRef<PlaybackClock>({
    wallAnchorMs: 0,
    missionAnchorSec: 0,
    msPerMissionSec: 16.67,
  });
  const snapshotRef = useRef<ExecutedCoaSnapshot | undefined>();
  const tasksRef = useRef<ValidatedOrderSetTask[]>([]);

  const stopRaf = useCallback(() => {
    if (rafIdRef.current) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
  }, []);

  const syncTaskState = useCallback((nextTime: number, snapshot: ExecutedCoaSnapshot) => {
    const tasks = tasksRef.current;
    setPlaybackTimeSec(nextTime);
    const active = activeTasksAtTime(tasks, nextTime);
    const activeTask = tasks.find((task) => active.has(task.id));
    setCurrentTaskLabel(activeTask?.label);
    setExecutionEvents(buildExecutionEventsAtTime(snapshot, tasks, nextTime));
  }, []);

  const runTickLoop = useCallback(() => {
    stopRaf();

    const tick = () => {
      if (!isPlayingRef.current) return;
      const snapshot = snapshotRef.current;
      if (!snapshot) return;

      const horizonSec = horizonSecRef.current;
      const nextTime = Math.min(missionTimeAt(clockRef.current), horizonSec);
      syncTaskState(nextTime, snapshot);

      if (nextTime >= horizonSec) {
        isPlayingRef.current = false;
        setIsPlaying(false);
        setIsPaused(false);
        setIsScrubbing(false);
        setCurrentTaskLabel(undefined);
        syncTaskState(horizonSec, snapshot);
        return;
      }

      rafIdRef.current = window.requestAnimationFrame(tick);
    };

    rafIdRef.current = window.requestAnimationFrame(tick);
  }, [stopRaf, syncTaskState]);

  const startPlaybackFrom = useCallback(
    (missionSec: number) => {
      const snapshot = snapshotRef.current;
      if (!snapshot || tasksRef.current.length === 0) return;

      const horizonSec = horizonSecRef.current;
      const fromSec = Math.max(0, Math.min(missionSec, horizonSec));
      clockRef.current = {
        wallAnchorMs: performance.now(),
        missionAnchorSec: fromSec,
        msPerMissionSec: clockRef.current.msPerMissionSec,
      };

      setIsScrubbing(false);
      setIsPaused(false);
      isPlayingRef.current = true;
      setIsPlaying(true);
      syncTaskState(fromSec, snapshot);
      runTickLoop();
    },
    [runTickLoop, syncTaskState]
  );

  const pausePlayback = useCallback(() => {
    if (!isPlayingRef.current) return;
    const snapshot = snapshotRef.current;
    if (!snapshot) return;

    const current = Math.min(missionTimeAt(clockRef.current), horizonSecRef.current);
    clockRef.current = {
      ...clockRef.current,
      wallAnchorMs: performance.now(),
      missionAnchorSec: current,
    };
    stopRaf();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setIsPaused(true);
    syncTaskState(current, snapshot);
  }, [stopRaf, syncTaskState]);

  useEffect(() => {
    stopRaf();
    isPlayingRef.current = false;

    if (!executedSnapshot) {
      snapshotRef.current = undefined;
      tasksRef.current = [];
      setExecutionEvents([]);
      setPlaybackTimeSec(0);
      setIsPlaying(false);
      setIsPaused(false);
      setCurrentTaskLabel(undefined);
      setIsScrubbing(false);
      return;
    }

    const tasks = sortedTasks(executedSnapshot);
    const horizonSec = playbackHorizonSec(tasks);
    const msPerMissionSec = msPerMissionSecondForPlayback(horizonSec);

    snapshotRef.current = executedSnapshot;
    tasksRef.current = tasks;
    horizonSecRef.current = horizonSec;
    clockRef.current = {
      wallAnchorMs: performance.now(),
      missionAnchorSec: 0,
      msPerMissionSec,
    };

    setExecutionEvents(buildExecutionEventsAtTime(executedSnapshot, tasks, 0));
    setPlaybackTimeSec(0);
    setIsPaused(false);
    setIsScrubbing(false);
    setCurrentTaskLabel(undefined);

    if (tasks.length === 0) {
      setIsPlaying(false);
      return;
    }

    startPlaybackFrom(0);

    return stopRaf;
  }, [executedSnapshot?.revisionId, executedSnapshot?.executedAt, startPlaybackFrom, stopRaf]);

  const tasks = useMemo(
    () => (executedSnapshot ? sortedTasks(executedSnapshot) : []),
    [executedSnapshot]
  );
  const horizonSec = useMemo(() => playbackHorizonSec(tasks), [tasks]);

  useEffect(() => {
    horizonSecRef.current = horizonSec;
  }, [horizonSec]);

  const seekPlaybackTime = useCallback(
    (timeSec: number) => {
      const snapshot = snapshotRef.current;
      if (!snapshot) return;

      stopRaf();
      isPlayingRef.current = false;
      setIsPlaying(false);
      setIsScrubbing(true);
      setIsPaused(false);

      const clamped = Math.max(0, Math.min(timeSec, horizonSecRef.current));
      clockRef.current = {
        ...clockRef.current,
        wallAnchorMs: performance.now(),
        missionAnchorSec: clamped,
      };
      syncTaskState(clamped, snapshot);
    },
    [stopRaf, syncTaskState]
  );

  const togglePlayback = useCallback(() => {
    if (!snapshotRef.current || tasksRef.current.length === 0) return;

    if (isPlayingRef.current) {
      pausePlayback();
      return;
    }

    const horizon = horizonSecRef.current;
    const resumeFrom = clockRef.current.missionAnchorSec;
    startPlaybackFrom(resumeFrom >= horizon - 0.001 ? 0 : resumeFrom);
  }, [pausePlayback, startPlaybackFrom]);

  const activeExecutionTaskIds = useMemo(
    () => activeTasksAtTime(tasks, playbackTimeSec),
    [tasks, playbackTimeSec]
  );

  const completedExecutionTaskIds = useMemo(
    () => completedTasksAtTime(tasks, playbackTimeSec),
    [tasks, playbackTimeSec]
  );

  const playbackStatus = useMemo((): ExecutionPlaybackStatus => {
    if (!executedSnapshot) {
      return {
        phase: "idle",
        taskTotal: 0,
        taskActiveCount: 0,
        playbackTimeSec: 0,
        playbackHorizonSec: 60,
      };
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
        playbackTimeSec,
        playbackHorizonSec: horizonSec,
      };
    }
    if (isPaused || isScrubbing) {
      const activeLabel = tasks.find((task) => activeExecutionTaskIds.has(task.id))?.label;
      return {
        phase: isPaused ? "paused" : "playing",
        taskTotal,
        taskActiveCount,
        currentTaskLabel: activeLabel ?? currentTaskLabel,
        coaLabel: executedSnapshot.label,
        revisionId: executedSnapshot.revisionId,
        playbackTimeSec,
        playbackHorizonSec: horizonSec,
      };
    }
    return {
      phase: "committed",
      taskTotal,
      taskActiveCount: activeExecutionTaskIds.size,
      coaLabel: executedSnapshot.label,
      revisionId: executedSnapshot.revisionId,
      playbackTimeSec: horizonSec,
      playbackHorizonSec: horizonSec,
    };
  }, [
    executedSnapshot,
    isPlaying,
    isPaused,
    isScrubbing,
    activeExecutionTaskIds,
    currentTaskLabel,
    playbackTimeSec,
    horizonSec,
    tasks,
  ]);

  return {
    executionEvents,
    activeExecutionTaskIds,
    completedExecutionTaskIds,
    playbackTimeSec,
    isPlaying,
    isScrubbing,
    playbackStatus,
    seekPlaybackTime,
    togglePlayback,
  };
}
