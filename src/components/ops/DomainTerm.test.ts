import { describe, expect, it } from "vitest";
import { DOMAIN_GLOSSARY } from "./DomainTerm";

describe("DomainTerm glossary", () => {
  it("defines plain-language help for core workflow terms", () => {
    expect(Object.keys(DOMAIN_GLOSSARY)).toEqual(
      expect.arrayContaining(["coa", "hPlus", "syncMatrix", "grounding", "rebase"])
    );
    for (const text of Object.values(DOMAIN_GLOSSARY)) {
      expect(text.length).toBeGreaterThan(12);
    }
  });
});
