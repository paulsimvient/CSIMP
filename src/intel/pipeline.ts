import { create } from "zustand";
import {
  deleteSqlSnapshot,
  loadSqlSnapshot,
  saveSqlSnapshot,
} from "../persistence/sqlState";
import { DEFAULT_FACT_SET_ID, loadFactSet } from "./factSets";
import {
  extractValidatedActions,
  extractValidatedDecisionPoints,
  formatGroundingReport,
  validateGrounding,
} from "./grounding";
import { llmInterpreter } from "./interpreter";
import { buildScenarioPacket } from "./scenarioPacket";
import type { InterpreterFn } from "./interpreter";
import {
  constraintsFromBundle,
  fetchProductionAgentBundle,
  groundingConfigFromBundle,
  mergeConstraints,
} from "./groundingPolicy";
import { buildAgentRuntimeProvenance } from "./runtimeIdentity";
import { classifyMissionEnvelope } from "./missionEnvelope";
import { fetchProductionBundleForEnvelope } from "./envelopeRouter";
import type {
  AuthorityState,
  IntelState,
  LLMInterpretation,
  ObservedFact,
  ScenarioPacket,
} from "./types";

export type { InterpreterFn };

// ─── Intel pipeline ───────────────────────────────────────────────────────────
//
// The end-to-end intel processing pipeline:
//
//   1. Collect observed facts (sensors/sources — never the LLM)
//   2. Build a bounded ScenarioPacket
//   3. Send to LLM interpreter
//   4. Validate grounding deterministically
//   5. Commit complete IntelState — only validated actions flow downstream
//
// This runs before the COA pipeline. Its validatedActions become the signals
// that inform COA generation.

type RunIntelPipelineInput = {
  facts?: ObservedFact[];
  commanderIntent?: string;
  knownAssets?: string[];
  knownAuthorities?: Record<string, AuthorityState>;
  constraints?: string[];
  includeLowConfidence?: boolean;
  interpreter?: InterpreterFn;
  /** Override production agent; defaults to registry production version. */
  agentId?: string;
};

export async function runIntelPipeline(
  input: RunIntelPipelineInput = {}
): Promise<IntelState> {
  const {
    facts = loadFactSet(DEFAULT_FACT_SET_ID),
    commanderIntent = "Defend Taiwan Strait sea-lane continuity, keep civilian infrastructure online, and avoid escalation spiral while maintaining public trust.",
    knownAssets = [
      "surface-escort-group-alpha",
      "submarine-detachment-1",
      "maritime-patrol-aircraft-wing",
      "fighter-intercept-squadron",
      "integrated-air-defense-battery-north",
      "cyber-defense-team",
      "space-monitoring-cell",
      "coast-guard-response-flotilla",
      "uav-recon-flight",
      "data-fusion-cell",
      "public-affairs-cell",
    ],
    knownAuthorities = {
      "air-defense-readiness-order": "authorized",
      "civilian-shipping-deconfliction": "requires-approval",
      "defensive-cyber-monitoring-authority": "authorized",
      "spectrum-control-order": "requires-approval",
      "public-messaging-approval": "requires-approval",
      "forensic-preservation-authority": "authorized",
    },
    constraints = [
      "Do not assume attribution without explicit intelligence support",
      "Do not propose offensive cyber operations",
      "Do not strike ambiguous contacts without positive identification",
      "Preserve civilian shipping safety corridors where feasible",
      "Do not treat rumors as confirmed facts",
      "Do not treat low-confidence signals as validated facts",
    ],
    includeLowConfidence = false,
    interpreter = llmInterpreter,
    agentId = "intel-interpreter",
  } = input;

  const agentBundleDefault = await fetchProductionAgentBundle(agentId);
  const registryConstraints = agentBundleDefault ? constraintsFromBundle(agentBundleDefault) : [];
  const mergedConstraints = mergeConstraints(constraints, registryConstraints);

  // Step 1 — build bounded scenario packet (preliminary for envelope classification)
  const preliminary = buildScenarioPacket(
    {
      commanderIntent,
      facts,
      knownAssets,
      knownAuthorities,
      constraints: mergedConstraints,
      agentSystemPrompt: agentBundleDefault?.systemPrompt,
      agentOutputSchema: agentBundleDefault?.outputSchema,
      agentId: agentBundleDefault?.agentId,
      agentVersion: agentBundleDefault?.version,
      moduleEntrypoint: agentBundleDefault?.moduleEntrypoint,
    },
    { includeLowConfidence }
  );

  const envelopeClass = classifyMissionEnvelope(preliminary.packet).envelopeClass;
  let envelopeRouted = false;
  let agentBundle = agentBundleDefault;

  const envelopeFetch = await fetchProductionBundleForEnvelope(agentId, envelopeClass);
  if (envelopeFetch.bundle) {
    agentBundle = envelopeFetch.bundle as typeof agentBundleDefault;
    envelopeRouted = envelopeFetch.route?.routed ?? false;
  }

  const registryConstraintsFinal = agentBundle ? constraintsFromBundle(agentBundle) : [];
  const groundingPolicy = agentBundle
    ? groundingConfigFromBundle(agentBundle)
    : undefined;
  const mergedConstraintsFinal = mergeConstraints(constraints, registryConstraintsFinal);

  const { packet, excludedFacts } = buildScenarioPacket(
    {
      commanderIntent,
      facts,
      knownAssets,
      knownAuthorities,
      constraints: mergedConstraintsFinal,
      agentSystemPrompt: agentBundle?.systemPrompt,
      agentOutputSchema: agentBundle?.outputSchema,
      agentId: agentBundle?.agentId,
      agentVersion: agentBundle?.version,
      moduleEntrypoint: agentBundle?.moduleEntrypoint,
    },
    { includeLowConfidence }
  );

  if (excludedFacts.length > 0) {
    console.info(
      `[intel] Excluded ${excludedFacts.length} low-confidence facts from LLM packet:`,
      excludedFacts.map((f) => f.id)
    );
  }

  // Step 2 — LLM interpretation
  let rawInterpretation: LLMInterpretation;
  let rawModelText: string | undefined;
  try {
    const interpreted = await interpreter(packet);
    rawInterpretation = interpreted.interpretation;
    rawModelText = RETAIN_RAW_MODEL_TEXT ? interpreted.rawModelText : undefined;
  } catch (err) {
    return intelErrorState(facts, packet, err);
  }

  // Step 3 — grounding validation (deterministic — no LLM involved)
  const groundingResult = validateGrounding(
    packet,
    rawInterpretation,
    groundingPolicy
  );

  if (import.meta.env.DEV) {
    console.info("[intel] Grounding report:\n" + formatGroundingReport(groundingResult));
  }

  // Step 4 — extract only validated actions
  const validatedActions = extractValidatedActions(rawInterpretation, groundingResult);
  const validatedDecisionPoints = extractValidatedDecisionPoints(
    rawInterpretation,
    groundingResult,
    packet
  );

  return {
    status: "ready",
    facts,
    scenarioPacket: packet,
    rawInterpretation,
    ...(rawModelText ? { rawModelText } : {}),
    groundingResult,
    validatedActions,
    validatedDecisionPoints,
    ...(agentBundle
      ? {
          agentRuntime: {
            ...buildAgentRuntimeProvenance({
              agentId: agentBundle.agentId,
              agentVersion: agentBundle.version,
              releaseId: agentBundle.releaseId,
              packet,
              interpretation: rawInterpretation,
            }),
            envelopeClass,
            envelopeRouted,
          },
        }
      : {}),
  };
}

