/**
 * Browser-side registry agent module bridge.
 * Maps production bundle moduleEntrypoint to bundled agent implementations.
 */

import { runIntelInterpreterStub } from "../../CoAgenticModel/src/agents/intelInterpreter/index";
import { resolveModuleEntrypoint } from "../../CoAgenticModel/src/registry/moduleEntrypoint";
import { hashStableJson } from "./runtimeIdentity";
import type { ScenarioPacket } from "./types";

export type RegistryModuleContext = {
  agentId: string;
  agentVersion: string;
  moduleEntrypoint?: string;
};

export type RegistryModuleOutput = {
  interpretationRef: string;
};

function packetIdFromScenario(packet: ScenarioPacket): string {
  return hashStableJson({
    commanderIntent: packet.commanderIntent,
    factIds: packet.observedFacts.map((fact) => fact.id).sort(),
  }).slice(0, 12);
}

function invokeIntelInterpreterModule(
  packet: ScenarioPacket
): RegistryModuleOutput {
  return runIntelInterpreterStub({
    packetId: packetIdFromScenario(packet),
    factIds: packet.observedFacts.map((fact) => fact.id),
  });
}

/**
 * Invoke the registry-backed agent module when production bundle declares moduleEntrypoint.
 * Returns undefined when no bundled module matches the agent.
 */
export function runRegistryAgentModule(
  ctx: RegistryModuleContext,
  packet: ScenarioPacket
): RegistryModuleOutput | undefined {
  const entrypoint = resolveModuleEntrypoint(ctx.agentId, ctx.moduleEntrypoint);
  if (!entrypoint) return undefined;

  if (ctx.agentId === "intel-interpreter" && entrypoint.includes("intelInterpreter")) {
    return invokeIntelInterpreterModule(packet);
  }

  return undefined;
}

export function hasRegistryAgentModule(ctx: RegistryModuleContext): boolean {
  return Boolean(resolveModuleEntrypoint(ctx.agentId, ctx.moduleEntrypoint));
}
