/**
 * Resolve registry agent module entrypoints (Tier B executable modules).
 * Prompt entrypoint (manifest.entrypoint) is separate from module code.
 */

export const DEFAULT_MODULE_ENTRYPOINTS: Record<string, string> = {
  "intel-interpreter": "src/agents/intelInterpreter/index.ts",
};

export function resolveModuleEntrypoint(
  agentId: string,
  manifestValue?: string
): string | undefined {
  const trimmed = manifestValue?.trim();
  if (trimmed) return trimmed;
  return DEFAULT_MODULE_ENTRYPOINTS[agentId];
}

/** intel-interpreter → intelInterpreter (CoAgenticModel/src/agents/<dir>/). */
export function agentIdToModuleDir(agentId: string): string {
  const parts = agentId.split("-");
  return parts
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

export function defaultAgentModulePath(agentId: string): string {
  return `CoAgenticModel/src/agents/${agentIdToModuleDir(agentId)}/`;
}