// ─── Intel store ──────────────────────────────────────────────────────────────

type IntelStore = IntelState & {
  run: (input?: RunIntelPipelineInput) => Promise<void>;
  reset: () => void;
};

const INITIAL_INTEL_STATE: IntelState = {
  status: "idle",
  facts: [],
  validatedActions: [],
  validatedDecisionPoints: [],
};
const INTEL_SQL_KEY = "intel_state";
const RETAIN_RAW_MODEL_TEXT =
  import.meta.env.VITE_INTEL_RETAIN_RAW_MODEL_TEXT === "true";

export const useIntelStore = create<IntelStore>()((set) => ({
  ...INITIAL_INTEL_STATE,

  run: async (input = {}) => {
    set({ status: "collecting" });
    void persistIntelState({ ...useIntelStore.getState(), status: "collecting" });
    try {
      set({ status: "interpreting" });
      void persistIntelState({ ...useIntelStore.getState(), status: "interpreting" });
      const next = await runIntelPipeline(input);
      set(next);
      void persistIntelState(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ status: "error", error: message });
      void persistIntelState({
        ...useIntelStore.getState(),
        status: "error",
        error: message,
      });
    }
  },

  reset: () => {
    set(INITIAL_INTEL_STATE);
    void deleteSqlSnapshot(INTEL_SQL_KEY);
  },
}));

// ─── Selector hooks ───────────────────────────────────────────────────────────

export function useIntelStatus(): IntelState["status"] {
  return useIntelStore((s) => s.status);
}

export function useObservedFacts(): ObservedFact[] {
  return useIntelStore((s) => s.facts);
}

export function useScenarioPacket(): ScenarioPacket | undefined {
  return useIntelStore((s) => s.scenarioPacket);
}

export function useGroundingResult() {
  return useIntelStore((s) => s.groundingResult);
}

export function useValidatedActions() {
  return useIntelStore((s) => s.validatedActions);
}

export function useRawInterpretation() {
  return useIntelStore((s) => s.rawInterpretation);
}

export function useRawModelText() {
  return useIntelStore((s) => s.rawModelText);
}

export function useValidatedDecisionPoints() {
  return useIntelStore((s) => s.validatedDecisionPoints);
}

export function useRunIntel() {
  return useIntelStore((s) => s.run);
}

export function useResetIntel() {
  return useIntelStore((s) => s.reset);
}

export function useAgentRuntime() {
  return useIntelStore((s) => s.agentRuntime);
}

// ─── Internal utilities ───────────────────────────────────────────────────────

function intelErrorState(
  facts: ObservedFact[],
  packet: ScenarioPacket,
  err: unknown
): IntelState {
  const message = err instanceof Error ? err.message : String(err);
  return {
    status: "error",
    error: message,
    facts,
    scenarioPacket: packet,
    validatedActions: [],
    validatedDecisionPoints: [],
  };
}

function sanitizeHydratedIntelState(state: IntelState): IntelState {
  const status =
    state.status === "collecting" ||
    state.status === "interpreting" ||
    state.status === "validating"
      ? "idle"
      : state.status;
  return {
    ...INITIAL_INTEL_STATE,
    ...state,
    status,
  };
}

function snapshotIntelStateForPersist(state: IntelState): IntelState {
  if (RETAIN_RAW_MODEL_TEXT) return state;
  const { rawModelText: _rawModelText, ...rest } = state;
  return rest;
}

async function persistIntelState(state: IntelState): Promise<void> {
  await saveSqlSnapshot(INTEL_SQL_KEY, snapshotIntelStateForPersist(state));
}

export async function hydrateIntelState(): Promise<boolean> {
  const snapshot = await loadSqlSnapshot<IntelState>(INTEL_SQL_KEY);
  if (!snapshot) return false;
  useIntelStore.setState(sanitizeHydratedIntelState(snapshot));
  return true;
}
