import { describe, expect, it } from "vitest";
import { evaluatePathPolicy, scanPatchContent } from "./policy";

describe("evaluatePathPolicy", () => {
  it("allows Tier A policy paths", () => {
    const result = evaluatePathPolicy(
      ["policies/agents/intel-interpreter/attribution.json"],
      "policy-update"
    );
    expect(result.allowed).toBe(true);
  });

  it("blocks server paths for agent-module tier", () => {
    const result = evaluatePathPolicy(["server/llmProxy.ts"], "agent-module");
    expect(result.allowed).toBe(false);
    expect(result.errors.some((e) => e.includes("Blocked path"))).toBe(true);
  });

  it("allows src/agents paths for agent-module tier", () => {
    const result = evaluatePathPolicy(
      ["src/agents/intelInterpreter/index.ts", "src/agents/intelInterpreter/index.test.ts"],
      "agent-module"
    );
    expect(result.allowed).toBe(true);
  });

  it("blocks cyber emulation without elevation", () => {
    const result = evaluatePathPolicy(
      ["src/coa/cyberEmulation/adapter.ts"],
      "shared-infrastructure"
    );
    expect(result.allowed).toBe(false);
  });
});

describe("scanPatchContent", () => {
  it("rejects eval in patches", () => {
    const result = scanPatchContent([
      { path: "src/agents/foo/index.ts", patch: "eval('bad')" },
    ]);
    expect(result.allowed).toBe(false);
  });
});
