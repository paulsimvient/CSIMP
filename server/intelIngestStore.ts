import type { ObservedFact } from "../src/intel/types";
import { mergeObservedFacts } from "../src/intel/ingest";

export type IngestStoreSnapshot = {
  cursor: number;
  facts: ObservedFact[];
  acceptedTotal: number;
  duplicateTotal: number;
  lastIngestAt?: string;
};

type IngestStoreState = IngestStoreSnapshot & {
  events: ObservedFact[];
  /** Global cursor index of the first item still in `events`. */
  eventOffset: number;
};

const MAX_RETAINED_FACTS = 10_000;
/** Recent poll window — full acceptedTotal is still tracked for bench demos. */
const MAX_POLL_EVENTS = 2_000;

let state: IngestStoreState = {
  cursor: 0,
  facts: [],
  events: [],
  eventOffset: 0,
  acceptedTotal: 0,
  duplicateTotal: 0,
};

export function resetIngestStore(): void {
  state = {
    cursor: 0,
    facts: [],
    events: [],
    eventOffset: 0,
    acceptedTotal: 0,
    duplicateTotal: 0,
  };
}

export function getIngestStoreSnapshot(): IngestStoreSnapshot {
  return {
    cursor: state.cursor,
    facts: state.facts,
    acceptedTotal: state.acceptedTotal,
    duplicateTotal: state.duplicateTotal,
    lastIngestAt: state.lastIngestAt,
  };
}

export type IngestRecentItem = {
  id: string;
  domain: string;
  entity: string;
  time: string;
  source: string;
};

export type IngestStatusStore = {
  acceptedTotal: number;
  duplicateTotal: number;
  retainedFacts: number;
  cursor: number;
  lastIngestAt?: string;
  recent: IngestRecentItem[];
};

const RECENT_FEED_LIMIT = 12;

/** Lightweight status for UI polling — no full fact arrays. */
export function getIngestStatusStore(): IngestStatusStore {
  const recent = state.facts
    .slice(-RECENT_FEED_LIMIT)
    .reverse()
    .map((fact) => ({
      id: fact.id,
      domain: fact.domain,
      entity: fact.entity,
      time: fact.time,
      source: fact.source,
    }));
  return {
    acceptedTotal: state.acceptedTotal,
    duplicateTotal: state.duplicateTotal,
    retainedFacts: state.facts.length,
    cursor: state.cursor,
    lastIngestAt: state.lastIngestAt,
    recent,
  };
}

export function appendIngestFacts(incoming: ObservedFact[]): {
  added: ObservedFact[];
  duplicateCount: number;
  cursor: number;
} {
  const merged = mergeObservedFacts(state.facts, incoming);
  state.facts = merged.facts.slice(-MAX_RETAINED_FACTS);
  state.events.push(...merged.added);
  if (state.events.length > MAX_POLL_EVENTS) {
    const drop = state.events.length - MAX_POLL_EVENTS;
    state.events.splice(0, drop);
    state.eventOffset += drop;
  }
  state.acceptedTotal += merged.added.length;
  state.duplicateTotal += merged.duplicateCount;
  state.cursor += merged.added.length;
  if (merged.added.length > 0) {
    state.lastIngestAt = new Date().toISOString();
  }
  return {
    added: merged.added,
    duplicateCount: merged.duplicateCount,
    cursor: state.cursor,
  };
}

export function readIngestEventsSince(sinceCursor: number): {
  cursor: number;
  added: ObservedFact[];
  truncated: boolean;
} {
  const safeSince = Math.max(0, Math.floor(sinceCursor));
  if (safeSince < state.eventOffset) {
    return { cursor: state.cursor, added: [], truncated: true };
  }
  const localSince = safeSince - state.eventOffset;
  return {
    cursor: state.cursor,
    added: state.events.slice(localSince),
    truncated: false,
  };
}
