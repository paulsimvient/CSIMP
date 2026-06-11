import type { EvaluationRunRecord } from "../../src/types/release";
import type { ParsedAgentPatchProposal } from "./proposalSchema";
import { defaultCommandRunner } from "./evaluate";

const DEFAULT_AGENT_TEST_FILES: Record<string, string[]> = {
  "intel-interpreter": ["CoAgenticModel/src/agents/intelInterpreter/index.test.ts"],
};

export function resolveAgentModuleTestFiles(proposal: ParsedAgentPatchProposal): string[] {
  const files = new Set<string>();

  for (const testPath of proposal.testsAddedOrChanged) {
    if (testPath.trim()) files.add(testPath.replace(/\\/g, "/"));
  }

  for (const file of proposal.changedFiles) {
    const normalized = file.path.replace(/\\/g, "/");
    if (/\.test\.(ts|tsx)$/.test(normalized)) {
      files.add(normalized);
    }
    const sibling = normalized.replace(/\.ts$/, ".test.ts");
    if (sibling !== normalized) files.add(sibling);
  }

  if (files.size === 0) {
    for (const path of DEFAULT_AGENT_TEST_FILES[proposal.targetAgentId] ?? []) {
      files.add(path);
    }
  }

  return [...files];
}

export async function runAgentModuleEval(
  proposal: ParsedAgentPatchProposal,
  repoRoot: string,
  timeoutMs = 180_000
): Promise<EvaluationRunRecord[]> {
  const testFiles = resolveAgentModuleTestFiles(proposal);
  if (testFiles.length === 0) {
    return [
      {
        suite: `${proposal.targetAgentId}:agent-module`,
        passed: false,
        metrics: { durationMs: 0, exitCode: 1 },
        reportArtifact: "agent-module-no-tests.log",
      },
    ];
  }

  const started = Date.now();
  try {
    const outcome = await defaultCommandRunner(
      "npm",
      ["test", "--", ...testFiles],
      { cwd: repoRoot, timeoutMs }
    );
    return [
      {
        suite: `${proposal.targetAgentId}:agent-module`,
        passed: outcome.exitCode === 0,
        metrics: {
          durationMs: Date.now() - started,
          exitCode: outcome.exitCode,
          scenarioCount: testFiles.length,
        },
        reportArtifact: `agent-module-${proposal.proposalId}.log`,
      },
    ];
  } catch (err) {
    return [
      {
        suite: `${proposal.targetAgentId}:agent-module`,
        passed: false,
        metrics: {
          durationMs: Date.now() - started,
          exitCode: 1,
          scenarioCount: testFiles.length,
          errorMessage: err instanceof Error ? err.message.length : 1,
        },
        reportArtifact: `agent-module-${proposal.proposalId}-error.log`,
      },
    ];
  }
}
