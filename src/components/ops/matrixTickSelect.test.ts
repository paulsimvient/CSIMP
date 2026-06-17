import { describe, expect, it } from "vitest";
import {
  buildMatrixTickOptions,
  formatMatrixTick,
  parseMissionTickToSec,
  SEC_PER_MINUTE,
} from "../../coa/matrixTimeScale";

describe("matrix task timing labels", () => {
  it("parses M+04 to M+05 as a valid one-minute window", () => {
    const tickIntervalSec = SEC_PER_MINUTE;
    const startSec = parseMissionTickToSec("M+04", tickIntervalSec);
    const endSec = parseMissionTickToSec("M+05", tickIntervalSec);
    expect(startSec).toBe(4 * SEC_PER_MINUTE);
    expect(endSec).toBe(5 * SEC_PER_MINUTE);
    expect(endSec! > startSec!).toBe(true);
  });

  it("keeps off-grid start ticks in selectable options", () => {
    const tickIntervalSec = 15 * SEC_PER_MINUTE;
    const startSec = 4 * SEC_PER_MINUTE;
    const label = formatMatrixTick(startSec, tickIntervalSec);
    const base = buildMatrixTickOptions(tickIntervalSec, 3600).filter(
      (opt) => opt.valueSec >= 0
    );
    expect(base.some((opt) => opt.valueSec === startSec)).toBe(false);
    expect(parseMissionTickToSec(label, tickIntervalSec)).toBe(startSec);
  });
});
