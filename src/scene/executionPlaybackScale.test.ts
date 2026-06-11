import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYBACK_WALL_DURATION_MS,
  msPerMissionSecondForPlayback,
} from "./executionPlaybackScale";

describe("msPerMissionSecondForPlayback", () => {
  it("targets ~3 minutes of wall time for a typical mission horizon", () => {
    const horizonSec = 75 * 60;
    const msPerSec = msPerMissionSecondForPlayback(horizonSec);
    const wallMs = horizonSec * msPerSec;
    expect(wallMs).toBeCloseTo(DEFAULT_PLAYBACK_WALL_DURATION_MS, -2);
  });

  it("never skims faster than ~1 mission minute per wall second", () => {
    const msPerSec = msPerMissionSecondForPlayback(24 * 60 * 60);
    expect(msPerSec).toBeGreaterThanOrEqual(1000 / 60);
  });

  it("never runs slower than realtime for short horizons", () => {
    const msPerSec = msPerMissionSecondForPlayback(45);
    expect(msPerSec).toBeLessThanOrEqual(1000);
  });
});
