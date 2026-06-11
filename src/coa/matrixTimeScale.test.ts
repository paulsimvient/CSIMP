import { describe, expect, it } from "vitest";
import {
  buildMatrixTickOptions,
  formatMatrixTick,
  formatMissionTick,
  formatRelativeMissionTick,
  formatRelativeColumnTick,
  resolveNowColumnIndex,
  playheadWithinColumnRatio,
  missionSecToTimelineRatio,
  columnIndexToTimelineRatio,
  matrixTimeUnitForInterval,
  parseMatrixTickToSec,
  parseMissionTickToSec,
  resolveDefaultTimeScale,
  SEC_PER_DAY,
  SEC_PER_HOUR,
  SEC_PER_MINUTE,
  SEC_PER_WEEK,
} from "./matrixTimeScale";

describe("matrixTimeScale", () => {
  it("formats axis labels per tick step", () => {
    expect(formatMatrixTick(0, SEC_PER_MINUTE)).toBe("M+00");
    expect(formatMatrixTick(15 * SEC_PER_MINUTE, 15 * SEC_PER_MINUTE)).toBe("M+15");
    expect(formatMatrixTick(2 * SEC_PER_HOUR, SEC_PER_HOUR)).toBe("H+02");
    expect(formatMatrixTick(3 * SEC_PER_DAY, SEC_PER_DAY)).toBe("D+03");
    expect(formatMatrixTick(2 * SEC_PER_WEEK, SEC_PER_WEEK)).toBe("W+02");
  });

  it("parses matrix and legacy mission tick labels", () => {
    expect(parseMatrixTickToSec("W+02")).toBe(2 * SEC_PER_WEEK);
    expect(parseMatrixTickToSec("D+01")).toBe(SEC_PER_DAY);
    expect(parseMatrixTickToSec("H+03")).toBe(3 * SEC_PER_HOUR);
    expect(parseMatrixTickToSec("M+20")).toBe(20 * SEC_PER_MINUTE);
    expect(parseMissionTickToSec("H+15")).toBe(15 * SEC_PER_MINUTE);
    expect(parseMissionTickToSec("H+02", SEC_PER_HOUR)).toBe(2 * SEC_PER_HOUR);
  });

  it("picks default scale from plan span", () => {
    expect(resolveDefaultTimeScale(30 * SEC_PER_MINUTE).unit).toBe("minute");
    expect(resolveDefaultTimeScale(8 * SEC_PER_HOUR).unit).toBe("hour");
    expect(resolveDefaultTimeScale(5 * SEC_PER_DAY).unit).toBe("day");
    expect(resolveDefaultTimeScale(30 * SEC_PER_DAY).unit).toBe("week");
  });

  it("keeps legacy mission minute formatter", () => {
    expect(formatMissionTick(15 * SEC_PER_MINUTE)).toBe("H+15");
  });

  it("rebases axis labels to current sim time at H+00", () => {
    const origin = 5 * SEC_PER_MINUTE;
    expect(formatRelativeMissionTick(origin, origin)).toBe("H+00");
    expect(formatRelativeMissionTick(origin + 3 * SEC_PER_MINUTE, origin)).toBe("H+03");
    expect(formatRelativeMissionTick(origin - 2 * SEC_PER_MINUTE, origin)).toBe("H-02");
  });

  it("aligns relative column headers with the playhead column", () => {
    const interval = SEC_PER_MINUTE;
    const playheadSec = 3 * SEC_PER_MINUTE + 40;
    const now = resolveNowColumnIndex(playheadSec, interval, 8);
    expect(now).toBe(3);
    expect(formatRelativeColumnTick(3, now, interval)).toBe("H+00");
    expect(formatRelativeColumnTick(1, now, interval)).toBe("H-02");
    expect(formatRelativeColumnTick(5, now, interval)).toBe("H+02");
    expect(playheadWithinColumnRatio(playheadSec, now, interval)).toBeCloseTo(40 / 60);
    expect(missionSecToTimelineRatio(3 * SEC_PER_MINUTE, 8 * SEC_PER_MINUTE)).toBe(0.375);
    expect(columnIndexToTimelineRatio(3, interval, 8 * SEC_PER_MINUTE)).toBe(0.375);
  });

  it("classifies tick interval into unit", () => {
    expect(matrixTimeUnitForInterval(SEC_PER_MINUTE)).toBe("minute");
    expect(matrixTimeUnitForInterval(SEC_PER_HOUR)).toBe("hour");
    expect(matrixTimeUnitForInterval(SEC_PER_DAY)).toBe("day");
    expect(matrixTimeUnitForInterval(SEC_PER_WEEK)).toBe("week");
  });

  it("builds dropdown tick options aligned to matrix step", () => {
    const options = buildMatrixTickOptions(SEC_PER_HOUR, 4 * SEC_PER_HOUR);
    expect(options[0]?.label).toBe("H+00");
    expect(options[1]?.label).toBe("H+01");
    expect(options[options.length - 1]?.label).toBe("H+04");
  });
});
