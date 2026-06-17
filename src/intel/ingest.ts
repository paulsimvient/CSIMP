import type { ObservedFact, RawSourceReport } from "./types";
import { normalizeBatch, normalizeReport } from "./normalizeReport";

export type MergeObservedFactsResult = {
  facts: ObservedFact[];
  added: ObservedFact[];
  duplicateCount: number;
};

export function factDedupeKey(fact: ObservedFact): string {
  return `${fact.entity}|${fact.event}|${fact.time}`;
}

/** Merge incoming facts into an existing list; skip duplicates by id or entity/event/time. */
export function mergeObservedFacts(
  existing: ObservedFact[],
  incoming: ObservedFact[]
): MergeObservedFactsResult {
  const byId = new Map(existing.map((fact) => [fact.id, fact]));
  const seenKeys = new Set(existing.map(factDedupeKey));
  const added: ObservedFact[] = [];
  let duplicateCount = 0;

  for (const fact of incoming) {
    const key = factDedupeKey(fact);
    if (byId.has(fact.id) || seenKeys.has(key)) {
      duplicateCount += 1;
      continue;
    }
    const next: ObservedFact = {
      ...fact,
      sourceType: fact.sourceType ?? "loaded-fact",
    };
    byId.set(next.id, next);
    seenKeys.add(key);
    added.push(next);
  }

  return {
    facts: [...existing, ...added],
    added,
    duplicateCount,
  };
}

export function ingestRawReports(reports: RawSourceReport[]): ObservedFact[] {
  return normalizeBatch(reports).map((fact) => ({
    ...fact,
    sourceType: "loaded-fact" as const,
  }));
}

export function ingestObservedFacts(facts: ObservedFact[]): ObservedFact[] {
  return facts.map((fact) => ({
    ...fact,
    sourceType: fact.sourceType ?? "loaded-fact",
  }));
}

export function ingestPayload(input: {
  reports?: RawSourceReport[];
  facts?: ObservedFact[];
}): ObservedFact[] {
  const fromReports = input.reports?.length ? ingestRawReports(input.reports) : [];
  const fromFacts = input.facts?.length ? ingestObservedFacts(input.facts) : [];
  const { facts } = mergeObservedFacts([], [...fromReports, ...fromFacts]);
  return facts;
}

export { normalizeReport };
