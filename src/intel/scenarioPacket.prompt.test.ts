import { describe, expect, it } from "vitest";
import { buildInterpreterPrompt, buildScenarioPacket } from "./scenarioPacket";

describe("registry system prompt", () => {
  it("prepends agentSystemPrompt to interpreter prompt", () => {
    const { packet } = buildScenarioPacket(
      {
        commanderIntent: "Defend port",
        facts: [
          {
            id: "fact_1",
            domain: "UAS",
            entity: "Port",
            event: "Contact",
            time: "12:00",
            source: "radar",
            confidence: "high",
            severity: "medium",
          },
        ],
        knownAssets: [],
        agentSystemPrompt:
          "You are the intel interpretation agent for CODA2.\nNever bypass grounding validation.",
      },
      { includeLowConfidence: true }
    );

    const prompt = buildInterpreterPrompt(packet);
    expect(prompt).toContain("You are the intel interpretation agent for CODA2.");
    expect(prompt).toContain("Never bypass grounding validation");
  });
});
