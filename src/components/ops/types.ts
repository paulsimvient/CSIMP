export type OverviewTrack = {
  id: string;
  callsign: string;
  side: "unknown" | "hostile" | "friendly";
  classification: "unknown-air" | "uas" | "signal-source";
  confidence: number;
  uncertaintyMeters: number;
  stalenessMinutes: number;
  stalenessState: "fresh" | "warm" | "stale";
  detectedBy: string;
  lastUpdate: string;
  summary: string;
  history: { time: string; label: string; confidence: number }[];
  coordinates?: { lat: number; lng: number };
  moving?: boolean;
  headingDeg?: number;
  speedKts?: number;
  inSensorRange?: boolean;
};

export type MessageTrafficItem = {
  id: string;
  time: string;
  kind: "track" | "validation" | "ops";
  channel: "contact" | "orders" | "validation";
  severity: "info" | "warn" | "alert";
  text: string;
  /** Linked map/contact fact ID when available. */
  factId?: string;
  /** Mission timeline position for matrix event markers. */
  offsetSec?: number;
};

export type ShowOrderItem = {
  id: string;
  order: string;
  status: "active" | "queued" | "hold";
  eta: string;
  /** When set, clicking the order focuses this contact on the map. */
  factId?: string;
};
