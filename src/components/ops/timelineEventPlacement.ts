import { parseMissionOffsetSec } from "../../coa/manualSync";
import { parseMatrixTickToSec } from "../../coa/matrixTimeScale";
import type { MessageTrafficItem } from "./types";

/** Resolve mission-time seconds for placing an event marker on the sync matrix. */
export function resolveTimelineEventOffsetSec(
  item: MessageTrafficItem,
  index: number
): number {
  if (item.offsetSec != null && item.offsetSec >= 0) return item.offsetSec;

  const atMatch = item.text.match(/@\s*H\+(\d+)m/i);
  if (atMatch) return Number(atMatch[1]) * 60;

  const fromText = parseMissionOffsetSec(item.text);
  if (fromText !== undefined) return fromText;

  const fromTime =
    parseMissionOffsetSec(item.time) ?? parseMatrixTickToSec(item.time);
  if (fromTime !== undefined) return fromTime;

  return Math.min(index * 45, 4 * 60);
}

export function timelineEventShape(
  item: MessageTrafficItem
): "dot" | "block" {
  if (item.kind === "ops") return "block";
  return "dot";
}
