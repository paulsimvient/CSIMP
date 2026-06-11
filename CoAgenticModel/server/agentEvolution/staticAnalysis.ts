import type { ParsedAgentPatchProposal } from "./proposalSchema";
import { scanPatchContent } from "./policy";

export type StaticAnalysisResult = {
  passed: boolean;
  findings: string[];
};

export function runStaticAnalysis(proposal: ParsedAgentPatchProposal): StaticAnalysisResult {
  const findings: string[] = [];

  if (proposal.changeTier === "policy-update") {
    return { passed: true, findings };
  }

  const scan = scanPatchContent(proposal.changedFiles);
  findings.push(...scan.errors, ...scan.warnings);

  for (const file of proposal.changedFiles) {
    if (file.patch.length > 256 * 1024) {
      findings.push(`Patch too large (>256KB): ${file.path}`);
    }
    if (/\.test\.ts$/.test(file.path) && /it\.skip|describe\.skip|\.only\(/.test(file.patch)) {
      findings.push(`Test weakening pattern in ${file.path}`);
    }
  }

  if (
    proposal.testsAddedOrChanged.length === 0 &&
    proposal.changeTier === "agent-module"
  ) {
    findings.push("agent-module proposals should include testsAddedOrChanged");
  }

  const hardFailures = findings.filter(
    (f) =>
      f.includes("Dangerous pattern") ||
      f.includes("Patch too large") ||
      f.includes("Test weakening")
  );

  return {
    passed: hardFailures.length === 0,
    findings,
  };
}
