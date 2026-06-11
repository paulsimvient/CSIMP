/**
 * Phase 2 placeholder — agent-owned implementation modules live here.
 * The coding agent may propose patches under src/agents/<name>/ only.
 */

export type IntelInterpreterAgentInput = {
  packetId: string;
  factIds: string[];
};

export type IntelInterpreterAgentOutput = {
  interpretationRef: string;
};

/** Stub entrypoint — production runtime loads approved registry version instead. */
export function runIntelInterpreterStub(
  input: IntelInterpreterAgentInput
): IntelInterpreterAgentOutput {
  return {
    interpretationRef: `stub-${input.packetId}-${input.factIds.length}-facts`,
  };
}
