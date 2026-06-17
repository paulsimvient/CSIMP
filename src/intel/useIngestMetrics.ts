import { useEffect, useRef, useState } from "react";

export type IngestRecentItem = {
  id: string;
  domain: string;
  entity: string;
  time: string;
  source: string;
};

export type IngestStreamStatus = {
  enabled: boolean;
  running: boolean;
  brokers: string[];
  topic?: string;
  messagesConsumed: number;
  messagesAccepted: number;
  lastError?: string;
  lastMessageAt?: string;
};

export type IngestMetricsSnapshot = {
  store: {
    acceptedTotal: number;
    duplicateTotal: number;
    retainedFacts: number;
    cursor: number;
    lastIngestAt?: string;
    recent: IngestRecentItem[];
  };
  stream: IngestStreamStatus;
};

const DEFAULT_POLL_MS = 1_000;

function ingestFeedPollMs(): number {
  const raw = Number(import.meta.env.VITE_INTEL_FEED_POLL_MS ?? DEFAULT_POLL_MS);
  return Number.isFinite(raw) && raw >= 500 ? raw : DEFAULT_POLL_MS;
}

export function ingestFeedWindowEnabled(): boolean {
  return import.meta.env.VITE_INTEL_FEED_WINDOW === "true";
}

export function useIngestMetrics(active: boolean): {
  snapshot: IngestMetricsSnapshot | null;
  ingestRate: number;
  error?: string;
} {
  const [snapshot, setSnapshot] = useState<IngestMetricsSnapshot | null>(null);
  const [ingestRate, setIngestRate] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);
  const sampleRef = useRef<{ total: number; at: number } | null>(null);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch("/api/intel/ingest/status");
        if (!response.ok) {
          if (!cancelled) {
            setError(`Status ${response.status}`);
          }
          return;
        }
        const payload = (await response.json()) as IngestMetricsSnapshot;
        if (cancelled) return;

        const now = performance.now();
        const accepted = payload.store.acceptedTotal;
        const previous = sampleRef.current;
        if (previous && now > previous.at) {
          const elapsedSec = (now - previous.at) / 1000;
          const delta = accepted - previous.total;
          if (elapsedSec > 0 && delta >= 0) {
            setIngestRate(Math.round(delta / elapsedSec));
          }
        }
        sampleRef.current = { total: accepted, at: now };
        setSnapshot(payload);
        setError(undefined);
      } catch {
        if (!cancelled) setError("Ingest status unavailable");
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, ingestFeedPollMs());

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      sampleRef.current = null;
    };
  }, [active]);

  return { snapshot, ingestRate, error };
}
