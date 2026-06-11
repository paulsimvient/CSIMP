import { assertLLMInterpretationSchema } from "../schemas";
import { getLlmConfig, usesLiveLlm } from "./llmConfig";
import type {
  CandidateAction,
  DecisionOptionGrounding,
  DecisionPoint,
  LLMInterpretation,
  ScenarioPacket,
} from "./types";
import { buildInterpreterPrompt } from "./scenarioPacket";
import { runRegistryAgentModule } from "./registryAgentLoader";

const DEBUG_LLM =
  import.meta.env.DEV && import.meta.env.VITE_INTEL_DEBUG_LLM === "true";

export type InterpreterFn = (
  packet: ScenarioPacket
) => Promise<{ interpretation: LLMInterpretation; rawModelText: string }>;

/**
 * Intel interpreter entry point.
 *
 * - `VITE_LLM_PROVIDER=ollama` → Ollama native API (`/api/chat`, JSON mode)
 * - `VITE_LLM_PROVIDER=openai` → OpenAI-compatible endpoint
 * - `VITE_LLM_PROVIDER=stub`   → deterministic offline stub
 *
 * Configure via `.env` (see `.env.example`). Restart `npm run dev` after changes.
 */
export async function llmInterpreter(
  packet: ScenarioPacket
): Promise<{ interpretation: LLMInterpretation; rawModelText: string }> {
  const config = getLlmConfig();

  if (!usesLiveLlm(config)) {
    console.info("[intel] VITE_LLM_PROVIDER=stub — using registry-backed stub interpreter.");
    const result = await stubInterpreter(packet);
    if (packet.agentId && packet.agentVersion) {
      const moduleOut = runRegistryAgentModule(
        {
          agentId: packet.agentId,
          agentVersion: packet.agentVersion,
          moduleEntrypoint: packet.moduleEntrypoint,
        },
        packet
      );
      if (moduleOut) {
        const moduleBanner = `[registry-module ${packet.agentId}@${packet.agentVersion} ref=${moduleOut.interpretationRef}]`;
        return {
          interpretation: result.interpretation,
          rawModelText: `${moduleBanner}\n${result.rawModelText ?? ""}`.trim(),
        };
      }
    }
    return result;
  }

  const prompt = buildInterpreterPrompt(packet);

  console.info(
    `[intel] Calling ${config.provider} model="${config.model}"…`
  );

  const callModel = async (activePrompt: string) =>
    config.provider === "ollama"
      ? callOllama(config, activePrompt)
      : callOpenAiCompatible(config, activePrompt);

  const rawFirst = await callModel(prompt);
  if (DEBUG_LLM) {
    console.info("[intel] Raw LLM response (attempt 1):", rawFirst);
  }
  const first = parseInterpretation(rawFirst);
  if (!isEmptyInterpretation(first) || packet.observedFacts.length === 0) {
    return { interpretation: first, rawModelText: rawFirst };
  }

  const retryPrompt = `${prompt}

CRITICAL REQUIREMENT:
- Observed Facts is non-empty.
- Do NOT return empty arrays.
- Return at least 2 inferences, 2 decisionPoints, and 2 candidateActions.
- If confidence is limited, use monitoring/confirmation options rather than empty output.
- observedFactsUsed must include every fact ID that influenced your output.
`.trim();

  const rawSecond = await callModel(retryPrompt);
  if (DEBUG_LLM) {
    console.info("[intel] Raw LLM response (attempt 2):", rawSecond);
  }
  const second = parseInterpretation(rawSecond);
  if (!isEmptyInterpretation(second) || packet.observedFacts.length === 0) {
    return {
      interpretation: second,
      rawModelText: `[attempt 1]\n${rawFirst}\n\n[attempt 2]\n${rawSecond}`,
    };
  }

  throw new Error(
    "LLM returned an empty interpretation after retry. Check prompt, schema, or model output."
  );
}

// ─── Ollama native API ────────────────────────────────────────────────────────

