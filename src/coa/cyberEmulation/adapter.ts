import { CYBER_EMULATION_CONFIG } from "./config";
import { atomicRedTeamProvider } from "./providers/atomic-red-team";
import { calderaProvider } from "./providers/stubs";
import { manualAssessmentProvider } from "./providers/stubs";
import { simulatedCyberProvider } from "./providers/simulated";
import type {
  CyberEmulationProvider,
  CyberEmulationProviderFn,
  CyberEmulationRequest,
  CyberEffectResult,
} from "./types";
import { CyberEmulationPolicyError as PolicyError } from "./types";

const PROVIDERS: Record<CyberEmulationProvider, CyberEmulationProviderFn> = {
  simulated: simulatedCyberProvider,
  "atomic-red-team": atomicRedTeamProvider,
  caldera: calderaProvider,
  "manual-assessment": manualAssessmentProvider,
};

export type CyberEmulationAdapterInput = {
  coaId: string;
  validatedActionIds: string[];
  citedFactIds: string[];
  actionDescriptions: string[];
  actionTypes: string[];
  provider?: CyberEmulationProvider;
  humanApproved?: boolean;
  labEnvironmentConfirmed?: boolean;
};

/**
 * Cyber-effects adapter — sits after SMT/validation, before effects scoring.
 * Never callable from LLM code paths; only from the COA effects engine.
 */
export async function runCyberEmulationAdapter(
  input: CyberEmulationAdapterInput
): Promise<CyberEffectResult> {
  const provider = input.provider ?? CYBER_EMULATION_CONFIG.defaultProvider;
  enforcePolicy({
    provider,
    humanApproved: input.humanApproved,
    labEnvironmentConfirmed: input.labEnvironmentConfirmed,
  });

  const request: CyberEmulationRequest = {
    coaId: input.coaId,
    validatedActionIds: input.validatedActionIds,
    citedFactIds: input.citedFactIds,
    actionDescriptions: input.actionDescriptions,
    actionTypes: input.actionTypes,
    provider,
    humanApproved: input.humanApproved,
    labEnvironmentConfirmed: input.labEnvironmentConfirmed,
  };

  if (request.validatedActionIds.length === 0) {
    throw new PolicyError({
      code: "provider-not-enabled",
      message: "Cyber emulation requires at least one validated action ID.",
    });
  }

  if (request.citedFactIds.length === 0) {
    throw new PolicyError({
      code: "provider-not-enabled",
      message: "Cyber emulation requires cited fact IDs — no uncited runs.",
    });
  }

  return PROVIDERS[provider](request);
}

function enforcePolicy(opts: {
  provider: CyberEmulationProvider;
  humanApproved?: boolean;
  labEnvironmentConfirmed?: boolean;
}): void {
  if (!CYBER_EMULATION_CONFIG.enabledProviders.has(opts.provider)) {
    throw new PolicyError({
      code: "provider-not-enabled",
      message: `Provider "${opts.provider}" is not enabled.`,
    });
  }

  if (CYBER_EMULATION_CONFIG.labOnly && opts.provider !== "simulated") {
    if (!opts.labEnvironmentConfirmed) {
      throw new PolicyError({
        code: "lab-only-required",
        message:
          "Non-simulated cyber emulation requires labEnvironmentConfirmed.",
      });
    }
    if (!opts.humanApproved) {
      throw new PolicyError({
        code: "human-approval-required",
        message: "Non-simulated cyber emulation requires explicit human approval.",
      });
    }
  }

  if (
    CYBER_EMULATION_CONFIG.forbidProductionExecution &&
    opts.provider !== "simulated" &&
    !opts.labEnvironmentConfirmed
  ) {
    throw new PolicyError({
      code: "production-execution-forbidden",
      message: "Direct production cyber execution is forbidden.",
    });
  }
}

export function isCyberRelevantActionType(type: string): boolean {
  return (
    type === "cyber" ||
    type === "information" ||
    type === "harden" ||
    type === "investigate"
  );
}
