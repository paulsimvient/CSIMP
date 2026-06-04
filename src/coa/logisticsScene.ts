import type { ObservedFact } from "../intel/types";
import type { CoaAction, LogisticsChip } from "./types";

export type IntelActionContext = {
  id: string;
  citedFacts: string[];
  actionType?: string;
  requiredAssets?: string[];
  description: string;
};

export type LogisticsSceneContext = {
  actionById: Map<string, IntelActionContext>;
  factById: Map<string, ObservedFact>;
};

export function buildLogisticsSceneContext(
  intelActions: IntelActionContext[] | undefined,
  observedFacts: ObservedFact[] | undefined
): LogisticsSceneContext {
  const actionById = new Map<string, IntelActionContext>();
  for (const action of intelActions ?? []) {
    actionById.set(action.id, action);
  }
  const factById = new Map<string, ObservedFact>();
  for (const fact of observedFacts ?? []) {
    factById.set(fact.id, fact);
  }
  return { actionById, factById };
}

export function formatResourceLabel(resourceId: string): string {
  return resourceId
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function enrichLogisticsChip(
  chip: LogisticsChip,
  action: CoaAction,
  scene: LogisticsSceneContext
): LogisticsChip {
  const intel = scene.actionById.get(action.id);
  const citedFactIds =
    intel?.citedFacts?.filter((id) => scene.factById.has(id)) ??
    [];
  const linkedFacts = citedFactIds
    .map((id) => scene.factById.get(id))
    .filter((f): f is ObservedFact => f !== undefined);

  const sceneEntities = Array.from(
    new Set(linkedFacts.map((f) => f.entity).filter(Boolean))
  );
  const sceneDomains = Array.from(
    new Set(linkedFacts.map((f) => f.domain).filter(Boolean))
  );

  const sceneSummary =
    linkedFacts.length > 0
      ? linkedFacts
          .slice(0, 2)
          .map((f) => `${f.entity}: ${f.event}`)
          .join(" · ")
      : undefined;

  const description = intel?.description ?? action.name;
  const timingUncertain =
    action.duration <= 0 ||
    /\b(timing required|timing tbd|tbd timing|time tbd|schedule tbd)\b/i.test(description);

  return {
    ...chip,
    citedFactIds: [...citedFactIds],
    linkedFactIds: [...citedFactIds],
    resourceIds: [...action.resources],
    actionType: action.type,
    sceneEntities: [...sceneEntities],
    sceneDomains: [...sceneDomains],
    sceneSummary,
    timingUncertain,
  };
}

export function enrichLogisticsLaneLabel(
  resourceId: string,
  scene: LogisticsSceneContext
): string {
  const label = formatResourceLabel(resourceId);
  const relatedFacts = [...scene.factById.values()].filter((fact) => {
    const blob = `${fact.entity} ${fact.event} ${fact.location}`.toLowerCase();
    const key = resourceId.toLowerCase().replace(/-/g, " ");
    return blob.includes(key) || key.split(" ").some((part) => part.length > 3 && blob.includes(part));
  });
  if (relatedFacts.length === 0) return label;
  const domain = relatedFacts[0]?.domain;
  return domain ? `${label} (${domain})` : label;
}
