import type {
  ConfidenceLevel,
  FactDomain,
  ObservedFact,
  RawSourceReport,
  SeverityLevel,
} from "./types";

// Normalizer only — no import.meta.glob (safe for Vite config / server bundles).

let factCounter = 0;

export function normalizeReport(report: RawSourceReport): ObservedFact {
  const id = factIdFromReport(report);

  return {
    id,
    domain: report.domain,
    entity: extractEntity(report),
    event: extractEvent(report),
    time: report.timestamp,
    location: extractLocation(report),
    coordinates: extractCoordinates(report),
    source: report.source,
    confidence: deriveConfidence(report),
    severity: deriveSeverity(report),
    rawEvidenceRef: report.reportId,
  };
}

export function normalizeBatch(reports: RawSourceReport[]): ObservedFact[] {
  const normalized = reports.map(normalizeReport);
  return deduplicateFacts(normalized);
}

function factIdFromReport(report: RawSourceReport): string {
  const raw = report.reportId.trim();
  if (/^fact_[a-z0-9_]+$/i.test(raw)) return raw.toLowerCase();
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (slug) return `fact_${report.domain.toLowerCase()}_${slug}`;
  factCounter += 1;
  return `fact_${report.domain.toLowerCase()}_${String(factCounter).padStart(3, "0")}`;
}

function extractEntity(report: RawSourceReport): string {
  const meta = report.metadata as Record<string, string> | undefined;
  return meta?.["entity"] ?? inferEntityFromText(report.text);
}

function extractEvent(report: RawSourceReport): string {
  const meta = report.metadata as Record<string, string> | undefined;
  return meta?.["event"] ?? report.text.slice(0, 80).trim();
}

function extractLocation(report: RawSourceReport): string | undefined {
  const meta = report.metadata as Record<string, string> | undefined;
  return meta?.["location"];
}

function extractCoordinates(
  report: RawSourceReport
): { lat: number; lng: number } | undefined {
  const meta = report.metadata as Record<string, unknown> | undefined;
  const lat = Number(meta?.["lat"]);
  const lng = Number(meta?.["lng"]);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  return undefined;
}

function deriveConfidence(report: RawSourceReport): ConfidenceLevel {
  const meta = report.metadata as Record<string, string> | undefined;
  const explicit = meta?.["confidence"] as ConfidenceLevel | undefined;
  if (explicit && ["low", "medium", "high"].includes(explicit)) return explicit;

  const src = report.source.toLowerCase();
  if (src.includes("confirmed") || src.includes("multi-source")) return "high";
  if (src.includes("single") || src.includes("rumor") || src.includes("osint")) return "low";
  return "medium";
}

function deriveSeverity(report: RawSourceReport): SeverityLevel {
  const meta = report.metadata as Record<string, string> | undefined;
  const explicit = meta?.["severity"] as SeverityLevel | undefined;
  if (explicit && ["low", "medium", "high", "critical"].includes(explicit)) return explicit;

  const domainDefaults: Record<FactDomain, SeverityLevel> = {
    UAS: "medium",
    cyber: "high",
    maritime: "medium",
    ground: "high",
    air: "high",
    space: "medium",
    information: "low",
    logistics: "medium",
    signals: "medium",
  };

  return domainDefaults[report.domain] ?? "medium";
}

function inferEntityFromText(text: string): string {
  const portMatch = text.match(/Port [A-Z]/);
  if (portMatch?.[0]) return portMatch[0];
  return "Unknown entity";
}

function deduplicateFacts(facts: ObservedFact[]): ObservedFact[] {
  const seen = new Set<string>();
  return facts.filter((f) => {
    const key = `${f.entity}|${f.event}|${f.time}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
