import { describe, expect, it } from "vitest";
import { resolveTimelineEventOffsetSec, timelineEventShape } from "./timelineEventPlacement";
import type { MessageTrafficItem } from "./types";

function item(partial: Partial<MessageTrafficItem> & Pick<MessageTrafficItem, "id">): MessageTrafficItem {
  return {
    time: "08:00:00",
    kind: "track",
    channel: "contact",
    severity: "info",
    text: "sample",
    ...partial,
  };
}

describe("resolveTimelineEventOffsetSec", () => {
  it("uses explicit offsetSec when provided", () => {
    expect(
      resolveTimelineEventOffsetSec(item({ id: "a", offsetSec: 900 }), 0)
    ).toBe(900);
  });

  it("parses H+ from task active text", () => {
    expect(
      resolveTimelineEventOffsetSec(
        item({ id: "b", text: "TASK ACTIVE: foo @ H+15m" }),
        0
      )
    ).toBe(900);
  });

  it("staggers clock-only events", () => {
    expect(resolveTimelineEventOffsetSec(item({ id: "c" }), 2)).toBe(90);
  });
});

describe("timelineEventShape", () => {
  it("uses blocks for ops events", () => {
    expect(timelineEventShape(item({ id: "d", kind: "ops" }))).toBe("block");
  });

  it("uses dots for track events", () => {
    expect(timelineEventShape(item({ id: "e", kind: "track" }))).toBe("dot");
  });
});
