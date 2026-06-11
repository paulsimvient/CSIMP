/** Default output schema + rules when registry prompts/output-schema.md is unavailable. */
export const DEFAULT_INTERPRETER_OUTPUT_SCHEMA = `{
  "observedFactsUsed": string[],
  "inferences": [
    {
      "claim": string,
      "supportingFacts": string[],
      "confidence": "low" | "medium" | "high",
      "whyNotHigher": string | undefined
    }
  ],
  "decisionPoints": [],
  "assumptions": [{ "claim": string, "status": "unconfirmed" | "working-assumption" }],
  "uncertainties": string[],
  "candidateActions": []
}`;

export const DEFAULT_INTERPRETER_OUTPUT_RULES = [
  "observedFactsUsed must include every fact ID that influenced your output.",
  "Every inference must cite at least one fact ID in supportingFacts.",
  "Every candidateAction must cite at least one fact ID in citedFacts.",
  "Do not include fact IDs that do not appear in the Observed Facts section above.",
  "Use only allowed hedge language: may indicate, is consistent with, could suggest, requires confirmation.",
  "Return only the JSON object. No preamble, no explanation outside the JSON.",
];

export function formatInterpreterTaskSection(outputSchema?: string): string {
  const trimmed = (outputSchema ?? "").trim();
  if (!trimmed) {
    return `Analyze the observed facts above and return a JSON object with this exact structure:\n\n${DEFAULT_INTERPRETER_OUTPUT_SCHEMA}\n\nRules:\n${DEFAULT_INTERPRETER_OUTPUT_RULES.map((rule) => `- ${rule}`).join("\n")}`;
  }
  const rulesStart = trimmed.lastIndexOf("\nRules:");
  if (rulesStart >= 0) {
    const schemaBody = trimmed.slice(0, rulesStart).replace(/^Return a JSON object with this exact structure:\s*/i, "");
    const rulesBody = trimmed.slice(rulesStart + "\nRules:".length).trim();
    return `Analyze the observed facts above and return a JSON object with this exact structure:\n\n${schemaBody.trim()}\n\nRules:\n${rulesBody}`;
  }
  return `Analyze the observed facts above and return a JSON object with this exact structure:\n\n${trimmed}`;
}
