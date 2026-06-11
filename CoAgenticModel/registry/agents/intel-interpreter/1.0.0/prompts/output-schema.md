Return a JSON object with this exact structure:

{
  "observedFactsUsed": string[],
  "inferences": [
    {
      "claim": string,
      "supportingFacts": string[],
      "confidence": "low" | "medium" | "high",
      "whyNotHigher": string | undefined
    }
  ],
  "decisionPoints": [
    {
      "id": string,
      "question": string,
      "triggerFacts": string[],
      "deadline": string | undefined,
      "commanderLevel": "watch-floor" | "section-lead" | "commander",
      "reversible": boolean,
      "informationNeeded": string[],
      "triggerCondition": string | undefined,
      "escalationThreshold": string | undefined,
      "deescalationThreshold": string | undefined,
      "abortCondition": string | undefined,
      "options": [
        {
          "id": string,
          "label": string,
          "actionType": "observe" | "monitor" | "investigate" | "coordinate" | "preserve" | "inform" | "harden" | "other",
          "benefits": string[],
          "risks": string[],
          "requiredAssets": string[],
          "requiredAuthority": string[],
          "secondOrderEffects": string[],
          "confidence": "low" | "medium" | "high",
          "citedFacts": string[]
        }
      ]
    }
  ],
  "assumptions": [{ "claim": string, "status": "unconfirmed" | "working-assumption" }],
  "uncertainties": string[],
  "candidateActions": [
    {
      "id": string,
      "description": string,
      "actionType": "observe" | "monitor" | "investigate" | "coordinate" | "preserve" | "inform" | "harden" | "other",
      "purpose": string,
      "citedFacts": string[],
      "citedInferences": string[],
      "requiredAssets": string[],
      "requiredAuthority": string[],
      "expectedEffects": string[],
      "timeSensitivity": "immediate" | "time-bound" | "routine",
      "recommendedOwner": string,
      "risks": string[],
      "conflicts": string[],
      "assumptions": string[],
      "confidence": "low" | "medium" | "high",
      "rationale": string
    }
  ]
}

Rules:
- observedFactsUsed must include every fact ID that influenced your output.
- Every inference must cite at least one fact ID in supportingFacts.
- Every decisionPoint must cite at least one fact ID in triggerFacts.
- Every decision option must cite at least one fact ID in citedFacts.
- If an option cannot cite an observed fact, do not emit that option.
- Do not rely only on decisionPoint.triggerFacts; each option must be independently grounded.
- Every candidateAction must cite at least one fact ID in citedFacts.
- If Observed Facts is non-empty, do not return empty arrays.
- If facts are limited, provide monitoring/confirmation/information-gathering options instead of empty output.
- If Observed Facts is non-empty, produce at least 2 inferences, 2 decisionPoints, and 2 candidateActions.
- Every requiredAssets entry must be from Available Assets.
- If requiredAuthority is non-empty, each authority must be present in Authority States.
- Do not include fact IDs that do not appear in the Observed Facts section above.
- Do not invent entities, locations, or events.
- Use only allowed hedge language: "may indicate", "is consistent with", "could suggest", "requires confirmation".
- Return only the JSON object. No preamble, no explanation outside the JSON.
