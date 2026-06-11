/**
 * Immutable agent package contract.
 * Once approved, a version is never mutated — create v1.1.0 instead.
 */

export const AGENT_ROLES = [
  "intel-interpreter",
  "coa-planner",
  "logistics-reviewer",
  "risk-auditor",
  "ui-assistant",
  "coding-agent",
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export type AgentResourceLimits = {
  timeoutMs: number;
  maxTokens?: number;
  maxToolCalls?: number;
};

export type AgentDefinition = {
  id: string;
  version: string;
  role: AgentRole;
  /** Prompt / schema entry (registry-relative). */
  entrypoint: string;
  /** Tier B executable module (CoAgenticModel-relative), e.g. src/agents/intelInterpreter/index.ts */
  moduleEntrypoint?: string;
  allowedTools: string[];
  inputSchema: string;
  outputSchema: string;
  policyBundle: string[];
  regressionSuite: string[];
  resourceLimits: AgentResourceLimits;
};

export type AgentRuntimeIdentity = {
  agentId: string;
  agentVersion: string;
  releaseId: string;
  inputHash: string;
  outputHash: string;
};

export type ChangeTier = "policy-update" | "agent-module" | "shared-infrastructure";
