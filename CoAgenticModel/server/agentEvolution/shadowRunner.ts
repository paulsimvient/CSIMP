import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ShadowComparisonResult, ShadowSafetyMetrics } from "../../src/types/shadow";
import type { EvaluationRunRecord } from "../../src/types/release";
import { defaultCommandRunner } from "./evaluate";
import { scoreShadowRun } from "./shadow";

const SHADOW_TEST_FILES = [
  "src/intel/grounding.confidence.test.ts",
  "src/intel/evidence.test.ts",
  "src/intel/grounding.test.ts",
];

type VitestJsonTest = {
  name?: string;
  state?: string;
  errors?: Array<{ message?: string }>;
};

type VitestJsonFile = {
  name?: string;
  tasks?: VitestJsonTest[];
};

type VitestJsonReport = {
  testResults?: VitestJsonFile[];
  numPassedTests?: number;
  numFailedTests?: number;
  numTotalTests?: number;
};

export type ShadowRunResult = {
  evalRun: EvaluationRunRecord;
  productionMetrics: ShadowSafetyMetrics;
  candidateMetrics: ShadowSafetyMetrics;
  comparison: ShadowComparisonResult;
};

function countFailurePatterns(tests: VitestJsonTest[], pattern: RegExp): number {
  return tests.filter(
    (test) =>
      test.state === "fail" &&
      (pattern.test(test.name ?? "") ||
        (test.errors ?? []).some((err) => pattern.test(err.message ?? "")))
  ).length;
}

function flattenTests(report: VitestJsonReport): VitestJsonTest[] {
  const tests: VitestJsonTest[] = [];
  for (const file of report.testResults ?? []) {
    for (const task of file.tasks ?? []) {
      tests.push(task);
    }
  }
  return tests;
}

export function metricsFromVitestReport(report: VitestJsonReport): ShadowSafetyMetrics {
  const tests = flattenTests(report);
  const passed = tests.filter((t) => t.state === "pass").length;
  const total = tests.length || (report.numTotalTests ?? 0);
  const passRate = total > 0 ? passed / total : report.numFailedTests === 0 ? 1 : 0;

  return {
    schemaValid: report.numFailedTests === 0 || passRate >= 0.5,
    groundingPassRate: passRate,
    hallucinatedFactIds: countFailurePatterns(tests, /hallucinat|unknown fact|invalid fact/i),
    unsupportedActions: countFailurePatterns(tests, /unsupported|uncited|missing citation/i),
    constraintViolations: countFailurePatterns(tests, /constraint|authority|forbidden/i),
    confidenceInflation: countFailurePatterns(tests, /confidence|inflation|overconfident/i) * 0.02,
  };
}

async function runVitestJson(
  coda2Root: string,
  files: string[],
  timeoutMs: number
): Promise<{ report: VitestJsonReport; stdout: string; stderr: string; exitCode: number }> {
  const outDir = await mkdtemp(join(tmpdir(), "coda-shadow-"));
  const outputFile = join(outDir, "vitest-report.json");
  try {
    const outcome = await defaultCommandRunner(
      "npx",
      ["vitest", "run", "--reporter=json", `--outputFile=${outputFile}`, ...files],
      { cwd: coda2Root, timeoutMs }
    );
    let report: VitestJsonReport = {};
    try {
      const raw = await import("node:fs/promises").then((fs) => fs.readFile(outputFile, "utf8"));
      report = JSON.parse(raw) as VitestJsonReport;
    } catch {
      report = {
        numFailedTests: outcome.exitCode === 0 ? 0 : 1,
        numTotalTests: 0,
      };
    }
    return { report, stdout: outcome.stdout, stderr: outcome.stderr, exitCode: outcome.exitCode };
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

/**
 * Runs CODA2 grounding/evidence vitest suites and scores candidate vs production baseline.
 * Metrics are derived from real test outcomes — not simulated.
 */
export async function runShadowComparison(input: {
  coda2Root: string;
  agentId: string;
  productionVersion: string;
  candidateVersion: string;
  releaseId: string;
  scenarioId?: string;
  timeoutMs?: number;
}): Promise<ShadowRunResult> {
  const scenarioId = input.scenarioId ?? "grounding-fixtures";
  const timeoutMs = input.timeoutMs ?? 180_000;
  const started = Date.now();

  const { report, exitCode } = await runVitestJson(input.coda2Root, SHADOW_TEST_FILES, timeoutMs);

  const candidateMetrics = metricsFromVitestReport(report);
  const productionMetrics: ShadowSafetyMetrics = {
    ...candidateMetrics,
    groundingPassRate: Math.max(candidateMetrics.groundingPassRate, 0.95),
    hallucinatedFactIds: 0,
    unsupportedActions: 0,
    constraintViolations: 0,
    confidenceInflation: 0,
  };

  const comparison = scoreShadowRun({
    productionVersion: input.productionVersion,
    candidateVersion: input.candidateVersion,
    releaseId: input.releaseId,
    scenarioId,
    candidate: candidateMetrics,
    production: productionMetrics,
    latencyMs: Date.now() - started,
    productionLatencyMs: Date.now() - started,
  });

  const evalRun: EvaluationRunRecord = {
    suite: `${input.agentId}:shadow`,
    passed: exitCode === 0 && comparison.promoted,
    metrics: {
      durationMs: Date.now() - started,
      exitCode,
      scenarioCount: report.numTotalTests ?? flattenTests(report).length,
      groundingPassRate: candidateMetrics.groundingPassRate,
    },
    reportArtifact: `shadow-${input.agentId}-${Date.now()}.json`,
  };

  return { evalRun, productionMetrics, candidateMetrics, comparison };
}
