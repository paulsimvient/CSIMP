import { spawn } from "node:child_process";
import type { ParsedAgentPatchProposal } from "./proposalSchema";
import type { EvaluationRunRecord } from "../../src/types/release";
import { runAgentModuleEval } from "./agentModuleEval";

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number }
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export type EvaluationOptions = {
  repoRoot: string;
  timeoutMs?: number;
  runCommand?: CommandRunner;
  suites?: string[];
};

const DEFAULT_SUITES = ["typecheck", "test", "build"] as const;

export async function defaultCommandRunner(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      env: {
        ...process.env,
        CI: "1",
        NODE_ENV: "test",
      },
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${options.timeoutMs}ms: ${command}`));
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function suiteCommand(suite: string, repoRoot: string): { cmd: string; args: string[] } | null {
  const isCoAgentic = repoRoot.endsWith("CoAgenticModel");
  switch (suite) {
    case "typecheck":
      return { cmd: "npm", args: ["run", "typecheck"] };
    case "test":
      return { cmd: "npm", args: ["test"] };
    case "build":
      return isCoAgentic ? null : { cmd: "npm", args: ["run", "build"] };
    case "regression":
      return { cmd: "npm", args: ["run", "eval:agents", "--", "--suite", "regression"] };
    case "adversarial":
      return { cmd: "npm", args: ["run", "eval:agents", "--", "--suite", "adversarial"] };
    default:
      return null;
  }
}

export async function evaluateProposal(
  proposal: ParsedAgentPatchProposal,
  options: EvaluationOptions
): Promise<EvaluationRunRecord[]> {
  if (proposal.changeTier === "agent-module" && proposal.changedFiles.length > 0) {
    return runAgentModuleEval(proposal, options.repoRoot, options.timeoutMs);
  }

  const run = options.runCommand ?? defaultCommandRunner;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const suites = options.suites ?? [...DEFAULT_SUITES];
  const results: EvaluationRunRecord[] = [];

  for (const suite of suites) {
    const spec = suiteCommand(suite, options.repoRoot);
    if (!spec) continue;

    const started = Date.now();
    try {
      const outcome = await run(spec.cmd, spec.args, {
        cwd: options.repoRoot,
        timeoutMs,
      });
      results.push({
        suite,
        passed: outcome.exitCode === 0,
        metrics: {
          durationMs: Date.now() - started,
          exitCode: outcome.exitCode,
        },
        reportArtifact: `eval-${suite}-${Date.now()}.log`,
      });
    } catch (err) {
      results.push({
        suite,
        passed: false,
        metrics: {
          durationMs: Date.now() - started,
          exitCode: 1,
        },
        reportArtifact: `eval-${suite}-error.log`,
      });
      if (err instanceof Error) {
        results[results.length - 1]!.metrics.errorMessage = err.message.length;
      }
    }
  }

  return results;
}

export function allEvaluationsPassed(runs: EvaluationRunRecord[]): boolean {
  return runs.length > 0 && runs.every((run) => run.passed);
}
