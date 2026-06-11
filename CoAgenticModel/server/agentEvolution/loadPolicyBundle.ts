import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentPolicyBundle, PolicyDocument } from "../../src/types/policy";
import { resolveModuleEntrypoint } from "../../src/registry/moduleEntrypoint";
import { loadRegistryAgent, registryRoot } from "./registry";

export async function loadPolicyBundle(
  repoRoot: string,
  agentId: string,
  version: string,
  releaseId?: string
): Promise<AgentPolicyBundle> {
  const manifest = await loadRegistryAgent(repoRoot, agentId, version);
  const agentDir = join(registryRoot(repoRoot), agentId, version);
  const policies: Record<string, PolicyDocument> = {};

  for (const relativePath of manifest.policyBundle) {
    const filename = relativePath.split("/").pop() ?? relativePath;
    const absPath = join(agentDir, relativePath);
    try {
      policies[filename] = JSON.parse(await readFile(absPath, "utf8")) as PolicyDocument;
    } catch {
      policies[filename] = {};
    }
  }

  let systemPrompt: string | undefined;
  const promptPath = join(agentDir, manifest.entrypoint);
  try {
    systemPrompt = await readFile(promptPath, "utf8");
  } catch {
    systemPrompt = undefined;
  }

  let outputSchema: string | undefined;
  try {
    outputSchema = await readFile(join(agentDir, "prompts/output-schema.md"), "utf8");
  } catch {
    outputSchema = undefined;
  }

  return {
    agentId,
    version,
    releaseId,
    manifest,
    policies,
    systemPrompt,
    outputSchema,
    moduleEntrypoint: resolveModuleEntrypoint(agentId, manifest.moduleEntrypoint),
  };
}
