/**
 * Deterministic file-scope and capability policy.
 * The coding model never controls this evaluator.
 */

export type PolicyDecision = {
  allowed: boolean;
  errors: string[];
  warnings: string[];
  deniedPaths: string[];
};

export const LOW_RISK_ALLOWED_PATHS = [
  /^policies\/agents\//,
  /^src\/agents\/[a-zA-Z0-9_-]+\//,
  /^src\/agents\/[a-zA-Z0-9_-]+\.test\.ts$/,
] as const;

export const AGENT_MODULE_ALLOWED_PATHS = [
  /^src\/agents\/[a-zA-Z0-9_-]+\//,
  /^src\/agents\/[a-zA-Z0-9_-]+\.test\.ts$/,
  /^CoAgenticModel\/src\/agents\/[a-zA-Z0-9_-]+\//,
  /^CoAgenticModel\/src\/agents\/[a-zA-Z0-9_-]+\.test\.ts$/,
  /^policies\/agents\//,
] as const;

export const ALWAYS_BLOCKED_WITHOUT_ELEVATION = [
  /^server\//,
  /^src\/coa\/cyberEmulation\//,
  /^src\/persistence\//,
  /^scripts\//,
  /^package(-lock)?\.json$/,
  /^run\.sh$/,
  /^vite\.config\.ts$/,
  /^\.github\//,
  /^CoAgenticModel\/server\//,
] as const;

export const DANGEROUS_CODE_PATTERNS = [
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /child_process/,
  /execSync|spawnSync|exec\(/,
  /fs\.write(File|FileSync)?\s*\(/,
  /import\s*\(\s*['"`]https?:/,
  /process\.env\.(LLM_API_KEY|CYBER_LAB|SECRET)/i,
  /vitest\.config/,
  /delete\s+.*\.test\.ts/i,
] as const;

export type PolicyTier = "policy-update" | "agent-module" | "shared-infrastructure";

function matchesAny(path: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(path));
}

export function evaluatePathPolicy(
  paths: string[],
  tier: PolicyTier,
  elevated = false
): PolicyDecision {
  const errors: string[] = [];
  const warnings: string[] = [];
  const deniedPaths: string[] = [];

  const allowedPatterns =
    tier === "policy-update"
      ? LOW_RISK_ALLOWED_PATHS
      : tier === "agent-module"
        ? AGENT_MODULE_ALLOWED_PATHS
        : [];

  for (const path of paths) {
    const normalized = path.replace(/\\/g, "/");

    if (matchesAny(normalized, ALWAYS_BLOCKED_WITHOUT_ELEVATION)) {
      if (!elevated || tier !== "shared-infrastructure") {
        errors.push(`Blocked path without elevation: ${normalized}`);
        deniedPaths.push(normalized);
        continue;
      }
      warnings.push(`Elevated change touches sensitive path: ${normalized}`);
    }

    if (tier !== "shared-infrastructure" && !matchesAny(normalized, allowedPatterns)) {
      errors.push(`Path outside approved scope for ${tier}: ${normalized}`);
      deniedPaths.push(normalized);
    }
  }

  if (tier === "shared-infrastructure" && !elevated) {
    errors.push("shared-infrastructure tier requires elevated review");
  }

  return {
    allowed: errors.length === 0,
    errors,
    warnings,
    deniedPaths,
  };
}

export function scanPatchContent(patches: Array<{ path: string; patch: string }>): PolicyDecision {
  const errors: string[] = [];
  const warnings: string[] = [];
  const deniedPaths: string[] = [];

  for (const { path, patch } of patches) {
    for (const pattern of DANGEROUS_CODE_PATTERNS) {
      if (pattern.test(patch)) {
        errors.push(`Dangerous pattern ${pattern} in patch for ${path}`);
        deniedPaths.push(path);
        break;
      }
    }
  }

  return {
    allowed: errors.length === 0,
    errors,
    warnings,
    deniedPaths,
  };
}

export function requiredApprovals(
  tier: PolicyTier,
  requestedRisk: "low" | "medium" | "high"
): number {
  if (tier === "shared-infrastructure" || requestedRisk === "high") return 2;
  if (tier === "agent-module" || requestedRisk === "medium") return 1;
  return 1;
}
