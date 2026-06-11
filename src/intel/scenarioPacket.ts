import type { AuthorityState, ObservedFact, ScenarioPacket } from "./types";
import { formatInterpreterTaskSection } from "./interpreterPromptTemplate";

// ─── Scenario packet builder ──────────────────────────────────────────────────
//
// Builds the bounded context given to the LLM.
//
// "Bounded" means:
//   - Only the facts you explicitly include are visible to the model.
//   - Commander intent and constraints scope the reasoning.
//   - The LLM cannot invent facts from outside this packet.

type BuildScenarioPacketInput = {
  commanderIntent: string;
  facts: ObservedFact[];
  knownAssets: string[];
  knownAuthorities?: Record<string, AuthorityState>;
  constraints?: string[];
  /** Registry agent system prompt (CoAgenticModel prompts/system.md). */
  agentSystemPrompt?: string;
  /** Registry output schema (CoAgenticModel prompts/output-schema.md). */
  agentOutputSchema?: string;
  /** Production registry agent identity for module loader. */
  agentId?: string;
  agentVersion?: string;
  moduleEntrypoint?: string;
  /** Optional free-text situational context (operational picture, NOTAMS, etc.) */
  contextWindow?: string;
};

/**
 * Constructs a ScenarioPacket from normalized facts.
 *
 * The packet applies the following filters before giving facts to the LLM:
 *   - Drops facts with confidence "low" unless overridden
 *   - Logs which facts were excluded (for audit)
 *
 * This is a deliberate design choice: the LLM should not speculate from
 * low-confidence inputs unless the operator explicitly opts in.
 * The grounding validator still checks against the full known fact set.
 */
export function buildScenarioPacket(
  input: BuildScenarioPacketInput,
  options: { includeLowConfidence?: boolean } = {}
): { packet: ScenarioPacket; excludedFacts: ObservedFact[] } {
  const {
    commanderIntent,
    facts,
    knownAssets,
    knownAuthorities,
    constraints = [],
    contextWindow,
    agentSystemPrompt,
    agentOutputSchema,
    agentId,
    agentVersion,
    moduleEntrypoint,
  } = input;

  const included: ObservedFact[] = [];
  const excluded: ObservedFact[] = [];

  for (const fact of facts) {
    if (!options.includeLowConfidence && fact.confidence === "low") {
      excluded.push(fact);
    } else {
      included.push(fact);
    }
  }

  const packet: ScenarioPacket = {
    commanderIntent,
    observedFacts: included,
    knownAssets,
    ...(knownAuthorities ? { knownAuthorities } : {}),
    constraints: [
      // System-level constraints always applied
      "Do not create or invent observed facts. Facts are provided as input only.",
      "Every inference must cite at least one fact ID from observedFacts.",
      "Every candidate action must cite at least one fact ID from observedFacts.",
      "Do not use: proves, confirms, shows adversary did X. Use: may indicate, is consistent with, could suggest, requires confirmation.",
      "Do not assume attribution without explicit intelligence support.",
      // Caller-provided constraints
      ...constraints,
    ],
    ...(contextWindow ? { contextWindow } : {}),
    ...(agentSystemPrompt ? { agentSystemPrompt } : {}),
    ...(agentOutputSchema ? { agentOutputSchema } : {}),
    ...(agentId ? { agentId } : {}),
    ...(agentVersion ? { agentVersion } : {}),
    ...(moduleEntrypoint ? { moduleEntrypoint } : {}),
  };

  return { packet, excludedFacts: excluded };
}

// ─── Prompt builder ───────────────────────────────────────────────────────────
//
// Converts a ScenarioPacket into a concrete LLM prompt string.
// Keeping this separate from the packet means you can change the prompt
// format without changing the data model.

export function buildInterpreterPrompt(packet: ScenarioPacket): string {
  const factList = packet.observedFacts
    .map(
      (f, i) =>
        `${i + 1}. [${f.id}] ${f.domain.toUpperCase()} | ${f.entity}: "${f.event}" ` +
        `at ${f.time} — source: ${f.source}, confidence: ${f.confidence}, severity: ${f.severity}.` +
        (f.location ? ` Location: ${f.location}.` : "")
    )
    .join("\n");

  const assetList = packet.knownAssets.map((a) => `- ${a}`).join("\n");
  const authorityList = Object.entries(packet.knownAuthorities ?? {})
    .map(([name, state]) => `- ${name}: ${state}`)
    .join("\n");
  const constraintList = packet.constraints.map((c) => `- ${c}`).join("\n");

  const persona = (packet.agentSystemPrompt ?? "").trim();
  const roleBlock = persona
    ? `${persona}\n\nYou are supporting a command planning cell with structured intelligence analysis.`
    : "You are an intelligence analyst supporting a command planning cell.";

  return `
${roleBlock}

## Commander Intent
${packet.commanderIntent}

${packet.contextWindow ? `## Operational Context\n${packet.contextWindow}\n` : ""}
## Observed Facts
${factList}

## Available Assets
${assetList}

${authorityList ? `## Authority States\n${authorityList}\n` : ""}
## Constraints
${constraintList}

## Your Task
${formatInterpreterTaskSection(packet.agentOutputSchema ?? "")}
`.trim();
}
