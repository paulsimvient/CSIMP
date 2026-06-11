import { describe, expect, it } from "vitest";
import { evaluatePolicyCoherence } from "./policyCoherence";
import { join } from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

async function seedRegistry(
  root: string,
  agentId: string,
  version: string,
  rules: string[]
) {
  const policyDir = join(root, "CoAgenticModel", "registry", "agents", agentId, version, "policies");
  await mkdir(policyDir, { recursive: true });
  await writeFile(
    join(policyDir, "attribution.json"),
    JSON.stringify({ agentId, version, rules }, null, 2)
  );
}

describe("evaluatePolicyCoherence", () => {
  it("flags rules already present in base version", async () => {
    const root = await mkdtemp(join(tmpdir(), "coherence-"));
    await seedRegistry(root, "intel-interpreter", "1.0.0", [
      "Do not infer attribution from a single degraded source.",
    ]);

    const findings = await evaluatePolicyCoherence({
      repoRoot: root,
      agentId: "intel-interpreter",
      baseVersion: "1.0.0",
      objective: "Tighten attribution after eval-run-188",
      evidenceRefs: ["eval-run-188"],
      policyChanges: [
        {
          path: "policies/agents/intel-interpreter/attribution.json",
          operation: "add-rule",
          rule: "Do not infer attribution from a single degraded source.",
        },
      ],
    });

    expect(findings.some((f) => f.code === "policy.rule-already-present")).toBe(true);
  });

  it("flags duplicate rules within the same proposal", async () => {
    const root = await mkdtemp(join(tmpdir(), "coherence-"));
    await seedRegistry(root, "intel-interpreter", "1.0.0", []);

    const findings = await evaluatePolicyCoherence({
      repoRoot: root,
      agentId: "intel-interpreter",
      baseVersion: "1.0.0",
      objective: "Add corroboration guardrail",
      evidenceRefs: ["eval-1"],
      policyChanges: [
        {
          path: "policies/agents/intel-interpreter/attribution.json",
          operation: "add-rule",
          rule: "Require two sources.",
        },
        {
          path: "policies/agents/intel-interpreter/attribution.json",
          operation: "add-rule",
          rule: "Require two sources.",
        },
      ],
    });

    expect(findings.some((f) => f.code === "policy.duplicate-in-proposal")).toBe(true);
  });
});
