import { describe, expect, it } from "vitest";
import type { ExecutedCoaSnapshot } from "../../coa/types";
import { buildExecutionEventsAtTime, mergeTimelineItems } from "./timelineItems";
import type { MessageTrafficItem } from "./types";

function snapshot(): ExecutedCoaSnapshot {
  return {
    candidateId: "coa-1",
    revisionId: "rev-1",
    label: "COA Alpha",
    origin: "automated",
    executedAt: "2026-06-04T12:00:00.000Z",
    orderSet: {
      revisionId: "rev-1",
      actionCount: 2,
      tasks: [
        {
          id: "t1",
          actionId: "a1",
          label: "Strike",
          startSec: 0,
          durationSec: 300,
          actor: "wing-a",
          target: "port",
          status: "planned",
          origin: "system",
          dependencies: [],
          isManual: false,
        },
        {
          id: "t2",
          actionId: "a2",
          label: "Disrupt",
          startSec: 180,
          durationSec: 300,
          actor: "cyber",
          target: "node",
          status: "planned",
          origin: "system",
          dependencies: [],
          isManual: false,
        },
      ],
    },
    evidenceSnapshotId: "ev-1",
  };
}

describe("buildExecutionEventsAtTime", () => {
  it("includes only tasks at or before the playhead", () => {
    const tasks = snapshot().orderSet.tasks;
    const atZero = buildExecutionEventsAtTime(snapshot(), tasks, 0);
    expect(atZero.some((e) => e.id.endsWith("-task-t1"))).toBe(true);
    expect(atZero.some((e) => e.id.endsWith("-task-t2"))).toBe(false);

    const atThree = buildExecutionEventsAtTime(snapshot(), tasks, 180);
    expect(atThree.some((e) => e.id.endsWith("-task-t2"))).toBe(true);
  });

  it("orders newest task events before the commit line", () => {
    const events = buildExecutionEventsAtTime(snapshot(), snapshot().orderSet.tasks, 300);
    expect(events[0]?.id).toContain("-task-t2");
    expect(events.at(-1)?.id).toContain("-start");
  });
});

describe("mergeTimelineItems", () => {
  it("dedupes by id and keeps execution events first", () => {
    const exec: MessageTrafficItem[] = [
      {
        id: "exec-a",
        time: "12:00",
        kind: "ops",
        channel: "orders",
        severity: "info",
        text: "exec",
        offsetSec: 0,
      },
    ];
    const report: MessageTrafficItem[] = [
      {
        id: "fact-1",
        time: "11:59",
        kind: "track",
        channel: "contact",
        severity: "info",
        text: "contact",
      },
      {
        id: "exec-a",
        time: "12:00",
        kind: "ops",
        channel: "orders",
        severity: "info",
        text: "duplicate",
      },
    ];
    const merged = mergeTimelineItems(exec, report);
    expect(merged.map((item) => item.id)).toEqual(["exec-a", "fact-1"]);
  });
});
