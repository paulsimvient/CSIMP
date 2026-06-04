import { describe, expect, it } from "vitest";
import { stubPortAFacts } from "../intel/factSets";
import { normalizeFactsForTheater } from "./theater";

describe("theater provenance", () => {
  it("marks scenario demo facts and coordinate resolution types", () => {
    const facts = normalizeFactsForTheater(
      stubPortAFacts().map((fact) => ({ ...fact, sourceType: "scenario-demo" as const }))
    );
    expect(facts.every((fact) => fact.sourceType === "scenario-demo")).toBe(true);
    expect(facts.every((fact) => fact.coordinateType !== undefined)).toBe(true);
    expect(facts.some((fact) => fact.coordinateType === "reported")).toBe(true);

    const [sample] = stubPortAFacts();
    const derived = normalizeFactsForTheater([
      {
        ...sample!,
        coordinates: undefined,
        sourceType: "scenario-demo",
      },
    ]);
    expect(derived[0]?.coordinateType === "derived" || derived[0]?.coordinateType === "stub").toBe(
      true
    );
  });
});
