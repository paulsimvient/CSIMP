import { join } from "node:path";
import type { AgentPolicyBundle } from "../../src/types/policy";
import {
  agentIdToModuleDir,
  resolveModuleEntrypoint,
} from "../../src/registry/moduleEntrypoint";

export type RegistryModuleDescriptor = {
  agentId: string;
  version: string;
  moduleEntrypoint: string;
  absolutePath: string;
  moduleDir: string;
};

export function resolveRegistryModule(
  repoRoot: string,
  bundle: AgentPolicyBundle
): RegistryModuleDescriptor | undefined {
  const moduleEntrypoint = resolveModuleEntrypoint(
    bundle.agentId,
    bundle.manifest.moduleEntrypoint
  );
  if (!moduleEntrypoint) return undefined;

  return {
    agentId: bundle.agentId,
    version: bundle.version,
    moduleEntrypoint,
    absolutePath: join(repoRoot, "CoAgenticModel", moduleEntrypoint),
    moduleDir: agentIdToModuleDir(bundle.agentId),
  };
}
