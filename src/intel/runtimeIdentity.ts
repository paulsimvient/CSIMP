/**
 * Stable JSON hash for agent runtime provenance (input/output audit trail).
 */

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

/** FNV-1a 64-bit hex — sync, works in browser and Node without crypto.subtle. */
export function hashStableJson(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

export type AgentRuntimeProvenance = {
  agentId: string;
  agentVersion: string;
  releaseId?: string;
  inputHash: string;
  outputHash: string;
};

export function buildAgentRuntimeProvenance(input: {
  agentId: string;
  agentVersion: string;
  releaseId?: string;
  packet: unknown;
  interpretation: unknown;
}): AgentRuntimeProvenance {
  return {
    agentId: input.agentId,
    agentVersion: input.agentVersion,
    releaseId: input.releaseId,
    inputHash: hashStableJson(input.packet),
    outputHash: hashStableJson(input.interpretation),
  };
}
