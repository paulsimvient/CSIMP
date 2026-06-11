import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDefinition } from "../../src/types/agent";

const REGISTRY_ROOT = join(import.meta.dirname, "../../registry/agents");

export async function loadAgentDefinition(
  agentId: string,
  version: string
): Promise<AgentDefinition> {
  const manifestPath = join(REGISTRY_ROOT, agentId, version, "manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw) as AgentDefinition;
}

export function resolveAgentEntrypoint(definition: AgentDefinition): string {
  return join(REGISTRY_ROOT, definition.id, definition.version, definition.entrypoint);
}
