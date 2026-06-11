import { describe, expect, it } from "vitest";
import { POLICY_SHADOW_FIXTURES } from "../../../src/intel/policyShadowEval";
import { runRedTeamChallenge } from "./redTeamAgent";

describe("redTeamAgent", () => {
  it("generates adversarial challenge from base scenario", () => {
    const fixture = POLICY_SHADOW_FIXTURES[0]!;
    const challenge = runRedTeamChallenge({
      baseScenarioId: fixture.id,
      packet: fixture.packet,
    });
    expect(challenge.challengeId).toMatch(/^red-/);
    expect(challenge.forgedScenarios.length).toBeGreaterThan(0);
    expect(challenge.assumptionAttacked.length).toBeGreaterThan(10);
  });
});
