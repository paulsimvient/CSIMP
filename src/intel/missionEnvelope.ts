/**
 * Mission envelope classification — context-sensitive doctrine routing.
 */

import type { ScenarioPacket } from "./types";

export type MissionEnvelopeClass =
  | "maritime-degraded-comms"
  | "maritime-standard"
  | "cyber-attribution-sensitive"
  | "multi-domain-standard";

export type EnvelopeClassification = {
  envelopeClass: MissionEnvelopeClass;
  confidence: number;
  reasons: string[];
};

function averageConfidence(packet: ScenarioPacket): number {
  if (packet.observedFacts.length === 0) return 0;
  const map = { low: 0.35, medium: 0.65, high: 0.9 } as const;
  const sum = packet.observedFacts.reduce(
    (acc, fact) => acc + (map[fact.confidence] ?? 0.5),
    0
  );
  return sum / packet.observedFacts.length;
}

function hasDomain(packet: ScenarioPacket, domain: string): boolean {
  return packet.observedFacts.some(
    (fact) => fact.domain.toLowerCase() === domain.toLowerCase()
  );
}

function hasDegradedCommsConstraint(packet: ScenarioPacket): boolean {
  return packet.constraints.some((c) =>
    /relay|degraded|communications|c2/i.test(c)
  );
}

function hasAttributionSensitiveAction(packet: ScenarioPacket): boolean {
  return packet.constraints.some((c) => /attribution/i.test(c));
}

/** Classify operating envelope from mission state (scenario packet). */
export function classifyMissionEnvelope(packet: ScenarioPacket): EnvelopeClassification {
  const reasons: string[] = [];
  const avgConf = averageConfidence(packet);
  const maritime = hasDomain(packet, "maritime") || hasDomain(packet, "UAS");
  const cyber = hasDomain(packet, "cyber");
  const degradedComms = hasDegradedCommsConstraint(packet);
  const attributionSensitive = hasAttributionSensitiveAction(packet);

  if (degradedComms && maritime) {
    reasons.push("Maritime scenario with degraded communications constraint");
    return { envelopeClass: "maritime-degraded-comms", confidence: 0.85, reasons };
  }

  if (attributionSensitive && cyber) {
    reasons.push("Cyber domain with attribution-sensitive constraints");
    return { envelopeClass: "cyber-attribution-sensitive", confidence: 0.8, reasons };
  }

  if (maritime && avgConf >= 0.65) {
    reasons.push(`Maritime ISR average confidence ${avgConf.toFixed(2)}`);
    return { envelopeClass: "maritime-standard", confidence: 0.75, reasons };
  }

  reasons.push("Default multi-domain envelope");
  return { envelopeClass: "multi-domain-standard", confidence: 0.6, reasons };
}

/** Select agent version valid for classified envelope (MVP: map envelope → version hint). */
export function selectAgentVersionForEnvelope(
  envelopeClass: MissionEnvelopeClass,
  productionVersion: string,
  envelopeVersions?: Partial<Record<MissionEnvelopeClass, string>>
): string {
  return envelopeVersions?.[envelopeClass] ?? productionVersion;
}
