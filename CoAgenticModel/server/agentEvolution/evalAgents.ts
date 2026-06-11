import type { EvaluationRunRecord } from "../../src/types/release";
import { defaultCommandRunner } from "./evaluate";

export type AgentEvalSuite = "regression" | "adversarial" | "shadow";

const SUITE_FILES: Record<AgentEvalSuite, string[]> = {
  regression: [
    "src/intel/grounding.test.ts",
    "src/intel/interpreter.test.ts",
    "src/schemas/validate.test.ts",
  ],
  adversarial: ["src/coa/adversarial.test.ts", "src/intel/grounding.test.ts"],
  shadow: ["src/intel/grounding.confidence.test.ts", "src/intel/evidence.test.ts"],
};

export type EvalAgentsOptions = {
  coda2Root: string;
  agentId: string;
  suite: AgentEvalSuite;
  timeoutMs?: number;
};

export async function runAgentEvalSuite(
  options: EvalAgentsOptions
): Promise<EvaluationRunRecord> {
  const files = SUITE_FILES[options.suite];
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 180_000;

  try {
    const outcome = await defaultCommandRunner(
      "npm",
      ["test", "--", ...files],
      { cwd: options.coda2Root, timeoutMs }
    );
    return {
      suite: `${options.agentId}:${options.suite}`,
      passed: outcome.exitCode === 0,
      metrics: {
        durationMs: Date.now() - started,
        exitCode: outcome.exitCode,
        scenarioCount: files.length,
      },
      reportArtifact: `eval-${options.agentId}-${options.suite}.log`,
    };
  } catch (err) {
    return {
      suite: `${options.agentId}:${options.suite}`,
      passed: false,
      metrics: {
        durationMs: Date.now() - started,
        exitCode: 1,
        scenarioCount: files.length,
      },
      reportArtifact: `eval-${options.agentId}-${options.suite}-error.log`,
    };
  }
}

export async function runAgentEvalSuites(
  coda2Root: string,
  agentId: string,
  suites: AgentEvalSuite[] = ["regression", "adversarial"]
): Promise<EvaluationRunRecord[]> {
  const results: EvaluationRunRecord[] = [];
  for (const suite of suites) {
    results.push(await runAgentEvalSuite({ coda2Root, agentId, suite }));
  }
  return results;
}
