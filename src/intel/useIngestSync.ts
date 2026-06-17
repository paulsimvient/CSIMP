import { useEffect, useRef } from "react";
import { useAppendObservedFacts, useRunIntel } from "./pipeline";
import type { ObservedFact } from "./types";

type IngestPollResponse = {
  cursor: number;
  added: ObservedFact[];
  since: number;
};

const DEFAULT_POLL_MS = 3_000;
const AUTO_RUN_DEBOUNCE_MS = 2_000;

function ingestSyncEnabled(): boolean {
  return import.meta.env.VITE_INTEL_INGEST_SYNC === "true";
}

function ingestPollMs(): number {
  const raw = Number(import.meta.env.VITE_INTEL_INGEST_POLL_MS ?? DEFAULT_POLL_MS);
  return Number.isFinite(raw) && raw >= 1_000 ? raw : DEFAULT_POLL_MS;
}

function autoRunIntelEnabled(): boolean {
  return import.meta.env.VITE_INTEL_INGEST_AUTO_RUN !== "false";
}

export function useIngestSync(): void {
  const appendFacts = useAppendObservedFacts();
  const runIntel = useRunIntel();
  const cursorRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ingestSyncEnabled()) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(`/api/intel/ingest?since=${cursorRef.current}`);
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as IngestPollResponse;
        cursorRef.current = payload.cursor;
        if (!payload.added?.length) return;

        appendFacts(payload.added);
        if (!autoRunIntelEnabled()) return;

        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          void runIntel();
        }, AUTO_RUN_DEBOUNCE_MS);
      } catch {
        // Dev ingest bridge is optional — ignore transient proxy errors.
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, ingestPollMs());

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [appendFacts, runIntel]);
}
