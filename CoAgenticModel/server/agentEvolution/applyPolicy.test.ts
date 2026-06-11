import { cp, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyPolicyVersion } from "./applyPolicy";

describe("applyPolicyVersion", () => {
  let tempRoot = "";

  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  });

  it("copies base version and appends policy rules", async () => {
    const packageRoot = join(import.meta.dirname, "../..");
    tempRoot = await mkdtemp(join(tmpdir(), "coagentic-policy-"));
    await mkdir(join(tempRoot, "CoAgenticModel"), { recursive: true });
    await cp(join(packageRoot, "registry"), join(tempRoot, "CoAgenticModel/registry"), {
      recursive: true,
    });

    const written = await applyPolicyVersion(
      tempRoot,
      "intel-interpreter",
      "1.0.0",
      "1.1.0-test",
      [
        {
          path: "policies/agents/intel-interpreter/attribution.json",
          operation: "add-rule",
          rule: "Test-only attribution guardrail.",
        },
      ]
    );

    expect(written.length).toBeGreaterThan(0);
    const policyPath = join(
      tempRoot,
      "CoAgenticModel/registry/agents/intel-interpreter/1.1.0-test/policies/attribution.json"
    );
    const policy = JSON.parse(await readFile(policyPath, "utf8")) as { rules: string[] };
    expect(policy.rules).toContain("Test-only attribution guardrail.");
  });
});
