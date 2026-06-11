import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDefinition } from "../../src/types/agent";

export function registryRoot(repoRoot: string): string {
  return join(repoRoot, "CoAgenticModel", "registry", "agents");
}

export async function listAgentIds(repoRoot: string): Promise<string[]> {
  const root = registryRoot(repoRoot);
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function listAgentVersions(
  repoRoot: string,
  agentId: string
): Promise<string[]> {
  const root = join(registryRoot(repoRoot), agentId);
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && /^\d+\.\d+\.\d+$/.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

export async function loadRegistryAgent(
  repoRoot: string,
  agentId: string,
  version: string
): Promise<AgentDefinition> {
  const manifestPath = join(registryRoot(repoRoot), agentId, version, "manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw) as AgentDefinition;
}

export function mapPolicyPathToRegistry(
  agentId: string,
  version: string,
  policyPath: string
): string {
  const prefix = `policies/agents/${agentId}/`;
  if (!policyPath.startsWith(prefix)) {
    throw new Error(`Policy path must start with ${prefix}`);
  }
  const relative = policyPath.slice(prefix.length);
  return join("registry", "agents", agentId, version, "policies", relative);
}
