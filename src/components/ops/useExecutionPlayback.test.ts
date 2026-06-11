import { describe, expect, it } from "vitest";
import { playbackHorizonSec } from "./useExecutionPlayback";

describe("playbackHorizonSec", () => {
  it("extends to the last task end time", () => {
    expect(
      playbackHorizonSec([
        {
          id: "a",
          startSec: 300,
          durationSec: 600,
        } as never,
      ])
    ).toBe(900);
  });
});