async function callOllama(
  config: ReturnType<typeof getLlmConfig>,
  prompt: string
): Promise<string> {
  const url = `${config.ollamaBaseUrl.replace(/\/$/, "")}/api/chat`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        format: "json",
        options: { temperature: 0.2 },
      }),
    });
  } catch (err) {
    throw new Error(
      `Cannot reach Ollama at ${config.ollamaBaseUrl}. Is it running? Try: ollama serve\n` +
        `(${err instanceof Error ? err.message : String(err)})`
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Ollama request failed: ${response.status} ${response.statusText}` +
        (detail ? `\n${detail}` : "") +
        `\nModel "${config.model}" may not be installed. Try: ollama pull ${config.model}`
    );
  }

  const body = (await response.json()) as {
    message?: { content?: string };
  };

  const content = body.message?.content;
  if (!content) throw new Error("Ollama returned empty message content");

  return content;
}

// ─── OpenAI-compatible API ────────────────────────────────────────────────────

async function callOpenAiCompatible(
  config: ReturnType<typeof getLlmConfig>,
  prompt: string
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const response = await fetch(config.openaiEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const sanitized = detail.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
    throw new Error(
      `LLM request failed: ${response.status} ${response.statusText}` +
        (sanitized ? `\n${sanitized}` : "")
    );
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content");

  return content;
}

// ─── Response parsing ─────────────────────────────────────────────────────────

function parseInterpretation(raw: string): LLMInterpretation {
  const jsonText = extractJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(
      `LLM returned invalid JSON. First 200 chars:\n${raw.slice(0, 200)}`
    );
  }

  return normalizeInterpretation(parsed);
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();

  // ```json ... ``` fence
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();

  // Raw object/array
  const start = trimmed.search(/[{[]/);
  const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (start !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function normalizeInterpretation(parsed: unknown): LLMInterpretation {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("LLM response is not a JSON object");
  }

  const obj = parsed as Record<string, unknown>;

  const observedFactsUsed = asStringArray(
    pick(obj, "observedFactsUsed", "observed_facts_used")
  );
  const inferences: LLMInterpretation["inferences"] = asArray(
    pick(obj, "inferences")
  ).map((item) => {
      const inf = item as Record<string, unknown>;
      return {
        claim: String(inf.claim ?? ""),
        supportingFacts: asStringArray(
          pick(inf, "supportingFacts", "supporting_facts")
        ),
        confidence: asConfidence(inf.confidence),
        ...(pick(inf, "whyNotHigher", "why_not_higher")
          ? { whyNotHigher: String(pick(inf, "whyNotHigher", "why_not_higher")) }
          : {}),
      };
    });
  const decisionPoints: LLMInterpretation["decisionPoints"] = asArray(
    pick(obj, "decisionPoints", "decision_points")
  ).map((item, dpIndex) => {
      const dp = item as Record<string, unknown>;
      const commanderLevelRaw = pick(dp, "commanderLevel", "commander_level");
      const commanderLevel = isDecisionTier(commanderLevelRaw)
        ? commanderLevelRaw
        : "section-lead";
      return {
        id: String(dp.id ?? `dp_${String(dpIndex + 1).padStart(3, "0")}`),
        question: String(dp.question ?? ""),
        triggerFacts: asStringArray(pick(dp, "triggerFacts", "trigger_facts")),
        options: asArray(pick(dp, "options")).map((option, optionIndex) => {
          const opt = option as Record<string, unknown>;
          const actionTypeRaw = pick(opt, "actionType", "action_type");
          const actionType = isActionType(actionTypeRaw)
            ? actionTypeRaw
            : "other";
          const optionCitedFacts = asStringArray(
            pick(opt, "citedFacts", "cited_facts")
          );
          const triggerFacts = asStringArray(
            pick(dp, "triggerFacts", "trigger_facts")
          );
          const effectiveCitedFacts =
            optionCitedFacts.length > 0 ? optionCitedFacts : triggerFacts;
          const grounding: DecisionOptionGrounding =
            effectiveCitedFacts.length === 0
              ? "missing"
              : optionCitedFacts.length > 0
                ? "explicit"
                : "inherited";
          return {
            id: String(opt.id ?? `dp_${dpIndex + 1}_opt_${optionIndex + 1}`),
            label: String(opt.label ?? ""),
            actionType,
            benefits: asStringArray(pick(opt, "benefits")),
            risks: asStringArray(pick(opt, "risks")),
            requiredAssets: asStringArray(
              pick(opt, "requiredAssets", "required_assets")
            ),
            requiredAuthority: asStringArray(
              pick(opt, "requiredAuthority", "required_authority")
            ),
            secondOrderEffects: asStringArray(
              pick(opt, "secondOrderEffects", "second_order_effects")
            ),
            confidence: isConfidence(opt.confidence) ? opt.confidence : "medium",
            citedFacts: effectiveCitedFacts,
            grounding,
            ...(optionCitedFacts.length === 0 && effectiveCitedFacts.length > 0
              ? { citedFactsInherited: true }
              : {}),
          };
        }),
        ...(pick(dp, "deadline") ? { deadline: String(pick(dp, "deadline")) } : {}),
        commanderLevel,
        reversible: typeof dp.reversible === "boolean" ? dp.reversible : true,
        informationNeeded: asStringArray(
          pick(dp, "informationNeeded", "information_needed")
        ),
        ...(pick(dp, "triggerCondition", "trigger_condition")
          ? {
              triggerCondition: String(
                pick(dp, "triggerCondition", "trigger_condition")
              ),
            }
          : {}),
        ...(pick(dp, "escalationThreshold", "escalation_threshold")
          ? {
              escalationThreshold: String(
                pick(dp, "escalationThreshold", "escalation_threshold")
              ),
            }
          : {}),
        ...(pick(dp, "deescalationThreshold", "deescalation_threshold")
          ? {
              deescalationThreshold: String(
                pick(dp, "deescalationThreshold", "deescalation_threshold")
              ),
            }
          : {}),
        ...(pick(dp, "abortCondition", "abort_condition")
          ? { abortCondition: String(pick(dp, "abortCondition", "abort_condition")) }
          : {}),
      };
    });
  const assumptions: LLMInterpretation["assumptions"] = asArray(
    pick(obj, "assumptions")
  ).map((item) => {
      const a = item as Record<string, unknown>;
      const status: "unconfirmed" | "working-assumption" =
        a.status === "working-assumption" ? "working-assumption" : "unconfirmed";
      return {
        claim: String(a.claim ?? ""),
        status,
      };
    });
  const uncertainties = asStringArray(pick(obj, "uncertainties"));
  const candidateActions: LLMInterpretation["candidateActions"] = asArray(
    pick(obj, "candidateActions", "candidate_actions")
  ).map((item, index) => {
      const a = item as Record<string, unknown>;
      const actionTypeRaw = pick(a, "actionType", "action_type");
      const actionType = isActionType(actionTypeRaw) ? actionTypeRaw : undefined;
      const timeSensitivityRaw = pick(a, "timeSensitivity", "time_sensitivity");
      const timeSensitivity = isTimeSensitivity(timeSensitivityRaw)
        ? timeSensitivityRaw
        : undefined;
      return {
        id: String(a.id ?? `action_${String(index + 1).padStart(3, "0")}`),
        description: String(a.description ?? ""),
        ...(actionType ? { actionType } : {}),
        ...(a.purpose ? { purpose: String(a.purpose) } : {}),
        citedFacts: asStringArray(pick(a, "citedFacts", "cited_facts")),
        citedInferences: asStringArray(
          pick(a, "citedInferences", "cited_inferences")
        ),
        requiredAssets: asStringArray(
          pick(a, "requiredAssets", "required_assets")
        ),
        requiredAuthority: asStringArray(
          pick(a, "requiredAuthority", "required_authority")
        ),
        expectedEffects: asStringArray(
          pick(a, "expectedEffects", "expected_effects")
        ),
        ...(timeSensitivity ? { timeSensitivity } : {}),
        ...(pick(a, "recommendedOwner", "recommended_owner")
          ? { recommendedOwner: String(pick(a, "recommendedOwner", "recommended_owner")) }
          : {}),
        risks: asStringArray(a.risks),
        conflicts: asStringArray(a.conflicts),
        assumptions: asStringArray(a.assumptions),
        ...(isConfidence(a.confidence) ? { confidence: a.confidence } : {}),
        rationale: String(a.rationale ?? ""),
      };
    });

  return assertLLMInterpretationSchema({
    observedFactsUsed,
    inferences,
    decisionPoints,
    assumptions,
    uncertainties,
    candidateActions,
  });
}

export function normalizeInterpretationForTest(parsed: unknown): LLMInterpretation {
  return normalizeInterpretation(parsed);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function asConfidence(value: unknown): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "medium";
}

function isConfidence(value: unknown): value is "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high";
}

function isActionType(
  value: unknown
): value is
  | "observe"
  | "monitor"
  | "investigate"
  | "coordinate"
  | "preserve"
  | "inform"
  | "harden"
  | "other" {
  return (
    value === "observe" ||
    value === "monitor" ||
    value === "investigate" ||
    value === "coordinate" ||
    value === "preserve" ||
    value === "inform" ||
    value === "harden" ||
    value === "other"
  );
}

function isTimeSensitivity(
  value: unknown
): value is "immediate" | "time-bound" | "routine" {
  return value === "immediate" || value === "time-bound" || value === "routine";
}

function isDecisionTier(value: unknown): value is "watch-floor" | "section-lead" | "commander" {
  return value === "watch-floor" || value === "section-lead" || value === "commander";
}

function pick(
  obj: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (key in obj) return obj[key];
  }
  return undefined;
}

function isEmptyInterpretation(interpretation: LLMInterpretation): boolean {
  return (
    interpretation.observedFactsUsed.length === 0 &&
    interpretation.inferences.length === 0 &&
    interpretation.decisionPoints.length === 0 &&
    interpretation.candidateActions.length === 0
  );
}

// ─── Stub interpreter ─────────────────────────────────────────────────────────

export const stubInterpreter: InterpreterFn = async (
  packet: ScenarioPacket
): Promise<{ interpretation: LLMInterpretation; rawModelText: string }> => {
  await delay(900);

  const factIds = packet.observedFacts.map((f) => f.id);

  const hasCyber = factIds.includes("fact_cyber_001");
  const hasUas = factIds.includes("fact_uas_001");
  const hasMaritime = factIds.includes("fact_mar_001");
  const hasSigint = factIds.includes("fact_sig_001");

  const inferences = [];

  if (hasCyber && hasUas) {
    inferences.push({
      claim: "Possible coordinated multi-domain pressure against Port A",
      supportingFacts: ["fact_uas_001", "fact_cyber_001"],
      confidence: "medium" as const,
      whyNotHigher:
        "Timing correlation between UAS activity and cyber anomalies is suggestive but not confirmed. No attribution intelligence available.",
    });
  }

  if (hasMaritime) {
    inferences.push({
      claim: "Loitering vessels may indicate reconnaissance or pre-positioning for disruption",
      supportingFacts: ["fact_mar_001"],
      confidence: "low" as const,
      whyNotHigher:
        "Vessel loitering alone is inconclusive. No observed hostile action. Could be commercial delay.",
    });
  }

  if (hasSigint && hasCyber) {
    inferences.push({
      claim: "RF emissions may indicate C2 coordination with cyber intrusion attempt",
      supportingFacts: ["fact_sig_001", "fact_cyber_001"],
      confidence: "low" as const,
      whyNotHigher:
        "Frequency bands are consistent with C2 use but no specific attribution. Requires SIGINT corroboration.",
    });
  }

  const assumptions = [
    {
      claim: "UAS activity and cyber anomalies share an adversarial actor",
      status: "unconfirmed" as const,
    },
    {
      claim: "Port A logistics system is a high-value target",
      status: "working-assumption" as const,
    },
  ];

  const uncertainties = [
    "Are the UAS sightings confirmed by more than one sensor?",
    "Are authentication failures targeted at specific accounts or system-wide?",
    "Is the port-closure rumor coordinated influence or organic speculation?",
    "Do loitering vessels have AIS history suggesting prior pattern?",
    "Are RF emissions localized to Port A sector or broader?",
  ];

  const candidateActions: CandidateAction[] = [];
  const decisionPoints: DecisionPoint[] = [];

  if (hasCyber) {
    decisionPoints.push({
      id: "dp_001",
      question:
        "Should Port A cyber posture be elevated before attribution is confirmed?",
      triggerFacts: ["fact_cyber_001"],
      options: [
        {
          id: "dp_001_a",
          label: "Increase monitoring and preserve forensic logs",
          actionType: "monitor",
          benefits: ["low escalation", "improved evidence quality"],
          risks: ["active compromise could continue longer"],
          requiredAssets: ["cyber-incident-response-team", "data-fusion-cell"],
          requiredAuthority: ["defensive-cyber-monitoring-authority"],
          secondOrderEffects: ["may defer active containment"],
          confidence: "medium",
          citedFacts: ["fact_cyber_001"],
        },
        {
          id: "dp_001_b",
          label: "Move directly to active containment",
          actionType: "harden",
          benefits: ["faster containment"],
          risks: ["possible service disruption"],
          requiredAssets: ["cyber-incident-response-team"],
          requiredAuthority: ["forensic-preservation-authority"],
          secondOrderEffects: ["could interrupt port workflow"],
          confidence: "medium",
          citedFacts: ["fact_cyber_001"],
        },
      ],
      deadline: "within 30 minutes",
      commanderLevel: "section-lead",
      reversible: true,
      informationNeeded: [
        "Are failed authentications concentrated on privileged accounts?",
        "Is anomaly volume still rising?",
      ],
      triggerCondition: "authentication failures exceed baseline threshold",
      escalationThreshold: "privileged account anomalies confirmed",
      deescalationThreshold: "failure rate returns to baseline",
      abortCondition: "containment would impact critical safety systems",
    });

    candidateActions.push({
      id: "action_001",
      description:
        "Activate cyber incident response team to investigate Port A logistics system anomaly",
      actionType: "investigate",
      purpose: "Contain potential intrusion and preserve continuity of port logistics operations.",
      citedFacts: ["fact_cyber_001"],
      citedInferences: [],
      requiredAssets: ["cyber-incident-response-team", "data-fusion-cell"],
      requiredAuthority: [
        "defensive-cyber-monitoring-authority",
        "forensic-preservation-authority",
      ],
      expectedEffects: [
        "improved anomaly triage confidence",
        "better forensic evidence preservation",
      ],
      timeSensitivity: "immediate",
      recommendedOwner: "cyber-response-lead",
      risks: ["potential temporary service degradation during containment"],
      conflicts: ["may compete with simultaneous backup migration tasks"],
      assumptions: ["authentication anomaly reflects malicious behavior rather than user error"],
      confidence: "medium",
      rationale:
        "fact_cyber_001 shows authentication failures above 3-sigma baseline. This may indicate an active intrusion attempt and warrants immediate investigation.",
    });
  }

  if (hasUas) {
    candidateActions.push({
      id: "action_002",
      description: "Deploy counter-UAS assets to Port A northern approach",
      actionType: "observe",
      purpose: "Increase situational awareness and preserve evidence before escalation.",
      citedFacts: ["fact_uas_001"],
      citedInferences: hasCyber
        ? ["Possible coordinated multi-domain pressure against Port A"]
        : [],
      requiredAssets: ["counter-uas-unit", "data-fusion-cell"],
      requiredAuthority: ["airspace-authorization", "deconfliction-approval"],
      expectedEffects: ["improved detection and track confidence near Port A"],
      timeSensitivity: "time-bound",
      recommendedOwner: "airspace-coordination-cell",
      risks: ["misidentification risk in congested approaches"],
      conflicts: ["may conflict with low-emissions posture constraints"],
      assumptions: ["UAS activity is relevant to current cyber anomaly window"],
      confidence: "medium",
      rationale:
        "fact_uas_001 shows unidentified UAS activity near critical infrastructure. Could suggest surveillance or positioning. Requires confirmation before escalation.",
    });
  }

  if (hasMaritime) {
    candidateActions.push({
      id: "action_003",
      description:
        "Dispatch port liaison to coordinate with maritime patrol regarding loitering vessels",
      actionType: "coordinate",
      purpose: "Improve maritime-domain corroboration without immediate escalation.",
      citedFacts: ["fact_mar_001"],
      citedInferences: [],
      requiredAssets: ["port-liaison", "maritime-patrol-boat-3"],
      requiredAuthority: [],
      expectedEffects: ["improved vessel pattern-of-life understanding"],
      timeSensitivity: "routine",
      recommendedOwner: "port-operations-liaison",
      risks: ["false positive interpretation of normal maritime delay"],
      conflicts: [],
      assumptions: ["maritime patrol has capacity for near-term tasking"],
      confidence: "low",
      rationale:
        "fact_mar_001 confirms 45-minute loitering near southern approach. Coordination is consistent with standard maritime domain awareness procedures.",
    });
  }

  if (hasCyber && hasUas) {
    candidateActions.push({
      id: "action_004",
      description:
        "Initiate multi-domain monitoring correlation to assess whether UAS and cyber activities are linked",
      actionType: "monitor",
      purpose: "Test correlation hypothesis and reduce unsupported attribution risk.",
      citedFacts: ["fact_uas_001", "fact_cyber_001"],
      citedInferences: [
        "Possible coordinated multi-domain pressure against Port A",
      ],
      requiredAssets: ["data-fusion-cell", "cyber-incident-response-team"],
      requiredAuthority: [],
      expectedEffects: ["improved cross-domain confidence scoring for follow-on COA selection"],
      timeSensitivity: "immediate",
      recommendedOwner: "intel-fusion-lead",
      risks: ["analysis delays may defer urgent tactical response"],
      conflicts: ["competes for analyst bandwidth with incident response triage"],
      assumptions: ["event timestamps are synchronized across reporting systems"],
      confidence: "medium",
      rationale:
        "fact_uas_001 and fact_cyber_001 are temporally proximate and affect the same installation. This is consistent with a multi-domain pressure pattern. Attribution requires further confirmation.",
    });
  }

  const interpretation: LLMInterpretation = {
    observedFactsUsed: factIds.filter((id) =>
      hasCyber || hasUas || hasMaritime || hasSigint ? true : id === factIds[0]
    ),
    inferences,
    decisionPoints,
    assumptions,
    uncertainties,
    candidateActions,
  };
  return {
    interpretation,
    rawModelText: JSON.stringify(interpretation, null, 2),
  };
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
