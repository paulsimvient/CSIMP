/**
 * Extract minimal counterexamples from COA solver / materialization rejections
 * and generalize them into reusable operational doctrine.
 */

import { createHash, randomUUID } from "node:crypto";

export type CoaCounterexample = {
  counterexampleId: string;
  coaRef?: string;
  blockers: string[];
  minimalExplanation: string;
  generalizedDoctrine: string;
  failureClass: string;
};

export type CoaRejectionInput = {
  coaRef?: string;
  blockers: string[];
  status?: "unsat" | "error" | "infeasible";
};

function classifyCoaFailure(blockers: string[], status?: string): string {
  const text = blockers.join(" ").toLowerCase();
  if (/relay|comms|c2|connectivity/.test(text)) return "implicit-relay-assumption";
  if (/authority|approval/.test(text)) return "authority-compliance-failure";
  if (/logistics|matrix|asset|depends on/.test(text)) return "stale-logistics-failure";
  if (/grounded target|evidence|fact/.test(text)) return "grounding-evidence-gap";
  if (status === "unsat" || text.includes("not feasible")) return "coa-infeasible";
  return "coa-materialization-blocked";
}

function minimalExplanation(blockers: string[]): string {
  if (blockers.length === 0) return "COA rejected with no blockers recorded.";
  return blockers[0]!;
}

function generalizeDoctrine(blockers: string[], failureClass: string): string {
  const primary = blockers[0] ?? "Unknown COA rejection";

  if (failureClass === "implicit-relay-assumption") {
    return [
      "Generalized doctrine:",
      "Do not schedule an action that degrades command connectivity unless",
      "an alternate validated relay is active before the transition begins.",
      `(Counterexample: ${primary})`,
    ].join(" ");
  }

  if (failureClass === "stale-logistics-failure") {
    return [
      "Generalized doctrine:",
      "Do not commit COA tasks that depend on logistics assets without",
      "confirming asset availability within the planning freshness window.",
      `(Counterexample: ${primary})`,
    ].join(" ");
  }

  if (failureClass === "authority-compliance-failure") {
    return [
      "Generalized doctrine:",
      "Every executable COA task must map to a known authority state of authorized",
      "or requires-approval before materialization.",
      `(Counterexample: ${primary})`,
    ].join(" ");
  }

  if (failureClass === "grounding-evidence-gap") {
    return [
      "Generalized doctrine:",
      "Manual or operator-authored matrix tasks require grounded target evidence",
      "from validated intel before logistics materialization.",
      `(Counterexample: ${primary})`,
    ].join(" ");
  }

  return `Operational lesson: address COA blocker before promotion — ${primary}`;
}

export function extractCoaCounterexample(input: CoaRejectionInput): CoaCounterexample {
  const failureClass = classifyCoaFailure(input.blockers, input.status);
  const minimal = minimalExplanation(input.blockers);
  const generalized = generalizeDoctrine(input.blockers, failureClass);

  return {
    counterexampleId: `coa-ce-${randomUUID().slice(0, 8)}`,
    coaRef: input.coaRef,
    blockers: input.blockers,
    minimalExplanation: minimal,
    generalizedDoctrine: generalized,
    failureClass,
  };
}

export function counterexampleFingerprint(counterexample: CoaCounterexample): string {
  return createHash("sha256")
    .update(`${counterexample.failureClass}:${counterexample.minimalExplanation}`)
    .digest("hex")
    .slice(0, 16);
}
