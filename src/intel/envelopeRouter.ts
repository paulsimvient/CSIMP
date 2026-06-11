/**
 * Client-side mission envelope routing — selects doctrine variant by operating context.
 */

import type { ScenarioPacket } from "./types";
import {
  classifyMissionEnvelope,
  type MissionEnvelopeClass,
} from "./missionEnvelope";

export type EnvelopeRouteRecord = {
  agentId: string;
  defaultVersion: string;
  routes: Array<{
    envelopeClass: string;
    version: string;
    releaseId?: string;
    passportId?: string;
    label: string;
  }>;
  updatedAt: string;
};

export type EnvelopeRouteResolution = {
  envelopeClass: MissionEnvelopeClass;
  agentVersion: string;
  releaseId?: string;
  passportId?: string;
  reasons: string[];
  routed: boolean;
};

export async function fetchEnvelopeRoutes(
  agentId = "intel-interpreter"
): Promise<EnvelopeRouteRecord | undefined> {
  try {
    const response = await fetch(`/api/agent-evolution/doctrine/envelope-routes/${agentId}`);
    if (!response.ok) return undefined;
    const body = (await response.json()) as { routes?: EnvelopeRouteRecord };
    return body.routes;
  } catch {
    return undefined;
  }
}

export function resolveVersionFromRoutes(
  envelopeClass: MissionEnvelopeClass,
  routes: EnvelopeRouteRecord | undefined,
  productionVersion: string
): EnvelopeRouteResolution {
  if (!routes) {
    return {
      envelopeClass,
      agentVersion: productionVersion,
      reasons: ["No envelope routes — using global production version"],
      routed: false,
    };
  }

  const match = routes.routes.find((r) => r.envelopeClass === envelopeClass);
  if (match) {
    return {
      envelopeClass,
      agentVersion: match.version,
      releaseId: match.releaseId,
      passportId: match.passportId,
      reasons: [`Routed to envelope ${match.label} (${match.version})`],
      routed: true,
    };
  }

  return {
    envelopeClass,
    agentVersion: routes.defaultVersion || productionVersion,
    reasons: [`No route for ${envelopeClass} — using default ${routes.defaultVersion}`],
    routed: false,
  };
}

export async function resolveAgentVersionForPacket(input: {
  agentId: string;
  packet: ScenarioPacket;
  productionVersion: string;
}): Promise<EnvelopeRouteResolution> {
  const classification = classifyMissionEnvelope(input.packet);
  const routes = await fetchEnvelopeRoutes(input.agentId);
  return resolveVersionFromRoutes(
    classification.envelopeClass,
    routes,
    input.productionVersion
  );
}

export async function fetchProductionBundleForEnvelope(
  agentId: string,
  envelopeClass?: MissionEnvelopeClass
): Promise<{ bundle?: import("./groundingPolicy").AgentPolicyBundle; route?: EnvelopeRouteResolution }> {
  const query = envelopeClass ? `?envelopeClass=${encodeURIComponent(envelopeClass)}` : "";
  try {
    const response = await fetch(
      `/api/agent-evolution/agents/${agentId}/production${query}`
    );
    if (!response.ok) return {};
    const body = (await response.json()) as {
      bundle?: import("./groundingPolicy").AgentPolicyBundle & {
        manifest?: { moduleEntrypoint?: string };
      };
      envelopeRoute?: EnvelopeRouteResolution;
    };
    const raw = body.bundle;
    if (!raw) return { route: body.envelopeRoute };
    return {
      bundle: {
        agentId: raw.agentId,
        version: raw.version,
        releaseId: raw.releaseId,
        policies: raw.policies,
        systemPrompt: raw.systemPrompt,
        outputSchema: raw.outputSchema,
        moduleEntrypoint: raw.moduleEntrypoint ?? raw.manifest?.moduleEntrypoint,
      },
      route: body.envelopeRoute,
    };
  } catch {
    return {};
  }
}
